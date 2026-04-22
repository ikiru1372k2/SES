import { Injectable } from '@nestjs/common';

export type EscalationSendChannel = 'email' | 'teams' | 'both';

/**
 * Issue #75: server-side SMTP / Teams webhook delivery was removed. The web
 * client now opens the user's own mail client (`mailto:`) or Teams deep-link
 * with the prefilled content after the server records the handoff. This
 * class survives as a no-op to keep the module graph intact for any code
 * path that still DI-injects it; it no longer reads env vars and no longer
 * talks to nodemailer or Teams.
 */
@Injectable()
export class OutboundDeliveryService {
  async sendEscalation(_opts: {
    channel: EscalationSendChannel;
    to: string;
    cc: string[];
    subject: string;
    bodyText: string;
  }): Promise<void> {
    // Intentionally empty — the client-handoff path in the web app does
    // the actual send via the auditor's own mail / Teams application.
  }
}
