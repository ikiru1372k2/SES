import { BadRequestException, Injectable } from '@nestjs/common';
import { EscalationStage, type Prisma } from '../../repositories/types';
import { createId } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { IdentifierService } from '../../common/identifier.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { SignedLinkService, type SignedLinkContext } from './signed-link.service';

export type PublicAction = 'acknowledge' | 'correct' | 'dispute';

export interface PublicSubmitInput {
  action: PublicAction;
  note?: string;
  correctedEffort?: number;
  correctedState?: string;
  correctedManager?: string;
}

export interface PublicViewData {
  linkCode: string;
  processCode: string;
  issueKey?: string;
  managerEmail: string;
  allowedActions: readonly string[];
  expiresAt: string;
  issue?: {
    displayCode: string;
    projectNo?: string;
    projectName?: string;
    sheetName?: string;
    severity: string;
    effort?: number;
    reason?: string;
    projectState?: string;
  };
}

@Injectable()
export class PublicResponseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signedLinks: SignedLinkService,
    private readonly activity: ActivityLogService,
    private readonly identifiers: IdentifierService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** The GET /public/respond/:token page loads data to render. */
  async view(token: string): Promise<PublicViewData> {
    const peek = await this.signedLinks.peek(token);
    if ('rejection' in peek) {
      throw SignedLinkService.toHttpError(peek.rejection);
    }
    const issue = peek.issueKey ? await this.findIssueSummary(peek.issueKey) : undefined;
    return {
      linkCode: peek.linkCode,
      processCode: peek.processCode,
      issueKey: peek.issueKey,
      managerEmail: peek.managerEmail,
      allowedActions: peek.allowedActions,
      expiresAt: peek.expiresAt.toISOString(),
      issue,
    };
  }

  /** POST /public/respond/:token — consume the link and write the response. */
  async submit(token: string, body: PublicSubmitInput, meta: { ip?: string; userAgent?: string }) {
    const peek = await this.signedLinks.peek(token);
    if ('rejection' in peek) {
      throw SignedLinkService.toHttpError(peek.rejection);
    }
    SignedLinkService.assertActionAllowed(peek, body.action);

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await this.signedLinks.claim(tx, peek.linkId, body.action, meta);
      if (!claimed) {
        // Lost to another tab/replay — render as "already used".
        throw SignedLinkService.toHttpError('already_used');
      }

      // Record a tracking event so the auditor's timeline reflects the response.
      const tracking = peek.issueKey
        ? await this.findTrackingForIssue(tx, peek.processId, peek.managerEmail)
        : null;

      if (tracking) {
        await tx.trackingEvent.create({
          data: {
            id: createId(),
            displayCode: await this.identifiers.nextTrackingEventCode(tx),
            trackingId: tracking.id,
            kind: 'contact',
            channel: 'manager_response',
            note: this.summaryNote(body),
            triggeredById: null,
          },
        });
        if (body.action === 'acknowledge' || body.action === 'correct') {
          await tx.trackingEntry.update({
            where: { id: tracking.id },
            data: {
              stage: body.action === 'correct' ? EscalationStage.RESOLVED : EscalationStage.RESPONDED,
              resolved: body.action === 'correct' ? true : tracking.resolved,
              lastContactAt: new Date(),
              rowVersion: { increment: 1 },
            },
          });
        }
      }

      if (body.action === 'acknowledge' && peek.issueKey) {
        await this.upsertAcknowledgment(tx, peek, 'acknowledged');
      } else if (body.action === 'correct' && peek.issueKey) {
        await this.upsertCorrection(tx, peek, body);
        await this.upsertAcknowledgment(tx, peek, 'corrected');
      } else if (body.action === 'dispute' && peek.issueKey) {
        await this.upsertAcknowledgment(tx, peek, 'needs_review');
      }

      return {
        action: body.action,
        processId: peek.processId,
        processCode: peek.processCode,
        trackingId: tracking?.id ?? null,
        trackingCode: tracking?.displayCode ?? null,
        managerKey: tracking?.managerKey ?? null,
        stage: tracking?.stage ?? null,
      };
    });

    // After-commit emissions so auditors see the response live.
    if (result.trackingCode && result.managerKey) {
      this.realtime.emitToProcess(peek.processCode, 'tracking.updated', {
        trackingCode: result.trackingCode,
        trackingId: result.trackingId,
        managerKey: result.managerKey,
        stage: result.stage ?? '',
        resolved: body.action === 'correct',
      });
    }
    this.realtime.emitToProcess(peek.processCode, 'tracking.event_added', {
      action: body.action,
      managerEmail: peek.managerEmail,
      issueKey: peek.issueKey,
    });

    return { ok: true, action: body.action, processCode: peek.processCode };
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private summaryNote(body: PublicSubmitInput): string {
    const pieces: string[] = [`Manager ${body.action}`];
    if (body.note?.trim()) pieces.push(body.note.trim().slice(0, 500));
    if (body.action === 'correct') {
      if (body.correctedEffort != null) pieces.push(`effort → ${body.correctedEffort}`);
      if (body.correctedState) pieces.push(`state → ${body.correctedState}`);
      if (body.correctedManager) pieces.push(`mgr → ${body.correctedManager}`);
    }
    return pieces.join(' · ');
  }

  private async findIssueSummary(issueKey: string) {
    const issue = await this.prisma.auditIssue.findFirst({
      where: { issueKey },
      orderBy: { auditRun: { startedAt: 'desc' } },
      select: {
        displayCode: true,
        projectNo: true,
        projectName: true,
        sheetName: true,
        severity: true,
        effort: true,
        reason: true,
        projectState: true,
      },
    });
    if (!issue) return undefined;
    return {
      displayCode: issue.displayCode as string,
      projectNo: (issue.projectNo ?? undefined) as string | undefined,
      projectName: (issue.projectName ?? undefined) as string | undefined,
      sheetName: (issue.sheetName ?? undefined) as string | undefined,
      severity: issue.severity as string,
      effort: (issue.effort ?? undefined) as number | undefined,
      reason: (issue.reason ?? undefined) as string | undefined,
      projectState: (issue.projectState ?? undefined) as string | undefined,
    };
  }

  private async findTrackingForIssue(tx: Prisma.TransactionClient, processId: string, managerEmail: string) {
    // managerKey is the normalized email when one exists.
    const row = await tx.trackingEntry.findFirst({
      where: { processId, managerKey: managerEmail.toLowerCase().trim() },
    });
    return row ?? null;
  }

  private async upsertAcknowledgment(
    tx: Prisma.TransactionClient,
    peek: SignedLinkContext,
    status: 'acknowledged' | 'corrected' | 'needs_review',
  ) {
    const existing = await tx.issueAcknowledgment.findFirst({
      where: { processId: peek.processId, issueKey: peek.issueKey },
    });
    if (existing) {
      await tx.issueAcknowledgment.update({
        where: { id: existing.id },
        // SCHEMA-GAP: updatedById is String (non-null) but public writes have no user.
        // Change to String? in a future migration.
        data: {
          status,
          updatedById: null,
          updatedAt: new Date(),
          rowVersion: { increment: 1 },
        } as any,
      });
      return;
    }
    await tx.issueAcknowledgment.create({
      // SCHEMA-GAP: updatedById is String (non-null) but public writes have no user; issueKey is
      // guarded by the caller but inferred as string | undefined here.
      data: {
        id: createId(),
        displayCode: `ACK-${peek.issueKey}`,
        processId: peek.processId,
        issueKey: peek.issueKey,
        status,
        updatedById: null,
      } as any,
    });
  }

  private async upsertCorrection(tx: Prisma.TransactionClient, peek: SignedLinkContext, body: PublicSubmitInput) {
    if (!peek.issueKey) throw new BadRequestException('Correction requires an issueKey');
    const existing = await tx.issueCorrection.findFirst({
      where: { processId: peek.processId, issueKey: peek.issueKey },
    });
    const data = {
      correctedEffort: body.correctedEffort ?? null,
      correctedState: body.correctedState ?? null,
      correctedManager: body.correctedManager ?? null,
      note: body.note ?? '',
      updatedById: null,
    };
    if (existing) {
      await tx.issueCorrection.update({
        where: { id: existing.id },
        // SCHEMA-GAP: updatedById is String (non-null) but public writes have no user.
        data: { ...data, updatedAt: new Date(), rowVersion: { increment: 1 } } as any,
      });
      return;
    }
    await tx.issueCorrection.create({
      // SCHEMA-GAP: updatedById is String (non-null) but public writes have no user.
      data: {
        id: createId(),
        displayCode: await this.identifiers.nextCorrectionCode(tx, peek.issueKey),
        processId: peek.processId,
        issueKey: peek.issueKey,
        ...data,
      } as any,
    });
  }
}
