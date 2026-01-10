import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { requireAuth, requireRole, requireSuperAdmin } from '../middleware/auth';
import { getStreamStatus } from '../services/ivs.service';

const router = Router();

// GET /admin/events/dashboard - Get all events with stats for admin dashboard
router.get('/events/dashboard', requireAuth, requireRole(['admin', 'superadmin', 'finance-admin', 'content-admin']), async (_req, res) => {
  try {
    // Get all events with aggregated stats
    const { rows: events } = await pool.query(`
      SELECT 
        e.id,
        e.title,
        e.description,
        e.starts_at,
        e.ends_at,
        e.ivs_channel_arn,
        e.poster_url,
        (SELECT COUNT(*) FROM tickets t WHERE t.event_id = e.id AND t.status = 'paid') as paid_tickets,
        (SELECT COUNT(*) FROM tickets t WHERE t.event_id = e.id AND t.status = 'pending') as pending_tickets,
        (SELECT COUNT(*) FROM event_comments c WHERE c.event_id = e.id) as total_comments,
        (SELECT MAX(viewer_count) FROM event_viewer_stats vs WHERE vs.event_id = e.id) as peak_viewers,
        (SELECT viewer_count FROM event_viewer_stats vs WHERE vs.event_id = e.id ORDER BY recorded_at DESC LIMIT 1) as last_viewer_count
      FROM events e
      ORDER BY e.starts_at DESC
    `);

    // Check live status for each event
    const eventsWithStatus = await Promise.all(
      events.map(async (event: any) => {
        let isLive = false;
        let currentViewers = 0;

        if (event.ivs_channel_arn) {
          try {
            const status = await getStreamStatus(event.ivs_channel_arn);
            isLive = status.isLive;
            currentViewers = status.viewerCount;
          } catch {
            // Ignore errors
          }
        }

        return {
          ...event,
          is_live: isLive,
          current_viewers: currentViewers,
        };
      })
    );

    return res.json({ events: eventsWithStatus });
  } catch (err: any) {
    console.error('Failed to get dashboard data:', err);
    return res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});

// GET /admin/events/:id/viewer-stats - Get viewer stats history for an event
router.get('/events/:id/viewer-stats', requireAuth, requireRole(['admin', 'superadmin', 'finance-admin', 'content-admin']), async (req, res) => {
  const eventId = req.params.id;

  try {
    const { rows } = await pool.query(
      `SELECT viewer_count, recorded_at 
       FROM event_viewer_stats 
       WHERE event_id = $1 
       ORDER BY recorded_at ASC`,
      [eventId]
    );

    return res.json({ stats: rows });
  } catch (err: any) {
    console.error('Failed to get viewer stats:', err);
    return res.status(500).json({ error: 'Failed to get viewer stats' });
  }
});

// GET /admin/subscriptions
router.get('/subscriptions', requireAuth, requireRole(['admin']), async (_req, res) => {
  // Cross join users with events to show all possible combinations
  // Left join with tickets to get current status (null if no ticket exists)
  // Left join with season_tickets to get season ticket info
  const { rows } = await pool.query(
    `SELECT
       u.id as user_id,
       u.email as user_email,
       u.name as user_name,
       u.mobile as user_mobile,
       u.country as user_country,
       e.id as event_id,
       e.title as event_title,
       e.starts_at as event_starts_at,
       COALESCE(t.status, 'none') as ticket_status,
       t.created_at as subscribed_at,
       (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'success') as total_paid_cents,
       st.status as season_ticket_status,
       st.purchased_at as season_ticket_purchased_at
     FROM users u
     CROSS JOIN events e
     LEFT JOIN tickets t ON t.user_id = u.id AND t.event_id = e.id
     LEFT JOIN season_tickets st ON st.user_id = u.id
     WHERE u.role = 'viewer'
     ORDER BY u.email ASC, e.starts_at DESC`
  );

  return res.json({ subscriptions: rows });
});

const setTicketStatusSchema = z.object({
  userId: z.string().uuid(),
  eventId: z.string().uuid(),
  paid: z.boolean(),
  amountCents: z.number().int().nonnegative().optional(),
  currency: z.string().min(1).optional(),
  note: z.string().max(2000).optional(),
});

// POST /admin/ticket-status
router.post('/ticket-status', requireAuth, requireRole(['admin']), async (req, res) => {
  const parsed = setTicketStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { userId, eventId, paid, amountCents, currency, note } = parsed.data;
  const nextStatus = paid ? 'paid' : 'pending';

  await pool.query(
    `INSERT INTO tickets (user_id, event_id, status)
     VALUES ($1,$2,$3)
     ON CONFLICT (user_id, event_id) DO UPDATE SET status = EXCLUDED.status`,
    [userId, eventId, nextStatus]
  );

  if (paid) {
    const providerPaymentId = `manual:${eventId}:${userId}:${Date.now()}`;
    await pool.query(
      `INSERT INTO payments (provider, provider_payment_id, user_id, event_id, amount_cents, currency, status, raw_payload)
       VALUES ('manual',$1,$2,$3,$4,$5,'success',$6)
       ON CONFLICT (provider, provider_payment_id) DO NOTHING`,
      [
        providerPaymentId,
        userId,
        eventId,
        amountCents ?? 0,
        currency ?? 'INR',
        { note: note ?? null, markedBy: req.user?.email ?? null },
      ]
    );
  }

  return res.json({ ok: true, userId, eventId, status: nextStatus });
});

const markPaidSchema = z.object({
  eventId: z.string().uuid(),
  userEmail: z.string().email(),
  amountCents: z.number().int().nonnegative().optional(),
  currency: z.string().min(1).optional(),
  note: z.string().max(2000).optional(),
});

// POST /admin/mark-paid
router.post('/mark-paid', requireAuth, requireRole(['admin']), async (req, res) => {
  const parsed = markPaidSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { eventId, userEmail, amountCents, currency } = parsed.data;

  const userResult = await pool.query('SELECT id, email FROM users WHERE email = $1', [userEmail]);
  const user = userResult.rows[0] as { id: string; email: string } | undefined;
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const eventResult = await pool.query('SELECT id FROM events WHERE id = $1', [eventId]);
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  await pool.query(
    `INSERT INTO tickets (user_id, event_id, status)
     VALUES ($1,$2,'paid')
     ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'paid'`,
    [user.id, eventId]
  );

  const providerPaymentId = `manual:${eventId}:${user.id}:${Date.now()}`;

  await pool.query(
    `INSERT INTO payments (provider, provider_payment_id, user_id, event_id, amount_cents, currency, status, raw_payload)
     VALUES ('manual',$1,$2,$3,$4,$5,'success',$6)
     ON CONFLICT (provider, provider_payment_id) DO NOTHING`,
    [
      providerPaymentId,
      user.id,
      eventId,
      amountCents ?? 0,
      currency ?? 'INR',
      { note: parsed.data.note ?? null, markedBy: req.user?.email ?? null },
    ]
  );

  return res.status(201).json({ ok: true, userId: user.id, eventId });
});

// POST /admin/season-ticket-status - Toggle season ticket status for a user
const setSeasonTicketStatusSchema = z.object({
  userId: z.string().uuid(),
  paid: z.boolean(),
});

router.post('/season-ticket-status', requireAuth, requireRole(['admin']), async (req, res) => {
  const parsed = setSeasonTicketStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { userId, paid } = parsed.data;

  try {
    if (paid) {
      // Create or update season ticket as paid
      await pool.query(
        `INSERT INTO season_tickets (user_id, status, purchased_at)
         VALUES ($1, 'paid', NOW())
         ON CONFLICT (user_id) DO UPDATE SET status = 'paid', purchased_at = COALESCE(season_tickets.purchased_at, NOW())`,
        [userId]
      );
    } else {
      // Remove season ticket
      await pool.query('DELETE FROM season_tickets WHERE user_id = $1', [userId]);
    }

    return res.json({ ok: true, userId, seasonTicketStatus: paid ? 'paid' : null });
  } catch (err: any) {
    console.error('Failed to update season ticket status:', err);
    return res.status(500).json({ error: 'Failed to update season ticket status' });
  }
});

// DELETE /admin/subscription - Delete a subscription (ticket)
router.delete('/subscription', requireAuth, requireRole(['admin']), async (req, res) => {
  const { userId, eventId } = req.query;

  if (!userId || !eventId) {
    return res.status(400).json({ error: 'userId and eventId are required' });
  }

  try {
    await pool.query(
      'DELETE FROM tickets WHERE user_id = $1 AND event_id = $2',
      [userId, eventId]
    );

    return res.json({ ok: true, message: 'Subscription deleted' });
  } catch (err: any) {
    console.error('Failed to delete subscription:', err);
    return res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

// DELETE /admin/user/:userId - Delete a user and all their data
router.delete('/user/:userId', requireAuth, requireRole(['admin']), async (req, res) => {
  const userId = req.params.userId;

  try {
    // Delete in order to respect foreign key constraints
    await pool.query('DELETE FROM tickets WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM season_tickets WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM payments WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM event_comments WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM ivs_access_logs WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    return res.json({ ok: true, message: 'User deleted' });
  } catch (err: any) {
    console.error('Failed to delete user:', err);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  mobile: z.string().min(1).max(20).optional(),
  country: z.string().max(100).optional(),
});

// PUT /admin/user/:userId - Update user details
router.put('/user/:userId', requireAuth, requireRole(['admin']), async (req, res) => {
  const userId = req.params.userId;
  const parsed = updateUserSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
  }

  const updates = parsed.data;

  try {
    // Check if user exists
    const existing = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build dynamic update query
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.email !== undefined) {
      setClauses.push(`email = $${paramIndex++}`);
      values.push(updates.email);
    }
    if (updates.mobile !== undefined) {
      setClauses.push(`mobile = $${paramIndex++}`);
      values.push(updates.mobile);
    }
    if (updates.country !== undefined) {
      setClauses.push(`country = $${paramIndex++}`);
      values.push(updates.country || null);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(userId);
    const { rows } = await pool.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, email, name, mobile, country, role`,
      values
    );

    return res.json({ user: rows[0] });
  } catch (err: any) {
    console.error('Failed to update user:', err);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

// GET /admin/pending-usd-invoices - Get all USD payments pending invoice generation
router.get('/pending-usd-invoices', requireAuth, requireRole(['admin']), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id as payment_id,
        p.amount_cents,
        p.currency,
        p.created_at as payment_date,
        p.provider_payment_id,
        u.id as user_id,
        u.name as user_name,
        u.email as user_email,
        u.country,
        e.id as event_id,
        e.title as event_title
      FROM payments p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN events e ON p.event_id = e.id
      WHERE p.currency = 'USD'
        AND p.status = 'success'
        AND p.invoice_pending = true
      ORDER BY p.created_at DESC
    `);

    res.json({ pendingInvoices: rows });
  } catch (err: any) {
    console.error('Failed to get pending USD invoices:', err);
    return res.status(500).json({ error: 'Failed to get pending USD invoices' });
  }
});

// POST /admin/invoices/create-for-usd-payment - Create invoice for USD payment with INR amount
router.post('/invoices/create-for-usd-payment', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const schema = z.object({
      paymentId: z.string().uuid(),
      amountInrPaise: z.number().int().positive(),
      exchangeRate: z.number().positive().optional(),
    });

    const { paymentId, amountInrPaise, exchangeRate } = schema.parse(req.body);

    // Get payment details
    const paymentResult = await pool.query(
      `SELECT p.*, u.name, u.email, u.address, e.title as event_title
       FROM payments p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN events e ON p.event_id = e.id
       WHERE p.id = $1 AND p.currency = 'USD' AND p.status = 'success'`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'USD payment not found' });
    }

    const payment = paymentResult.rows[0];

    // Check if invoice already exists
    const existingInvoice = await pool.query(
      'SELECT id, invoice_number FROM invoices WHERE payment_id = $1',
      [paymentId]
    );

    if (existingInvoice.rows.length > 0) {
      return res.status(400).json({
        error: 'Invoice already exists for this payment',
        invoice: existingInvoice.rows[0]
      });
    }

    // Import createInvoice function
    const { createInvoice } = await import('./invoices');

    // Temporarily change currency to INR and amount to converted amount
    // Then call createInvoice with INR currency
    const invoiceType = payment.event_id ? 'event_ticket' : 'season_ticket';

    const invoice = await createInvoice({
      userId: payment.user_id,
      paymentId: paymentId,
      invoiceType: invoiceType as 'event_ticket' | 'season_ticket',
      eventId: payment.event_id || undefined,
      amountPaise: amountInrPaise,
      currency: 'INR', // Force INR for USD payments converted by admin
    });

    if (!invoice) {
      return res.status(500).json({ error: 'Failed to create invoice' });
    }

    // Update payment with exchange rate and mark invoice_pending as false
    await pool.query(
      'UPDATE payments SET exchange_rate = $1, invoice_pending = false WHERE id = $2',
      [exchangeRate || null, paymentId]
    );

    console.log(`[Admin] Created invoice ${invoice.invoice_number} for USD payment ${paymentId} with INR amount ${amountInrPaise/100}`);

    res.json({
      success: true,
      invoice: invoice,
      message: `Invoice ${invoice.invoice_number} created successfully`
    });
  } catch (err: any) {
    console.error('Failed to create invoice for USD payment:', err);
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Failed to create invoice for USD payment' });
  }
});

