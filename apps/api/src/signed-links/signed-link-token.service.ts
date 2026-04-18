import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Signed-link token service — HMAC-based, stateless-verifiable, one-time-use.
 *
 * Why HMAC + DB row (not pure JWT):
 *   - HMAC gives us self-verifying tokens (no DB lookup to prove authenticity).
 *   - The DB row lets us enforce one-time-use, revocation, and attribution
 *     (who used it from which IP / UA).
 *   - We store only the SHA-256 hash of the token, not the token itself —
 *     a DB dump doesn't leak unredeemed links.
 *
 * Token format (URL-safe, no padding):
 *    <base64url(json_payload)> . <base64url(hmac_sha256(json_payload, secret))>
 *
 * Payload schema:
 *    {
 *      v:    1,
 *      jti:  "<16 random bytes, base64url>",   // uniqueness + binds to DB row
 *      purp: "manager_response",
 *      proc: "PRC-2026-0042",
 *      iky:  "IKY-8A3FCB",
 *      mgr:  "alice@example.com",
 *      acts: ["acknowledge","correct","dispute"],
 *      exp:  1713484800                        // unix seconds
 *    }
 *
 * Secrets:
 *    SES_AUTH_SECRET is reused — it's already required at ≥32 chars in
 *    production. No new secret to manage or rotate.
 */

export interface SignedLinkPayload {
  v: 1;
  jti: string;
  purp: 'manager_response';
  proc: string;
  iky?: string;
  mgr: string;
  acts: Array<'acknowledge' | 'correct' | 'dispute'>;
  exp: number;
}

export interface IssueTokenInput {
  processCode: string;
  issueKey?: string;
  managerEmail: string;
  allowedActions: SignedLinkPayload['acts'];
  /** TTL in seconds. Defaults to 14 days. */
  ttlSeconds?: number;
}

export interface IssuedToken {
  token: string;
  tokenHash: Buffer;
  payload: SignedLinkPayload;
  expiresAt: Date;
}

const DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

@Injectable()
export class SignedLinkTokenService {
  private readonly logger = new Logger(SignedLinkTokenService.name);

  private secret(): string {
    const value = process.env.SES_AUTH_SECRET;
    if (process.env.NODE_ENV === 'production') {
      if (!value || value.length < 32) {
        throw new Error('SES_AUTH_SECRET must be ≥ 32 chars in production');
      }
      return value;
    }
    return value || 'ses-dev-secret';
  }

  /** Build a new token. Returns both the string form (for the URL) and its
   * SHA-256 hash (for DB storage). */
  issue(input: IssueTokenInput): IssuedToken {
    const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const now = Math.floor(Date.now() / 1000);
    const payload: SignedLinkPayload = {
      v: 1,
      jti: base64url(randomBytes(16)),
      purp: 'manager_response',
      proc: input.processCode,
      iky: input.issueKey,
      mgr: input.managerEmail.toLowerCase().trim(),
      acts: input.allowedActions,
      exp: now + ttl,
    };
    const payloadJson = JSON.stringify(payload);
    const payloadPart = base64url(Buffer.from(payloadJson, 'utf8'));
    const sig = createHmac('sha256', this.secret()).update(payloadPart).digest();
    const token = `${payloadPart}.${base64url(sig)}`;
    const tokenHash = createHash('sha256').update(token).digest();
    return {
      token,
      tokenHash,
      payload,
      expiresAt: new Date(payload.exp * 1000),
    };
  }

  /** Verify a token: signature valid AND not expired. Does NOT check
   * one-time-use — that's a DB lookup the caller must do. */
  verify(token: string): SignedLinkPayload | null {
    try {
      const dot = token.indexOf('.');
      if (dot <= 0 || dot === token.length - 1) return null;
      const payloadPart = token.slice(0, dot);
      const sigPart = token.slice(dot + 1);
      const expected = createHmac('sha256', this.secret()).update(payloadPart).digest();
      const provided = base64urlDecode(sigPart);
      if (provided.length !== expected.length) return null;
      if (!timingSafeEqual(provided, expected)) return null;

      const payload = JSON.parse(base64urlDecode(payloadPart).toString('utf8')) as SignedLinkPayload;
      if (payload.v !== 1 || payload.purp !== 'manager_response') return null;
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= now) return null;
      return payload;
    } catch (err) {
      this.logger.debug(`token verify failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Hash a token string the same way issue() does, for DB lookups. */
  hashFor(token: string): Buffer {
    return createHash('sha256').update(token).digest();
  }
}
