import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {}

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get('SMTP_HOST'),
        port: Number(this.config.get('SMTP_PORT') || 587),
        secure: Number(this.config.get('SMTP_PORT') || 587) === 465,
        auth: {
          user: this.config.get('SMTP_USER'),
          pass: this.config.get('SMTP_PASS'),
        },
      });
    }
    return this.transporter;
  }

  async sendPasswordResetEmail(email: string, token: string, firstName: string) {
    const frontendUrl = this.config.get('FRONTEND_URL') || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
    const from = this.config.get('SMTP_FROM') || 'noreply@mydealcore.com';

    await this.getTransporter().sendMail({
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
