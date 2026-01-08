import { pool } from '../db/pool';
import { env } from '../config/env';
import { generateInvoicePDF, InvoiceData } from './pdf.service';
import { sendEmail } from './email.service';

/**
 * Sends invoice PDF via email to configured recipients and customer
 * @param invoiceId - UUID of the invoice
 * @returns Promise<boolean> - true if at least one email was sent successfully
 */
export async function sendInvoiceEmail(invoiceId: string): Promise<boolean> {
  try {
    console.log(`[Invoice Email] Processing invoice ${invoiceId}...`);

    // Fetch invoice data from database
    const { rows } = await pool.query(
      `SELECT
        i.id, i.invoice_number, i.invoice_date, i.invoice_type, i.event_id,
        i.customer_name, i.customer_email, i.customer_address,
        i.subtotal_paise, i.cgst_paise, i.sgst_paise, i.igst_paise,
        i.total_paise, i.currency,
        i.company_name, i.company_address, i.company_phone, i.company_gstin, i.sac_code,
        i.company_cin, i.company_pan, i.company_email, i.company_registration_number, i.company_udyam_number,
        i.company_state_code, i.company_state_name, i.company_bank_name, i.company_bank_account_number,
        i.company_bank_ifsc_code, i.company_bank_branch,
        e.title as event_title,
        p.provider_payment_id as razorpay_payment_id,
        p.created_at as payment_date
      FROM invoices i
      LEFT JOIN events e ON i.event_id = e.id
      LEFT JOIN payments p ON i.payment_id = p.id
      WHERE i.id = $1`,
      [invoiceId],
    );

    if (rows.length === 0) {
      console.error(`[Invoice Email] Invoice ${invoiceId} not found`);
      return false;
    }

    const invoice = rows[0];

    // Prepare invoice data for PDF generation
    const invoiceData: InvoiceData = {
      invoiceNumber: invoice.invoice_number,
      invoiceDate: new Date(invoice.invoice_date),
      customerName: invoice.customer_name || 'Customer',
      customerEmail: invoice.customer_email || '',
      customerAddress: invoice.customer_address || '',
      eventTitle: invoice.event_title || undefined,
      invoiceType: invoice.invoice_type as 'event_ticket' | 'season_ticket',
      subtotalPaise: invoice.subtotal_paise,
      cgstPaise: invoice.cgst_paise,
      sgstPaise: invoice.sgst_paise,
      igstPaise: invoice.igst_paise,
      totalPaise: invoice.total_paise,
      currency: invoice.currency || 'INR',
      companyName: invoice.company_name,
      companyAddress: invoice.company_address,
      companyPhone: invoice.company_phone,
      companyGstin: invoice.company_gstin,
      sacCode: invoice.sac_code || '999629',
      companyCin: invoice.company_cin || undefined,
      companyPan: invoice.company_pan || undefined,
      companyEmail: invoice.company_email || undefined,
      companyRegistrationNumber:
        invoice.company_registration_number || undefined,
      companyUdyamNumber: invoice.company_udyam_number || undefined,
      companyStateCode: invoice.company_state_code || undefined,
      companyStateName: invoice.company_state_name || undefined,
      companyBankName: invoice.company_bank_name || undefined,
      companyBankAccountNumber:
        invoice.company_bank_account_number || undefined,
      companyBankIfscCode: invoice.company_bank_ifsc_code || undefined,
      companyBankBranch: invoice.company_bank_branch || undefined,
      razorpayPaymentId: invoice.razorpay_payment_id || undefined,
      paymentDate: invoice.payment_date
        ? new Date(invoice.payment_date)
        : undefined,
    };

    // Generate PDF
    console.log(
      `[Invoice Email] Generating PDF for invoice ${invoice.invoice_number}...`,
    );
    const pdfBuffer = await generateInvoicePDF(invoiceData);
    console.log(`[Invoice Email] PDF generated (${pdfBuffer.length} bytes)`);

    // Prepare email content
    const subject = `Tax Invoice - ${invoice.invoice_number}`;
    const totalAmount = (invoice.total_paise / 100).toFixed(2);
    const invoiceTypeLabel =
      invoice.invoice_type === 'season_ticket'
        ? 'Live Coverage Ticket'
        : 'Live Coverage Ticket';
    const eventInfo = invoice.event_title ? ` - ${invoice.event_title}` : '';
    const invoiceDateFormatted = new Date(
      invoice.invoice_date,
    ).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #8B1538 0%, #6B0F2B 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 24px;">Sankeertanotsav</h1>
        </div>

        <div style="background: #fff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
          <h2 style="color: #8B1538; margin-top: 0;">Tax Invoice</h2>

          <p>Dear ${invoice.customer_name || 'Customer'},</p>

          <p>Thank you for your purchase. Your tax invoice is ready and attached to this email.</p>

          <div style="background: #f9f9f9; padding: 15px; margin: 20px 0; border-left: 4px solid #8B1538;">
            <p style="margin: 5px 0;"><strong>Invoice Number:</strong> ${invoice.invoice_number}</p>
            <p style="margin: 5px 0;"><strong>Invoice Date:</strong> ${invoiceDateFormatted}</p>
            <p style="margin: 5px 0;"><strong>Type:</strong> ${invoiceTypeLabel}${eventInfo}</p>
            <p style="margin: 5px 0;"><strong>Amount:</strong> ₹${totalAmount} (inclusive of GST)</p>
          </div>

          <p>Please find your tax invoice attached as a PDF file. You can download and save it for your records.</p>

          <p style="color: #666; font-size: 14px; margin-top: 30px;">If you have any questions about this invoice, please don't hesitate to contact us.</p>

          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

          <p style="color: #999; font-size: 12px; text-align: center;">
            This is an automated email. Please do not reply to this message.
          </p>
        </div>

        <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
          <p>© ${new Date().getFullYear()} Sankeertanotsav. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;

    const text = `
Tax Invoice - ${invoice.invoice_number}

Dear ${invoice.customer_name || 'Customer'},

Thank you for your purchase. Your tax invoice is ready and attached to this email.

Invoice Details:
- Invoice Number: ${invoice.invoice_number}
- Invoice Date: ${invoiceDateFormatted}
- Type: ${invoiceTypeLabel}${eventInfo}
- Amount: ₹${totalAmount} (inclusive of GST)

Please find your tax invoice attached as a PDF file.

© ${new Date().getFullYear()} Sankeertanotsav. All rights reserved.
    `;

    // Prepare PDF attachment
    const attachments = [
      {
        filename: `Invoice-${invoice.invoice_number.replace(/\//g, '-')}.pdf`,
        content: pdfBuffer,
      },
    ];

    // Send email to configured recipients
    let configuredEmailsSent = 0;
    const recipientEmails = env.invoices.recipientEmails;

    if (recipientEmails && recipientEmails.length > 0) {
      for (const recipientEmail of recipientEmails) {
        console.log(
          `[Invoice Email] Sending to configured recipient: ${recipientEmail}`,
        );
        const success = await sendEmail({
          to: recipientEmail,
          subject,
          html,
          text,
          attachments,
        });

        if (success) {
          configuredEmailsSent++;
          console.log(`[Invoice Email] Sent to ${recipientEmail} successfully`);
        } else {
          console.error(`[Invoice Email] Failed to send to ${recipientEmail}`);
        }
      }
    } else {
      console.log(
        '[Invoice Email] No configured recipient emails found (INVOICE_RECIPIENT_EMAILS not set)',
      );
    }

    // Send email to customer if email is available
    let customerEmailSent = false;
    if (invoice.customer_email && invoice.customer_email.trim() !== '') {
      console.log(
        `[Invoice Email] Sending to customer: ${invoice.customer_email}`,
      );
      customerEmailSent = await sendEmail({
        to: invoice.customer_email,
        subject,
        html,
        text,
        attachments,
      });

      if (customerEmailSent) {
        console.log(
          `[Invoice Email] Sent to customer ${invoice.customer_email} successfully`,
        );
      } else {
        console.error(
          `[Invoice Email] Failed to send to customer ${invoice.customer_email}`,
        );
      }
    } else {
      console.log(
        '[Invoice Email] Customer email not available, skipping customer notification',
      );
    }

    // Consider success if at least one email was sent
    const totalEmailsSent = configuredEmailsSent + (customerEmailSent ? 1 : 0);

    if (totalEmailsSent > 0) {
      console.log(
        `[Invoice Email] Successfully sent ${totalEmailsSent} email(s) for invoice ${invoice.invoice_number}`,
      );
      return true;
    } else {
      console.error(
        `[Invoice Email] Failed to send any emails for invoice ${invoice.invoice_number}`,
      );
      return false;
    }
  } catch (error) {
    console.error(
      `[Invoice Email] Error sending invoice email for ${invoiceId}:`,
      error,
    );
    return false;
  }
}
