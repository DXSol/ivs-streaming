import { Resend } from 'resend';
import { env } from '../config/env';

let resendInstance: Resend | null = null;

function getResendInstance(): Resend {
  if (!resendInstance) {
    if (!env.resend.apiKey) {
      throw new Error('Resend API key not configured. Set RESEND_API_KEY in .env');
    }
    resendInstance = new Resend(env.resend.apiKey);
  }
  return resendInstance;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<boolean> {
  try {
    const resend = getResendInstance();
    
    const { data, error } = await resend.emails.send({
      from: env.resend.fromEmail,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      console.error('[Email] Failed to send email:', error);
      return false;
    }

    console.log('[Email] Email sent successfully:', data?.id);
    return true;
  } catch (err) {
    console.error('[Email] Error sending email:', err);
    return false;
  }
}

export async function sendPasswordResetEmail(email: string, resetToken: string, resetUrl: string): Promise<boolean> {
  const subject = 'Reset Your Password - Sankeertanotsav';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your Password</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #8B1538 0%, #6B0F2B 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 24px;">Sankeertanotsav</h1>
      </div>
      
      <div style="background: #fff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <h2 style="color: #8B1538; margin-top: 0;">Reset Your Password</h2>
        
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: #8B1538; color: #fff; padding: 14px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Reset Password</a>
        </div>
        
        <p style="color: #666; font-size: 14px;">This link will expire in 1 hour for security reasons.</p>
        
        <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
        
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
        
        <p style="color: #999; font-size: 12px; text-align: center;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${resetUrl}" style="color: #8B1538; word-break: break-all;">${resetUrl}</a>
        </p>
      </div>
      
      <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
        <p>© ${new Date().getFullYear()} Sankeertanotsav. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  const text = `
Reset Your Password - Sankeertanotsav

We received a request to reset your password. Click the link below to create a new password:

${resetUrl}

This link will expire in 1 hour for security reasons.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

© ${new Date().getFullYear()} Sankeertanotsav. All rights reserved.
  `;

  return sendEmail({
    to: email,
    subject,
    html,
    text,
  });
}
