import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getPlaybackUrlFromArn, getStreamStatus } from '../services/ivs.service';
import { z } from 'zod';

const router = Router();

// Validation schema for creating events
const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  event_type: z.enum(['paid', 'free', 'free-short']).default('paid'),
  ivs_channel_arn: z.string().optional(),
  youtube_url: z.string().url().optional().or(z.literal('')),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  poster_url: z.string().url().optional().or(z.literal('')),
  price_paise: z.number().int().min(0).optional(),
  recording_only: z.boolean().optional().default(false),
  recording_available_hours: z.number().int().min(0).max(168).optional().default(0),
  allow_past_purchase: z.boolean().optional().default(true),
});

// Validation schema for updating events
const updateEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  event_type: z.enum(['paid', 'free', 'free-short']).optional(),
  ivs_channel_arn: z.string().optional(),
  youtube_url: z.string().url().optional().or(z.literal('')),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  poster_url: z.string().url().optional().or(z.literal('')),
  price_paise: z.number().int().min(0).optional(),
  recording_only: z.boolean().optional(),
  recording_available_hours: z.number().int().min(0).max(168).optional(),
  allow_past_purchase: z.boolean().optional(),
});

// POST /events - Create new event (admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const parsed = createEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
  }

  const { title, description, event_type, ivs_channel_arn, youtube_url, starts_at, ends_at, poster_url, price_paise, recording_only, recording_available_hours, allow_past_purchase } = parsed.data;

  // Validate: paid events need IVS channel, free/free-short events need YouTube URL
  if (event_type === 'paid' && !ivs_channel_arn) {
    return res.status(400).json({ error: 'Paid events require an IVS channel ARN' });
  }
  if ((event_type === 'free' || event_type === 'free-short') && !youtube_url) {
    return res.status(400).json({ error: 'Free events require a YouTube URL' });
  }

  try {
    // Try to get playback URL from ARN for paid events
    let playback_url: string | null = null;
    if (ivs_channel_arn) {
      try {
        playback_url = await getPlaybackUrlFromArn(ivs_channel_arn);
      } catch {
        // Channel may not exist yet
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO events (title, description, event_type, ivs_channel_arn, youtube_url, starts_at, ends_at, poster_url, playback_url, price_paise, recording_only, recording_available_hours, allow_past_purchase)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, title, description, event_type, starts_at, ends_at, poster_url, playback_url, youtube_url, price_paise, recording_only, recording_available_hours, allow_past_purchase`,
      [title, description || null, event_type || 'paid', ivs_channel_arn || null, youtube_url || null, starts_at, ends_at, poster_url || null, playback_url, (event_type === 'free' || event_type === 'free-short') ? 0 : (price_paise || 50000), recording_only || false, recording_available_hours || 0, allow_past_purchase !== undefined ? allow_past_purchase : true]
    );

    return res.status(201).json({ event: rows[0] });
  } catch (err: any) {
    console.error('Failed to create event:', err);
    return res.status(500).json({ error: 'Failed to create event' });
  }
});

// GET /events
router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, title, description, event_type, starts_at, ends_at, ivs_channel_arn, playback_url, youtube_url, poster_url, price_paise, recording_only, recording_available_hours, allow_past_purchase FROM events ORDER BY starts_at DESC'
  );

  // Use stored playback_url if available, otherwise derive from channel ARN
  const events = await Promise.all(
    rows.map(async (event: { id: string; title: string; description: string | null; event_type: string; starts_at: string; ends_at: string; ivs_channel_arn: string | null; playback_url: string | null; youtube_url: string | null; poster_url: string | null; price_paise: number; recording_only: boolean; recording_available_hours: number; allow_past_purchase: boolean }) => {
      let playback_url = event.playback_url;
      
      // If no stored URL, try to fetch from AWS (only for paid events)
      if (!playback_url && event.ivs_channel_arn && event.event_type === 'paid') {
        try {
          playback_url = await getPlaybackUrlFromArn(event.ivs_channel_arn);
        } catch {
          // Channel may not exist or be accessible
        }
      }
      
      return {
        id: event.id,
        title: event.title,
        description: event.description,
        event_type: event.event_type,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        playback_url,
        youtube_url: event.youtube_url,
        poster_url: event.poster_url,
        price_paise: event.price_paise,
        recording_only: event.recording_only || false,
        recording_available_hours: event.recording_available_hours || 0,
        allow_past_purchase: event.allow_past_purchase !== undefined ? event.allow_past_purchase : true,
      };
    })
  );

  res.json({ events });
});

// GET /events/:id
router.get('/:id', async (req, res) => {
  const eventId = req.params.id;
  const { rows } = await pool.query(
    'SELECT id, title, description, event_type, starts_at, ends_at, ivs_channel_arn, playback_url, youtube_url, poster_url, price_paise, recording_only, recording_available_hours, allow_past_purchase FROM events WHERE id = $1',
    [eventId]
  );

  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Event not found' });

  // Use stored playback_url if available, otherwise derive from channel ARN (only for paid events)
  let playback_url = row.playback_url;

  if (!playback_url && row.ivs_channel_arn && row.event_type === 'paid') {
    try {
      playback_url = await getPlaybackUrlFromArn(row.ivs_channel_arn);
    } catch {
      // Channel may not exist or be accessible
    }
  }

  const event = {
    id: row.id,
    title: row.title,
    description: row.description,
    event_type: row.event_type,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    playback_url,
    youtube_url: row.youtube_url,
    poster_url: row.poster_url,
    price_paise: row.price_paise,
    ivs_channel_arn: row.ivs_channel_arn,
    recording_only: row.recording_only || false,
    recording_available_hours: row.recording_available_hours || 0,
    allow_past_purchase: row.allow_past_purchase !== undefined ? row.allow_past_purchase : true,
  };

  return res.json({ event });
});

// PUT /events/:id - Update event (admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const eventId = req.params.id;
  const parsed = updateEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
  }

  const updates = parsed.data;

  try {
    // Check if event exists
    const existing = await pool.query('SELECT id FROM events WHERE id = $1', [eventId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Build dynamic update query
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(updates.description || null);
    }
    if (updates.event_type !== undefined) {
      setClauses.push(`event_type = $${paramIndex++}`);
      values.push(updates.event_type);
    }
    if (updates.ivs_channel_arn !== undefined) {
      setClauses.push(`ivs_channel_arn = $${paramIndex++}`);
      values.push(updates.ivs_channel_arn || null);

      // Try to update playback URL for paid events
      if (updates.ivs_channel_arn) {
        try {
          const playback_url = await getPlaybackUrlFromArn(updates.ivs_channel_arn);
          setClauses.push(`playback_url = $${paramIndex++}`);
          values.push(playback_url);
        } catch {
          // Channel may not exist yet
        }
      }
    }
    if (updates.youtube_url !== undefined) {
      setClauses.push(`youtube_url = $${paramIndex++}`);
      values.push(updates.youtube_url || null);
    }
    if (updates.starts_at !== undefined) {
      setClauses.push(`starts_at = $${paramIndex++}`);
      values.push(updates.starts_at);
    }
    if (updates.ends_at !== undefined) {
      setClauses.push(`ends_at = $${paramIndex++}`);
      values.push(updates.ends_at);
    }
    if (updates.poster_url !== undefined) {
      setClauses.push(`poster_url = $${paramIndex++}`);
      values.push(updates.poster_url || null);
    }
    if (updates.price_paise !== undefined) {
      setClauses.push(`price_paise = $${paramIndex++}`);
      values.push(updates.price_paise);
    }
    if (updates.recording_only !== undefined) {
      setClauses.push(`recording_only = $${paramIndex++}`);
      values.push(updates.recording_only);
    }
    if (updates.recording_available_hours !== undefined) {
      setClauses.push(`recording_available_hours = $${paramIndex++}`);
      values.push(updates.recording_available_hours);
    }
    if (updates.allow_past_purchase !== undefined) {
      setClauses.push(`allow_past_purchase = $${paramIndex++}`);
      values.push(updates.allow_past_purchase);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(eventId);
    const { rows } = await pool.query(
      `UPDATE events SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, title, description, event_type, starts_at, ends_at, poster_url, playback_url, youtube_url, price_paise, ivs_channel_arn, recording_only, recording_available_hours`,
      values
    );

    return res.json({ event: rows[0] });
  } catch (err: any) {
    console.error('Failed to update event:', err);
    return res.status(500).json({ error: 'Failed to update event' });
  }
});

// GET /events/:id/access
router.get('/:id/access', requireAuth, async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user!.id;

  // Get event start date
  const eventResult = await pool.query(
    'SELECT starts_at FROM events WHERE id = $1',
    [eventId]
  );
  const eventStartsAt = eventResult.rows[0]?.starts_at;

  // Check for individual event ticket
  const ticket = await pool.query(
    'SELECT status FROM tickets WHERE user_id = $1 AND event_id = $2',
    [userId, eventId]
  );

  // Check for season ticket (grants access to events that started after purchase)
  const seasonTicket = await pool.query(
    'SELECT status, purchased_at FROM season_tickets WHERE user_id = $1',
    [userId]
  );

  const ticketStatus = ticket.rows[0]?.status as string | undefined;
  const seasonTicketStatus = seasonTicket.rows[0]?.status as string | undefined;
  const seasonTicketPurchasedAt = seasonTicket.rows[0]?.purchased_at as string | undefined;

  const hasSeasonTicket = seasonTicketStatus === 'paid';
  
  // Season ticket only covers events that were upcoming at time of purchase
  const isEventCoveredBySeasonTicket = hasSeasonTicket && 
    seasonTicketPurchasedAt && 
    eventStartsAt && 
    new Date(eventStartsAt) >= new Date(seasonTicketPurchasedAt);

  const hasPaidTicket = ticketStatus === 'paid' || isEventCoveredBySeasonTicket;

  return res.json({
    eventId,
    userId,
    hasPaidTicket,
    hasSeasonTicket,
    seasonTicketPurchasedAt: hasSeasonTicket ? seasonTicketPurchasedAt : null,
    isSubscribed: ticketStatus === 'paid' || ticketStatus === 'pending' || isEventCoveredBySeasonTicket,
  });
});

// GET /events/user/ticket-status - Get all ticket statuses for the logged-in user
router.get('/user/ticket-status', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  try {
    // Get all individual tickets for the user
    const ticketsResult = await pool.query(
      `SELECT event_id, status FROM tickets WHERE user_id = $1`,
      [userId]
    );

    // Get season ticket info
    const seasonTicketResult = await pool.query(
      `SELECT status, purchased_at FROM season_tickets WHERE user_id = $1`,
      [userId]
    );

    const tickets: Record<string, string> = {};
    for (const row of ticketsResult.rows) {
      tickets[row.event_id] = row.status;
    }

    const seasonTicket = seasonTicketResult.rows[0];
    const hasSeasonTicket = seasonTicket?.status === 'paid';

    return res.json({
      tickets,
      hasSeasonTicket,
      seasonTicketPurchasedAt: hasSeasonTicket ? seasonTicket.purchased_at : null,
    });
  } catch (err: any) {
    console.error('Failed to get ticket status:', err);
    return res.status(500).json({ error: 'Failed to get ticket status' });
  }
});

// POST /events/:id/subscribe
router.post('/:id/subscribe', requireAuth, async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user!.id;

  await pool.query(
    `INSERT INTO tickets (user_id, event_id, status)
     VALUES ($1,$2,'pending')
     ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'pending'`,
    [userId, eventId]
  );

  return res.status(201).json({ ok: true });
});

// POST /events/:id/unsubscribe
router.post('/:id/unsubscribe', requireAuth, async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user!.id;

  await pool.query(
    `UPDATE tickets SET status = 'revoked' WHERE user_id = $1 AND event_id = $2`,
    [userId, eventId]
  );

  return res.json({ ok: true });
});

const createCommentSchema = z.object({
  body: z.string().min(1).max(2000),
});

// GET /events/:id/comments
router.get('/:id/comments', requireAuth, async (req, res) => {
  const eventId = req.params.id;

  const { rows } = await pool.query(
    `SELECT c.id, c.body, c.created_at, u.id as user_id, u.email as user_email, u.name as user_name
     FROM event_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.event_id = $1
     ORDER BY c.created_at DESC`,
    [eventId]
  );

  return res.json({ comments: rows });
});

// POST /events/:id/comments
router.post('/:id/comments', requireAuth, async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user!.id;

  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { body } = parsed.data;

  // Get user's name from database
  const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
  const userName = userResult.rows[0]?.name || null;

  const inserted = await pool.query(
    `INSERT INTO event_comments (event_id, user_id, body)
     VALUES ($1,$2,$3)
     RETURNING id, body, created_at`,
    [eventId, userId, body]
  );

  return res.status(201).json({
    comment: {
      ...inserted.rows[0],
      user_id: userId,
      user_email: req.user!.email,
      user_name: userName,
    },
  });
});

// GET /events/:id/viewers - Get current viewer count
router.get('/:id/viewers', async (req, res) => {
  const eventId = req.params.id;

  // Count unique viewers from ivs_access_logs in the last 5 minutes
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT user_id) as count
     FROM ivs_access_logs
     WHERE event_id = $1
     AND created_at > NOW() - INTERVAL '5 minutes'`,
    [eventId]
  );

  return res.json({ count: parseInt(rows[0]?.count || '0', 10) });
});

// DELETE /events/:id - Delete event (admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const eventId = req.params.id;

  try {
    // Check if event exists
    const existing = await pool.query('SELECT id FROM events WHERE id = $1', [eventId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Delete related data first (respecting foreign key constraints)
    await pool.query('DELETE FROM tickets WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM event_comments WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM event_viewer_stats WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM ivs_access_logs WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM payments WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM events WHERE id = $1', [eventId]);

    return res.json({ ok: true, message: 'Event deleted' });
  } catch (err: any) {
    console.error('Failed to delete event:', err);
    return res.status(500).json({ error: 'Failed to delete event' });
  }
});

// GET /events/:id/stream-status - Check if stream is live
router.get('/:id/stream-status', async (req, res) => {
  const eventId = req.params.id;

  const { rows } = await pool.query(
    'SELECT ivs_channel_arn FROM events WHERE id = $1',
    [eventId]
  );

  const event = rows[0];
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  if (!event.ivs_channel_arn) {
    return res.json({ isLive: false, state: 'NOT_CONFIGURED' });
  }

  const status = await getStreamStatus(event.ivs_channel_arn);
  return res.json(status);
});

export default router;