// GET /admin/users - List all admin users (superadmin only)
router.get('/users', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, mobile, role, is_active, created_at
       FROM users
       WHERE role IN ('admin', 'superadmin', 'finance-admin', 'content-admin')
       ORDER BY created_at DESC`
    );

    res.json({ users: rows });
  } catch (err: any) {
    console.error('Failed to list admin users:', err);
    return res.status(500).json({ error: 'Failed to list admin users' });
  }
});

// POST /admin/users - Create a new admin user (superadmin only)
const createAdminUserSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  mobile: z.string().min(1),
  password: z.string().min(6),
  role: z.enum(['admin', 'finance-admin', 'content-admin']),
});

router.post('/users', requireAuth, requireSuperAdmin, async (req, res) => {
  const parsed = createAdminUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
  }

  const { name, email, mobile, password, role } = parsed.data;

  try {
    // Check if email already exists
    const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Check if mobile already exists
    const existingMobile = await pool.query('SELECT id FROM users WHERE mobile = $1', [mobile]);
    if (existingMobile.rows.length > 0) {
      return res.status(400).json({ error: 'User with this mobile number already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role, name, mobile, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW())
       RETURNING id, name, email, mobile, role, is_active, created_at`,
      [email, passwordHash, role, name, mobile]
    );

    res.status(201).json({ user: rows[0] });
  } catch (err: any) {
    console.error('Failed to create admin user:', err);
    return res.status(500).json({ error: 'Failed to create admin user' });
  }
});

