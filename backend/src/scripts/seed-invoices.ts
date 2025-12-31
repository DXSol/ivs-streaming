import { pool } from '../db/pool';
import { ensureSchema } from '../db/schema';

// Generate invoice number: INV-YYYYMMDD-XXXX
async function generateInvoiceNumber(invoiceDate: Date): Promise<string> {
  const dateStr = invoiceDate.toISOString().slice(0, 10).replace(/-/g, '');
  
  // Get count of invoices for that date
  const { rows } = await pool.query(
    `SELECT COUNT(*) as count FROM invoices WHERE DATE(invoice_date) = DATE($1)`,
    [invoiceDate.toISOString()]
  );
  const count = parseInt(rows[0].count, 10) + 1;
  const paddedCount = count.toString().padStart(4, '0');
  
  return `INV-${dateStr}-${paddedCount}`;
}

async function main() {
  // Load dotenv the same way as the server
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../config/env');

  await ensureSchema();

  // Get company details from environment
  const companyName = 'DX Solutions';
  const companyAddress = '102, Maruthi Plaza, New Maruthi Nagar, Hyderabad, 500062';
  const companyPhone = 'Ph No.: +91 99595 55314';
  const companyGstin = '36ACUPP4439J1ZV';

  console.log('Starting invoice generation for existing purchases...');
  console.log(`Company: ${companyName}`);
  console.log(`GSTIN: ${companyGstin}`);

  // Get all successful payments that don't have invoices yet
  const paymentsResult = await pool.query(`
    SELECT 
      p.id as payment_id,
      p.user_id,
      p.event_id,
      p.amount_cents,
      p.currency,
      p.created_at,
      u.name as user_name,
      u.email as user_email,
      u.address as user_address,
      e.title as event_title
    FROM payments p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN events e ON p.event_id = e.id
    LEFT JOIN invoices i ON p.id = i.payment_id
    WHERE p.status = 'success' AND i.id IS NULL
    ORDER BY p.created_at ASC
  `);

  console.log(`Found ${paymentsResult.rows.length} payments without invoices`);

  let createdCount = 0;

  for (const payment of paymentsResult.rows) {
    try {
      const invoiceType = payment.event_id ? 'event_ticket' : 'season_ticket';
      const invoiceDate = new Date(payment.created_at);
      const invoiceNumber = await generateInvoiceNumber(invoiceDate);

      // Calculate GST (18% IGST - assuming inter-state)
      // Total = Subtotal + 18% GST
      // If amount is inclusive of GST: Subtotal = Total / 1.18, GST = Total - Subtotal
      const totalPaise = payment.amount_cents;
      const subtotalPaise = Math.round(totalPaise / 1.18);
      const igstPaise = totalPaise - subtotalPaise;

      await pool.query(
        `INSERT INTO invoices (
          invoice_number, user_id, payment_id, invoice_type, event_id,
          customer_name, customer_email, customer_address,
          subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise, currency,
          company_name, company_address, company_phone, company_gstin, invoice_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          invoiceNumber,
          payment.user_id,
          payment.payment_id,
          invoiceType,
          payment.event_id || null,
          payment.user_name || 'Customer',
          payment.user_email || '',
          payment.user_address || '',
          subtotalPaise,
          0, // CGST
          0, // SGST
          igstPaise,
          totalPaise,
          payment.currency || 'INR',
          companyName,
          companyAddress,
          companyPhone,
          companyGstin,
          invoiceDate.toISOString()
        ]
      );

      createdCount++;
      console.log(`Created invoice ${invoiceNumber} for ${payment.user_email} - ${invoiceType}${payment.event_title ? ` (${payment.event_title})` : ''}`);
    } catch (err: any) {
      console.error(`Failed to create invoice for payment ${payment.payment_id}:`, err.message);
    }
  }

  // Also check for paid tickets without payments (legacy data)
  const ticketsResult = await pool.query(`
    SELECT 
      t.user_id,
      t.event_id,
      t.created_at,
      u.name as user_name,
      u.email as user_email,
      u.address as user_address,
      e.title as event_title,
      e.price_paise
    FROM tickets t
    JOIN users u ON t.user_id = u.id
    JOIN events e ON t.event_id = e.id
    LEFT JOIN invoices i ON i.user_id = t.user_id AND i.event_id = t.event_id
    WHERE t.status = 'paid' AND i.id IS NULL AND e.event_type = 'paid'
    ORDER BY t.created_at ASC
  `);

  console.log(`Found ${ticketsResult.rows.length} paid tickets without invoices (legacy)`);

  for (const ticket of ticketsResult.rows) {
    try {
      const invoiceDate = new Date(ticket.created_at);
      const invoiceNumber = await generateInvoiceNumber(invoiceDate);

      const totalPaise = ticket.price_paise || 50000; // Default to 500 INR if no price
      const subtotalPaise = Math.round(totalPaise / 1.18);
      const igstPaise = totalPaise - subtotalPaise;

      await pool.query(
        `INSERT INTO invoices (
          invoice_number, user_id, payment_id, invoice_type, event_id,
          customer_name, customer_email, customer_address,
          subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise, currency,
          company_name, company_address, company_phone, company_gstin, invoice_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          invoiceNumber,
          ticket.user_id,
          null, // No payment record
          'event_ticket',
          ticket.event_id,
          ticket.user_name || 'Customer',
          ticket.user_email || '',
          ticket.user_address || '',
          subtotalPaise,
          0, // CGST
          0, // SGST
          igstPaise,
          totalPaise,
          'INR',
          companyName,
          companyAddress,
          companyPhone,
          companyGstin,
          invoiceDate.toISOString()
        ]
      );

      createdCount++;
      console.log(`Created invoice ${invoiceNumber} for ${ticket.user_email} - event_ticket (${ticket.event_title})`);
    } catch (err: any) {
      console.error(`Failed to create invoice for ticket ${ticket.user_id}/${ticket.event_id}:`, err.message);
    }
  }

  // Check for paid season tickets without invoices
  const seasonTicketsResult = await pool.query(`
    SELECT 
      st.user_id,
      st.purchased_at,
      u.name as user_name,
      u.email as user_email,
      u.address as user_address
    FROM season_tickets st
    JOIN users u ON st.user_id = u.id
    LEFT JOIN invoices i ON i.user_id = st.user_id AND i.invoice_type = 'season_ticket'
    WHERE st.status = 'paid' AND i.id IS NULL
    ORDER BY st.purchased_at ASC
  `);

  console.log(`Found ${seasonTicketsResult.rows.length} paid season tickets without invoices`);

  // Season ticket price (you may want to make this configurable)
  const seasonTicketPricePaise = 100000; // 1000 INR

  for (const seasonTicket of seasonTicketsResult.rows) {
    try {
      const invoiceDate = seasonTicket.purchased_at ? new Date(seasonTicket.purchased_at) : new Date();
      const invoiceNumber = await generateInvoiceNumber(invoiceDate);

      const totalPaise = seasonTicketPricePaise;
      const subtotalPaise = Math.round(totalPaise / 1.18);
      const igstPaise = totalPaise - subtotalPaise;

      await pool.query(
        `INSERT INTO invoices (
          invoice_number, user_id, payment_id, invoice_type, event_id,
          customer_name, customer_email, customer_address,
          subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise, currency,
          company_name, company_address, company_phone, company_gstin, invoice_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          invoiceNumber,
          seasonTicket.user_id,
          null, // No payment record
          'season_ticket',
          null, // No event
          seasonTicket.user_name || 'Customer',
          seasonTicket.user_email || '',
          seasonTicket.user_address || '',
          subtotalPaise,
          0, // CGST
          0, // SGST
          igstPaise,
          totalPaise,
          'INR',
          companyName,
          companyAddress,
          companyPhone,
          companyGstin,
          invoiceDate.toISOString()
        ]
      );

      createdCount++;
      console.log(`Created invoice ${invoiceNumber} for ${seasonTicket.user_email} - season_ticket`);
    } catch (err: any) {
      console.error(`Failed to create invoice for season ticket ${seasonTicket.user_id}:`, err.message);
    }
  }

  console.log(`\nInvoice generation complete. Created ${createdCount} invoices.`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('Invoice seed failed:', err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
