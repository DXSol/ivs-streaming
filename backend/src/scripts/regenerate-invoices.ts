import { pool } from '../db/pool';
import { ensureSchema } from '../db/schema';
import { env } from '../config/env';

// Cutoff date: 01-01-2026 19:00 IST (13:30 UTC)
const CUTOFF_DATE = new Date('2026-01-01T13:30:00.000Z');

// Generate invoice number based on date
// Before cutoff: XX/25-26 format (incremental/financial year)
// After cutoff: YYYY/MM/H/serial format
async function generateInvoiceNumber(invoiceDate: Date, isBeforeCutoff: boolean): Promise<string> {
  if (isBeforeCutoff) {
    // Old format: XX/25-26 (incremental number / financial year)
    // Start from 28 for DX Solutions invoices
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM invoices WHERE invoice_date < $1`,
      [CUTOFF_DATE.toISOString()]
    );
    const count = parseInt(rows[0].count, 10) + 28; // Start from 28
    return `${count}/25-26`;
  } else {
    // New format: YYYY/MM/H/serial
    const year = invoiceDate.getFullYear();
    const month = (invoiceDate.getMonth() + 1).toString().padStart(2, '0');
    
    // Get count of invoices after cutoff date
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM invoices WHERE invoice_date >= $1`,
      [CUTOFF_DATE.toISOString()]
    );
    const serial = parseInt(rows[0].count, 10) + 1;
    return `${year}/${month}/H/${serial}`;
  }
}

async function main() {
  await ensureSchema();

  // Get company details from centralized env config
  const companyName = env.company.name;
  const companyAddress = env.company.address;
  const companyPhone = env.company.phone;
  const companyGstin = env.company.gstin;
  const sacCode = env.company.sacCode;

  // Old company details for payments before 01-01-2026 19:00 IST
  const companyName_old = 'DX Solutions';
  const companyAddress_old = '102, Maruthi Plaza, New Maruthi Nagar, Hyderabad, 500062';
  const companyPhone_old = '+91 99595 55314';
  const companyGstin_old = '36ACUPP4439J1ZV';
  const sacCode_old = env.company.sacCode;

  console.log('=== Invoice Regeneration Script ===');
  console.log(`Company: ${companyName}`);
  console.log(`Address: ${companyAddress}`);
  console.log(`Phone: ${companyPhone}`);
  console.log(`GSTIN: ${companyGstin}`);
  console.log(`SAC Code: ${sacCode}`);
  console.log('');

  // Step 1: Delete all existing invoices
  console.log('Step 1: Deleting all existing invoices...');
  const deleteResult = await pool.query('DELETE FROM invoices');
  console.log(`Deleted ${deleteResult.rowCount} existing invoices`);
  console.log('');

  let createdCount = 0;

  // Step 2: Generate invoices for all successful payments
  console.log('Step 2: Generating invoices for successful payments...');
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
    WHERE p.status = 'success' AND p.provider = 'razorpay'
    ORDER BY p.created_at ASC
  `);

  console.log(`Found ${paymentsResult.rows.length} successful payments`);

  for (const payment of paymentsResult.rows) {
    try {
      const invoiceType = payment.event_id ? 'event_ticket' : 'season_ticket';
      const invoiceDate = new Date(payment.created_at);
      const isBeforeCutoff = invoiceDate < CUTOFF_DATE;
      const invoiceNumber = await generateInvoiceNumber(invoiceDate, isBeforeCutoff);

      // Calculate GST (18% split into CGST 9% + SGST 9% for intra-state)
      const totalPaise = payment.amount_cents;
      const subtotalPaise = Math.round(totalPaise / 1.18);
      const totalGstPaise = totalPaise - subtotalPaise;
      const cgstPaise = Math.round(totalGstPaise / 2);
      const sgstPaise = totalGstPaise - cgstPaise;

      // Use old company details for payments before cutoff date
      const useOldCompany = isBeforeCutoff;
      const invoiceCompanyName = useOldCompany ? companyName_old : companyName;
      const invoiceCompanyAddress = useOldCompany ? companyAddress_old : companyAddress;
      const invoiceCompanyPhone = useOldCompany ? companyPhone_old : companyPhone;
      const invoiceCompanyGstin = useOldCompany ? companyGstin_old : companyGstin;
      const invoiceSacCode = useOldCompany ? sacCode_old : sacCode;

      await pool.query(
        `INSERT INTO invoices (
          invoice_number, user_id, payment_id, invoice_type, event_id,
          customer_name, customer_email, customer_address,
          subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise, currency,
          company_name, company_address, company_phone, company_gstin, sac_code, invoice_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
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
          cgstPaise,
          sgstPaise,
          0, // IGST = 0 for intra-state
          totalPaise,
          payment.currency || 'INR',
          invoiceCompanyName,
          invoiceCompanyAddress,
          invoiceCompanyPhone,
          invoiceCompanyGstin,
          invoiceSacCode,
          invoiceDate.toISOString()
        ]
      );

      createdCount++;
      console.log(`  ✓ ${invoiceNumber} | ${payment.user_email} | ${invoiceType} | ₹${totalPaise / 100}`);
    } catch (err: any) {
      console.error(`  ✗ Failed for payment ${payment.payment_id}:`, err.message);
    }
  }

  // Note: Only generating invoices for payments with actual payment records.
  // Manually marked tickets/season tickets without payment records will NOT get invoices.
  console.log('');
  console.log('Note: Only payments with actual payment records get invoices.');
  console.log('Manually marked tickets without payment records are skipped.');
  console.log('');
  console.log('=== Invoice Regeneration Complete ===');
  console.log(`Total invoices created: ${createdCount}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('Invoice regeneration failed:', err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
