import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { env } from '../config/env';
import { sendInvoiceEmail } from '../services/invoice-email.service';

const router = Router();

// Cutoff date: 01-01-2026 19:00 IST (13:30 UTC)
const CUTOFF_DATE = new Date('2026-01-01T13:30:00.000Z');

// Helper to generate invoice number
// New format after cutoff: YYYY/MM/H/serial
async function generateInvoiceNumber(): Promise<string> {
  const today = new Date();
  const year = today.getFullYear();
  const month = (today.getMonth() + 1).toString().padStart(2, '0');
  
  // Get count of invoices after cutoff date
  const { rows } = await pool.query(
    `SELECT COUNT(*) as count FROM invoices WHERE invoice_date >= $1`,
    [CUTOFF_DATE.toISOString()]
  );
  const serial = parseInt(rows[0].count, 10) + 1;
  return `${year}/${month}/H/${serial}`;
}

// Create invoice after successful payment
export async function createInvoice(params: {
  userId: string;
  paymentId: string;
  invoiceType: 'event_ticket' | 'season_ticket';
  eventId?: string;
  amountPaise: number;
  currency: string;
}): Promise<{ id: string; invoice_number: string }> {
  const { userId, paymentId, invoiceType, eventId, amountPaise, currency } = params;
  
  // Check if invoice already exists for this payment
  const existingInvoice = await pool.query(
    'SELECT id, invoice_number FROM invoices WHERE payment_id = $1',
    [paymentId]
  );
  if (existingInvoice.rows.length > 0) {
    console.log(`[createInvoice] Invoice already exists for payment ${paymentId}: ${existingInvoice.rows[0].invoice_number}`);
    return existingInvoice.rows[0];
  }
  
  // Get user details
  const userResult = await pool.query(
    'SELECT name, email, address FROM users WHERE id = $1',
    [userId]
  );
  const user = userResult.rows[0];
  
  // Get company details from centralized env config
  const companyName = env.company.name;
  const companyAddress = env.company.address;
  const companyPhone = env.company.phone;
  const companyGstin = env.company.gstin;
  const sacCode = env.company.sacCode;
  
  // Debug logging for invoice company details
  console.log('[createInvoice] Company details from env:', {
    companyName,
    companyAddress,
    companyPhone,
    companyGstin,
    sacCode,
  });
  
  // Calculate GST (18% for digital services in India)
  // Split into CGST 9% + SGST 9% (intra-state)
  // Total = Subtotal + 18% GST
  // If amount is inclusive of GST: Subtotal = Total / 1.18, GST = Total - Subtotal
  const totalPaise = amountPaise;
  const subtotalPaise = Math.round(totalPaise / 1.18);
  const totalGstPaise = totalPaise - subtotalPaise;
  // Split GST equally into CGST and SGST (9% each)
  const cgstPaise = Math.round(totalGstPaise / 2);
  const sgstPaise = totalGstPaise - cgstPaise; // Ensure no rounding loss
  
  const invoiceNumber = await generateInvoiceNumber();
  
  const { rows } = await pool.query(
    `INSERT INTO invoices (
      invoice_number, user_id, payment_id, invoice_type, event_id,
      customer_name, customer_email, customer_address,
      subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise, currency,
      company_name, company_address, company_phone, company_gstin, sac_code
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING id, invoice_number`,
    [
      invoiceNumber, userId, paymentId, invoiceType, eventId || null,
      user?.name || 'Customer', user?.email || '', user?.address || '',
      subtotalPaise, cgstPaise, sgstPaise, 0, totalPaise, currency,
      companyName, companyAddress, companyPhone, companyGstin, sacCode
    ]
  );

  const invoiceId = rows[0].id;
  const invoiceNum = rows[0].invoice_number;

  // Send invoice email (non-blocking - don't wait for email to complete)
  // This ensures payment confirmation is not delayed by email sending
  sendInvoiceEmail(invoiceId)
    .then(success => {
      if (success) {
        console.log(`[createInvoice] Invoice email sent successfully for ${invoiceNum}`);
      } else {
        console.error(`[createInvoice] Failed to send invoice email for ${invoiceNum}`);
      }
    })
    .catch(err => {
      console.error(`[createInvoice] Error sending invoice email for ${invoiceNum}:`, err);
    });

  return rows[0];
}

