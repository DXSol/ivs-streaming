import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const router = Router();

const playbackTokenSchema = z.object({
  eventId: z.string().uuid(),
});

// GET /ivs/playback-token?eventId=...
router.get('/playback-token', requireAuth, async (req, res) => {
  const parsed = playbackTokenSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Missing eventId' });
  }

  const { eventId } = parsed.data;
  const user = req.user!;

  const eventResult = await pool.query(
    'SELECT id, starts_at, ends_at, ivs_channel_arn FROM events WHERE id = $1',
    [eventId]
  );

  const event = eventResult.rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const now = new Date();
  const startsAt = new Date(event.starts_at);
  const endsAt = new Date(event.ends_at);

  if (now < startsAt || now > endsAt) {
    console.log(`[IVS] Event time check failed: now=${now.toISOString()}, starts=${startsAt.toISOString()}, ends=${endsAt.toISOString()}`);
    return res.status(403).json({ 
      error: 'Event not in time window',
      details: { now: now.toISOString(), starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() }
    });
  }

  // Admin has unrestricted access to all events
  let hasValidTicket = user.role === 'admin';

  // Check for individual ticket OR season ticket (if not admin)
  if (!hasValidTicket) {
    const ticketResult = await pool.query(
      'SELECT status FROM tickets WHERE user_id = $1 AND event_id = $2',
      [user.id, eventId]
    );

    hasValidTicket = ticketResult.rows[0]?.status === 'paid';

    // If no individual ticket, check for season ticket
    if (!hasValidTicket) {
      const seasonTicketResult = await pool.query(
        `SELECT status, purchased_at FROM season_tickets
         WHERE user_id = $1 AND status = 'paid'`,
        [user.id]
      );
      const seasonTicket = seasonTicketResult.rows[0];
      if (seasonTicket) {
        // Season ticket grants access to events that start on or after purchase date
        const purchasedAt = new Date(seasonTicket.purchased_at);
        if (startsAt >= purchasedAt) {
          hasValidTicket = true;
        }
      }
    }
  }

  if (!hasValidTicket) {
    return res.status(403).json({ error: 'No valid ticket' });
  }

  if (!env.ivsPlaybackAuth.keyPairId || !env.ivsPlaybackAuth.privateKeyPem) {
    return res.status(500).json({ error: 'IVS playback auth key pair is not configured' });
  }

  // IVS Playback Authorization token
  // Docs: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/private-channels-generate-tokens.html
  // IMPORTANT: exp is a Unix timestamp in seconds.
  // When using aws:viewer-id or aws:single-use-uuid, IVS restricts exp to <= 10 minutes.
  const maxExpSeconds = Math.floor(Date.now() / 1000) + 10 * 60;

  const desiredExpiresAt = new Date(endsAt.getTime() + 15 * 60 * 1000);
  const desiredExpSeconds = Math.floor(desiredExpiresAt.getTime() / 1000);
  const expSeconds = Math.min(desiredExpSeconds, maxExpSeconds);

  const payload: Record<string, unknown> = {
    'aws:channel-arn': event.ivs_channel_arn,
    'aws:access-control-allow-origin': '*',
    'aws:viewer-id': user.id,
    'aws:single-use-uuid': randomUUID(),
    // Optional entitlement-based filtering. For now, allow up to FULL_HD.
    'aws:maximum-resolution': 'FULL_HD',
    exp: expSeconds,
  };

  const token = jwt.sign(payload, env.ivsPlaybackAuth.privateKeyPem, {
    algorithm: 'ES384',
    keyid: env.ivsPlaybackAuth.keyPairId,
  });

  const expiresAt = new Date(expSeconds * 1000);

  await pool.query(
    `INSERT INTO ivs_access_logs (user_id, event_id, ip, user_agent, token_expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      user.id,
      eventId,
      req.ip || null,
      String(req.headers['user-agent'] || ''),
      expiresAt,
    ]
  );

  return res.json({ token, expiresAt: expiresAt.toISOString() });
});

export default router;
