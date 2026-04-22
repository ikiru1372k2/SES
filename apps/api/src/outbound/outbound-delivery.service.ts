import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';

export type EscalationSendChannel = 'email' | 'teams' | 'both';

@Injectable()
export class OutboundDeliveryService {
  async sendEscalation(opts: {
    channel: EscalationSendChannel;
    to: string;
    cc: string[];
    subject: string;
    bodyText: string;
  }): Promise<void> {
    const needEmail = opts.channel === 'email' || opts.channel === 'both';
    const needTeams = opts.channel === 'teams' || opts.channel === 'both';
    const smtpUrl = process.env.SES_SMTP_URL?.trim();
    const teamsWebhook = process.env.SES_TEAMS_INCOMING_WEBHOOK_URL?.trim();

    if (needEmail && !smtpUrl) {
      throw new ServiceUnavailableException('Outbound email is not configured (set SES_SMTP_URL).');
    }
    if (needTeams && !teamsWebhook) {
      throw new ServiceUnavailableException('Teams webhook is not configured (set SES_TEAMS_INCOMING_WEBHOOK_URL).');
    }

    if (needEmail) {
      const transport = nodemailer.createTransport(smtpUrl);
      const from = process.env.SES_MAIL_FROM?.trim() || 'noreply@ses.local';
      await transport.sendMail({
        from,
        to: opts.to,
        cc: opts.cc.length ? opts.cc.join(', ') : undefined,
        subject: opts.subject,
        text: opts.bodyText,
      });
    }

    if (needTeams) {
      const card = {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: opts.subject,
        themeColor: '0078D4',
        title: opts.subject,
        text: opts.bodyText.replace(/\n+/g, '\n\n'),
      };
      const res = await fetch(teamsWebhook!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new ServiceUnavailableException(`Teams webhook failed: ${res.status} ${t}`.slice(0, 500));
      }
    }
  }
}
