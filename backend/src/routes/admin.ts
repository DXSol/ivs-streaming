import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { getStreamStatus } from '../services/ivs.service';

const router = Router();

// GET /admin/events/dashboard - Get all events with stats for admin dashboard
router.get('/events/dashboard', requireAuth, requireRole(['admin']), async (_req, res) => {
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
router.get('/events/:id/viewer-stats', requireAuth, requireRole(['admin']), async (req, res) => {
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

export default router;
