import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailerService {
  constructor(private config: ConfigService) {}

  private get resend() {
    return new Resend(this.config.get('RESEND_API_KEY'));
  }

  async sendDealPackage(to: string, subject: string, html: string, replyTo?: string) {
    const from = this.config.get('SMTP_FROM') || 'Deal Core <noreply@mydealcore.com>';
    await this.resend.emails.send({
      from,
      to,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    });
  }

  async sendPasswordResetEmail(email: string, token: string, firstName: string) {
    const frontendUrl = this.config.get('FRONTEND_URL') || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
    const from = this.config.get('SMTP_FROM') || 'noreply@mydealcore.com';

    await this.resend.emails.send({
      from,
      to: email,
      subject: 'Reset your Deal Core password',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #111827; margin-bottom: 16px;">Reset your password</h2>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">
            Hi ${firstName},
          </p>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">
            We received a request to reset your Deal Core password. Click the button below to choose a new password.
          </p>
          <div style="margin: 32px 0;">
            <a href="${resetUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px;">
              Reset Password
            </a>
          </div>
          <p style="color: #9ca3af; font-size: 13px; line-height: 1.5;">
            This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">Deal Core &mdash; Real estate deal intelligence</p>
        </div>
      `,
    });
  }
}