// PUT /admin/users/:userId/role - Update user role (superadmin only)
const updateUserRoleSchema = z.object({
  role: z.enum(['admin', 'finance-admin', 'content-admin']),
});

router.put('/users/:userId/role', requireAuth, requireSuperAdmin, async (req, res) => {
  const userId = req.params.userId;
  const parsed = updateUserRoleSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
  }

  const { role } = parsed.data;

  try {
    // Check if user exists and is not a superadmin
    const existing = await pool.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (existing.rows[0].role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot change role of superadmin' });
    }

    // Update role
    const { rows } = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2
       RETURNING id, name, email, role, created_at`,
      [role, userId]
    );

    res.json({ user: rows[0] });
  } catch (err: any) {
    console.error('Failed to update user role:', err);
    return res.status(500).json({ error: 'Failed to update user role' });
  }
});

// DELETE /admin/users/:userId - Delete an admin user (superadmin only)
router.delete('/users/:userId', requireAuth, requireSuperAdmin, async (req, res) => {
  const userId = req.params.userId;

  try {
    // Check if user exists and is not a superadmin
    const existing = await pool.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (existing.rows[0].role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot delete superadmin' });
    }

    // Delete user and all related data
    await pool.query('DELETE FROM tickets WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM season_tickets WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM payments WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM event_comments WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM ivs_access_logs WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM invoices WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ ok: true, message: 'User deleted successfully' });
  } catch (err: any) {
    console.error('Failed to delete admin user:', err);
    return res.status(500).json({ error: 'Failed to delete admin user' });
  }
});

// PUT /admin/users/:userId - Update admin user details (superadmin only)
const updateAdminUserSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  mobile: z.string().min(1).optional(),
});

router.put('/users/:userId', requireAuth, requireSuperAdmin, async (req, res) => {
  const userId = req.params.userId;
  const parsed = updateAdminUserSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
  }

  const { name, email, mobile } = parsed.data;

  try {
    // Check if user exists and is not a superadmin
    const existing = await pool.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (existing.rows[0].role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot update superadmin details' });
    }

    // Check for duplicate email if updating email
    if (email !== undefined) {
      const emailExists = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, userId]
      );
      if (emailExists.rows.length > 0) {
        return res.status(400).json({ error: 'Email already in use by another user' });
      }
    }

    // Check for duplicate mobile if updating mobile
    if (mobile !== undefined) {
      const mobileExists = await pool.query(
        'SELECT id FROM users WHERE mobile = $1 AND id != $2',
        [mobile, userId]
      );
      if (mobileExists.rows.length > 0) {
        return res.status(400).json({ error: 'Mobile number already in use by another user' });
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (mobile !== undefined) {
      updates.push(`mobile = $${paramCount++}`);
      values.push(mobile);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(userId);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, name, email, mobile, role, is_active, created_at`;

    const { rows } = await pool.query(query, values);
    res.json({ user: rows[0] });
  } catch (err: any) {
    console.error('Failed to update admin user:', err);
    return res.status(500).json({ error: 'Failed to update admin user' });
  }
});

// PUT /admin/users/:userId/status - Toggle admin user active status (superadmin only)
const toggleUserStatusSchema = z.object({
  is_active: z.boolean(),
});

router.put('/users/:userId/status', requireAuth, requireSuperAdmin, async (req, res) => {
  const userId = req.params.userId;
  const parsed = toggleUserStatusSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
  }

  const { is_active } = parsed.data;

  try {
    // Check if user exists and is not a superadmin
    const existing = await pool.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (existing.rows[0].role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot disable superadmin' });
    }

    // Update status
    const { rows } = await pool.query(
      `UPDATE users SET is_active = $1 WHERE id = $2
       RETURNING id, name, email, mobile, role, is_active, created_at`,
      [is_active, userId]
    );

    res.json({ user: rows[0] });
  } catch (err: any) {
    console.error('Failed to toggle user status:', err);
    return res.status(500).json({ error: 'Failed to toggle user status' });
  }
});

export default router;
