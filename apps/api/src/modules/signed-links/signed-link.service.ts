import { BadRequestException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../repositories/types';
import { createId } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import {
  SignedLinkPayload,
  SignedLinkTokenService,
  type IssueTokenInput,
  type IssuedToken,
} from './signed-link-token.service';

export interface SignedLinkContext {
  token: string;
  payload: SignedLinkPayload;
  linkId: string;
  linkCode: string;
  processId: string;
  processCode: string;
  managerEmail: string;
  allowedActions: SignedLinkPayload['acts'];
  issueKey?: string;
  expiresAt: Date;
}

/**
 * Reasons a token might be rejected when someone tries to redeem it. We
 * surface these distinctly so the public page can render a helpful message
 * ("this link has already been used" is very different from "this link is
 * tampered").
 */
export type SignedLinkRejection =
  | 'invalid_signature'
  | 'expired'
  | 'unknown_jti'
  | 'already_used'
  | 'revoked'
  | 'process_not_found';

/**
 * Thin wrapper over the token service that persists an audit row for every
 * link issued, and enforces single-use / revocation at redeem time.
 *
 * Design contract:
 *   issue()  -> DB write + returns token string for the email URL.
 *              The calling service (e.g. NotificationsService) stores the
 *              URL; we store the SHA-256 hash so leaking the DB doesn't
 *              leak valid tokens.
 *
 *   peek()   -> read-only verification used when the public page loads.
 *              Returns the context but DOES NOT consume the token.
 *
 *   claim()  -> atomic redemption. Must be called inside the same transaction
 *              as the downstream write (acknowledge / correct / dispute) so
 *              a failed write doesn't consume the token.
 */
@Injectable()
export class SignedLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SignedLinkTokenService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async issue(input: IssueTokenInput & { createdByUserId?: string }): Promise<IssuedToken & { linkId: string; linkCode: string }> {
    // Resolve processId from the displayCode so the DB has a hard FK.
    const process = await this.prisma.process.findFirst({
      where: { displayCode: input.processCode },
      select: { id: true, displayCode: true },
    });
    if (!process) {
      throw new NotFoundException(`Process ${input.processCode} not found`);
    }
    const issued = this.tokens.issue(input);
    const linkId = createId();
    const linkCode = await this.identifiers.nextSequence(this.prisma, 'LNK').then((n) =>
      `LNK-${String(n).padStart(8, '0')}`,
    );
    await this.prisma.signedLink.create({
      data: {
        id: linkId,
        displayCode: linkCode,
        purpose: 'manager_response',
        processId: process.id,
        issueKey: input.issueKey ?? null,
        managerEmail: input.managerEmail.toLowerCase().trim(),
        // Buffer satisfies Uint8Array<ArrayBuffer> at runtime; generic variance requires cast
        tokenHash: issued.tokenHash as unknown as Uint8Array<ArrayBuffer>,
        allowedActions: input.allowedActions,
        singleUse: true,
        expiresAt: issued.expiresAt,
        createdById: input.createdByUserId ?? null,
      },
    });
    this.realtime.emitToProcess(input.processCode, 'signed_link.created', {
      linkCode,
      managerEmail: input.managerEmail.toLowerCase().trim(),
      expiresAt: issued.expiresAt.toISOString(),
    });
    return { ...issued, linkId, linkCode };
  }

  /**
   * Read-only verification: HMAC + expiry + row exists + not used / revoked.
   * Returns either a populated context or a typed rejection reason.
   */
  async peek(token: string): Promise<SignedLinkContext | { rejection: SignedLinkRejection }> {
    const payload = this.tokens.verify(token);
    if (!payload) {
      // Either signature is wrong OR token is expired. We can't tell them
      // apart without decoding, but we also shouldn't leak that distinction.
      // If it decoded but exp <= now, verify() returns null; we fall through.
      return { rejection: 'invalid_signature' };
    }
    const hash = this.tokens.hashFor(token);
    const row = await this.prisma.signedLink.findFirst({
      // Buffer satisfies Uint8Array<ArrayBuffer> at runtime; generic variance requires cast
      where: { tokenHash: hash as unknown as Uint8Array<ArrayBuffer> },
      include: { process: { select: { id: true, displayCode: true } } },
    });
    if (!row) return { rejection: 'unknown_jti' };
    if (row.revokedAt) return { rejection: 'revoked' };
    if (row.singleUse && row.usedAt) return { rejection: 'already_used' };
    if (row.expiresAt.getTime() <= Date.now()) return { rejection: 'expired' };

    return {
      token,
      payload,
      linkId: row.id as string,
      linkCode: row.displayCode as string,
      processId: row.process.id as string,
      processCode: row.process.displayCode as string,
      managerEmail: row.managerEmail as string,
      allowedActions: (row.allowedActions ?? []) as SignedLinkPayload['acts'],
      issueKey: (row.issueKey ?? undefined) as string | undefined,
      expiresAt: row.expiresAt as Date,
    };
  }

  /**
   * Atomically mark a token as consumed. Callers MUST invoke this inside the
   * same Prisma transaction as the write that the token authorises, to avoid
   * consuming a token for a failed write.
   *
   * Returns `true` if the token was newly consumed; `false` if it was already
   * consumed by a concurrent request. Callers should treat `false` as a
   * race-lost error and surface GoneException to the HTTP caller.
   */
  async claim(
    tx: Prisma.TransactionClient,
    linkId: string,
    action: 'acknowledge' | 'correct' | 'dispute',
    meta: { ip?: string; userAgent?: string },
  ): Promise<boolean> {
    const result = await tx.signedLink.updateMany({
      where: {
        id: linkId,
        usedAt: null,
        revokedAt: null,
      },
      data: {
        usedAt: new Date(),
        usedFromIp: meta.ip ?? null,
        usedUserAgent: meta.userAgent ?? null,
      },
    });
    const consumed = result.count === 1;
    if (consumed) {
      await this.activity.append(tx, {
        entityType: 'signed_link',
        entityId: linkId,
        action: `signed_link.${action}`,
        after: { action },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return consumed;
  }

  /** Enforce that this token permits the action the caller is attempting. */
  static assertActionAllowed(ctx: SignedLinkContext, action: string): asserts action is 'acknowledge' | 'correct' | 'dispute' {
    if (action !== 'acknowledge' && action !== 'correct' && action !== 'dispute') {
      throw new BadRequestException(`Unknown action: ${action}`);
    }
    if (!ctx.allowedActions.includes(action)) {
      throw new BadRequestException(`Action "${action}" not allowed by this link`);
    }
  }

  /** Build the user-facing URL for an issued token. */
  static buildUrl(baseUrl: string, token: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    return `${trimmed}/respond/${encodeURIComponent(token)}`;
  }

  /** Map a rejection reason to an appropriate HTTP exception so controllers
   * can `throw service.toHttpError(rejection)` cleanly. */
  static toHttpError(rejection: SignedLinkRejection): Error {
    switch (rejection) {
      case 'invalid_signature':
        return new BadRequestException('This response link is invalid.');
      case 'expired':
        return new GoneException('This response link has expired.');
      case 'already_used':
        return new GoneException('This response link has already been used.');
      case 'revoked':
        return new GoneException('This response link has been revoked.');
      case 'unknown_jti':
        return new NotFoundException('This response link could not be found.');
      case 'process_not_found':
        return new NotFoundException('The process for this link is no longer available.');
      default:
        return new BadRequestException('Invalid response link.');
    }
  }
}