// GET /invoices - Get all invoices for the authenticated user
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  
  try {
    const { rows } = await pool.query(
      `SELECT 
        i.id, i.invoice_number, i.invoice_type, i.event_id,
        i.customer_name, i.subtotal_paise, i.cgst_paise, i.sgst_paise, i.igst_paise,
        i.total_paise, i.currency, i.company_name, i.company_address, i.company_phone, i.company_gstin, i.sac_code,
        i.invoice_date, i.created_at,
        e.title as event_title
      FROM invoices i
      LEFT JOIN events e ON i.event_id = e.id
      WHERE i.user_id = $1
      ORDER BY i.invoice_date DESC`,
      [userId]
    );
    
    res.json({ invoices: rows });
  } catch (err: any) {
    console.error('Failed to fetch invoices:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// GET /invoices/:id - Get a specific invoice
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const invoiceId = req.params.id;
  
  try {
    const { rows } = await pool.query(
      `SELECT 
        i.id, i.invoice_number, i.invoice_type, i.event_id,
        i.customer_name, i.customer_email, i.customer_address,
        i.subtotal_paise, i.cgst_paise, i.sgst_paise, i.igst_paise,
        i.total_paise, i.currency, i.company_name, i.company_address, i.company_phone, i.company_gstin, i.sac_code,
        i.invoice_date, i.created_at,
        e.title as event_title
      FROM invoices i
      LEFT JOIN events e ON i.event_id = e.id
      WHERE i.id = $1 AND i.user_id = $2`,
      [invoiceId, userId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    res.json({ invoice: rows[0] });
  } catch (err: any) {
    console.error('Failed to fetch invoice:', err);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// GET /invoices/admin/statement - Get all invoices for admin (with filters)
router.get('/admin/statement', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, eventId } = req.query;
    
    let query = `
      SELECT 
        i.id, i.invoice_number, i.invoice_date, i.invoice_type, i.event_id,
        i.customer_name, i.subtotal_paise, i.cgst_paise, i.sgst_paise, i.igst_paise,
        i.total_paise, i.currency,
        e.title as event_title,
        p.provider_payment_id as razorpay_payment_id
      FROM invoices i
      LEFT JOIN events e ON i.event_id = e.id
      LEFT JOIN payments p ON i.payment_id = p.id
      WHERE i.total_paise > 0
    `;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (startDate) {
      query += ` AND i.invoice_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND i.invoice_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    if (eventId) {
      query += ` AND i.event_id = $${paramIndex}`;
      params.push(eventId);
      paramIndex++;
    }
    
    query += ` ORDER BY i.invoice_date DESC`;
    
    const { rows } = await pool.query(query, params);
    
    // Calculate totals
    const totals = rows.reduce((acc, inv) => {
      acc.subtotal += inv.subtotal_paise;
      acc.gst += (inv.cgst_paise + inv.sgst_paise + inv.igst_paise);
      acc.total += inv.total_paise;
      return acc;
    }, { subtotal: 0, gst: 0, total: 0 });
    
    res.json({ 
      invoices: rows,
      totals: {
        subtotal_paise: totals.subtotal,
        gst_paise: totals.gst,
        total_paise: totals.total,
        count: rows.length
      }
    });
  } catch (err: any) {
    console.error('Failed to fetch invoice statement:', err);
    res.status(500).json({ error: 'Failed to fetch invoice statement' });
  }
});

// GET /invoices/admin/export - Export invoices as CSV
router.get('/admin/export', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, eventId } = req.query;
    
    let query = `
      SELECT 
        i.invoice_number, i.invoice_date, i.invoice_type,
        i.customer_name, i.subtotal_paise, i.cgst_paise, i.sgst_paise, i.igst_paise,
        i.total_paise, i.currency,
        e.title as event_title,
        p.provider_payment_id as razorpay_payment_id
      FROM invoices i
      LEFT JOIN events e ON i.event_id = e.id
      LEFT JOIN payments p ON i.payment_id = p.id
      WHERE i.total_paise > 0
    `;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (startDate) {
      query += ` AND i.invoice_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND i.invoice_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    if (eventId) {
      query += ` AND i.event_id = $${paramIndex}`;
      params.push(eventId);
      paramIndex++;
    }
    
    query += ` ORDER BY i.invoice_date DESC`;
    
    const { rows } = await pool.query(query, params);
    
    // Generate CSV
    const headers = ['Inv No', 'Date', 'Name', 'Event Name', 'Amount (₹)', 'GST (₹)', 'Net Amount (₹)', 'Payment Gateway Reference'];
    const csvRows = [headers.join(',')];
    
    for (const inv of rows) {
      const date = new Date(inv.invoice_date).toLocaleDateString('en-IN');
      const amount = (inv.subtotal_paise / 100).toFixed(2);
      const gst = ((inv.cgst_paise + inv.sgst_paise + inv.igst_paise) / 100).toFixed(2);
      const netAmount = (inv.total_paise / 100).toFixed(2);
      const eventName = inv.invoice_type === 'season_ticket' ? 'Season Ticket' : (inv.event_title || 'N/A');
      
      const row = [
        inv.invoice_number,
        date,
        `"${inv.customer_name || ''}"`,
        `"${eventName}"`,
        amount,
        gst,
        netAmount,
        inv.razorpay_payment_id || 'N/A'
      ];
      csvRows.push(row.join(','));
    }
    
    const csv = csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-statement-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  } catch (err: any) {
    console.error('Failed to export invoices:', err);
    res.status(500).json({ error: 'Failed to export invoices' });
  }
});

export default router;
