import { Resend } from 'resend';
import { env } from '../config/env';

let resendInstance: Resend | null = null;

function getResendInstance(): Resend {
  if (!resendInstance) {
    if (!env.resend.apiKey) {
      throw new Error(
        'Resend API key not configured. Set RESEND_API_KEY in .env',
      );
    }
    resendInstance = new Resend(env.resend.apiKey);
  }
  return resendInstance;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export async function sendEmail(params: SendEmailParams): Promise<boolean> {
  try {
    const resend = getResendInstance();

    // Build email payload
    const emailPayload: any = {
      from: env.resend.fromEmail,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    };

    // Add attachments if provided
    if (params.attachments && params.attachments.length > 0) {
      emailPayload.attachments = params.attachments;
    }

    const { data, error } = await resend.emails.send(emailPayload);

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

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  resetUrl: string,
): Promise<boolean> {
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

export interface USDPaymentNotificationParams {
  adminEmail: string;
  customerName: string;
  customerEmail: string;
  paymentId: string;
  amountUSD: number;
  eventTitle?: string;
  ticketType: 'event_ticket' | 'season_ticket';
  paymentDate: Date;
}

export async function sendUSDPaymentNotification(
  params: USDPaymentNotificationParams,
): Promise<boolean> {
  const subject = `[Action Required] USD Payment Received - Invoice Pending`;

  const ticketTypeLabel =
    params.ticketType === 'season_ticket'
      ? 'Live Coverage Ticket'
      : 'Live Coverage Ticket';
  const serviceDescription = params.eventTitle || ticketTypeLabel;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>USD Payment Notification</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #8B1538 0%, #6B0F2B 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 24px;">USD Payment Received</h1>
      </div>

      <div style="background: #fff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <strong style="color: #856404;">⚠️ Action Required:</strong>
          <p style="margin: 5px 0 0 0; color: #856404;">A USD payment has been received. Please create the invoice manually using the admin panel.</p>
        </div>

        <h2 style="color: #8B1538; margin-top: 0;">Payment Details</h2>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold;">Customer Name:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${params.customerName}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold;">Customer Email:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${params.customerEmail}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold;">Payment ID:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${params.paymentId}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold;">Amount:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">$${params.amountUSD.toFixed(2)} USD</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold;">Service:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${serviceDescription}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold;">Payment Date:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${params.paymentDate.toLocaleString(
              'en-IN',
              {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              },
            )}</td>
          </tr>
        </table>

        <p style="margin-top: 20px;">Please log in to the admin panel to:</p>
        <ol style="line-height: 1.8;">
          <li>Enter the USD to INR exchange rate</li>
          <li>Generate the invoice</li>
          <li>Send the invoice to the customer</li>
        </ol>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${env.frontend.url}/admin/invoices/pending" style="background: #8B1538; color: #fff; padding: 14px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Go to Admin Panel</a>
        </div>
      </div>

      <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
        <p>© ${new Date().getFullYear()} Sankeertanotsav. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  const text = `
USD Payment Received - Action Required

A USD payment has been received and requires manual invoice generation.

Payment Details:
- Customer Name: ${params.customerName}
- Customer Email: ${params.customerEmail}
- Payment ID: ${params.paymentId}
- Amount: $${params.amountUSD.toFixed(2)} USD
- Service: ${serviceDescription}
- Payment Date: ${params.paymentDate.toLocaleString('en-IN')}

Please log in to the admin panel to:
1. Enter the USD to INR exchange rate
2. Generate the invoice
3. Send the invoice to the customer

Admin Panel: ${env.frontend.url}/admin/invoices/pending

© ${new Date().getFullYear()} Sankeertanotsav. All rights reserved.
  `;

  return sendEmail({
    to: params.adminEmail,
    subject,
    html,
    text,
  });
}
