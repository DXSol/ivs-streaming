import { pool } from '../db/pool';
import { ensureSchema } from '../db/schema';
import { env } from '../config/env';

// Cutoff date: 01-01-2026 19:00 IST (13:30 UTC)
const CUTOFF_DATE = new Date('2026-01-01T13:30:00.000Z');

// Generate invoice number based on date
// Before cutoff: XX/25-26 format (incremental/financial year)
// After cutoff: YYYYMMH{serial} format (removed slashes)
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
    // New format: YYYYMMH{serial} (removed slashes)
    const year = invoiceDate.getFullYear();
    const month = (invoiceDate.getMonth() + 1).toString().padStart(2, '0');

    // Get count of invoices after cutoff date
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM invoices WHERE invoice_date >= $1`,
      [CUTOFF_DATE.toISOString()]
    );
    const serial = parseInt(rows[0].count, 10) + 1;
    return `${year}${month}H${serial}`;
  }
}

async function main() {
  await ensureSchema();

  console.log('=== Invoice Regeneration Script ===');
  console.log('New Company (HOPE):', env.company.name);
  console.log('Old Company (DX Solutions):', env.companyOld.name);
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
      // Split GST exactly equally into CGST and SGST (9% each)
      // To ensure they are exactly equal, calculate directly from subtotal
      const cgstPaise = Math.round(subtotalPaise * 0.09);
      const sgstPaise = Math.round(subtotalPaise * 0.09);

      // Recalculate total to be exactly subtotal + cgst + sgst
      // This ensures we never charge more than the calculated taxes (rounding adjustment will be negative or zero)
      const finalTotalPaise = subtotalPaise + cgstPaise + sgstPaise;

      // Use old company details for payments before cutoff date
      const useOldCompany = isBeforeCutoff;
      const companyDetails = useOldCompany ? env.companyOld : env.company;

      await pool.query(
        `INSERT INTO invoices (
          invoice_number, user_id, payment_id, invoice_type, event_id,
          customer_name, customer_email, customer_address,
          subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise, currency,
          company_name, company_address, company_phone, company_gstin, sac_code,
          company_cin, company_pan, company_email, company_registration_number, company_udyam_number,
          company_state_code, company_state_name, company_bank_name, company_bank_account_number,
          company_bank_ifsc_code, company_bank_branch, invoice_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                  $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)`,
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
          totalPaise, // Use actual payment amount, not calculated sum
          payment.currency || 'INR',
          companyDetails.name,
          companyDetails.address,
          companyDetails.phone,
          companyDetails.gstin,
          companyDetails.sacCode,
          companyDetails.cin,
          companyDetails.pan,
          companyDetails.email,
          companyDetails.registrationNumber,
          companyDetails.udyamNumber,
          companyDetails.stateCode,
          companyDetails.stateName,
          companyDetails.bankName,
          companyDetails.bankAccountNumber,
          companyDetails.bankIfscCode,
          companyDetails.bankBranch,
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
