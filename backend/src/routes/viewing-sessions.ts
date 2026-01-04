import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Configuration from environment
const MAX_VIEWING_DEVICES = parseInt(process.env.MAX_VIEWING_DEVICES || '3', 10);
const SESSION_HEARTBEAT_TIMEOUT_SECONDS = parseInt(process.env.SESSION_HEARTBEAT_TIMEOUT_SECONDS || '60', 10);


const startSessionSchema = z.object({
  eventId: z.string().uuid(),
  sessionId: z.string().min(1).max(100),
});

// POST /viewing-sessions/start - Start or resume a viewing session
router.post('/start', requireAuth, async (req, res) => {
  const parsed = startSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { eventId, sessionId } = parsed.data;
  const userId = (req as any).user!.id;

  try {
    // First, clean up stale sessions (older than timeout)
    const deleteResult = await pool.query(
      `DELETE FROM viewing_sessions 
       WHERE last_heartbeat < NOW() - INTERVAL '${SESSION_HEARTBEAT_TIMEOUT_SECONDS} seconds'
       RETURNING id`
    );

    // Check if this exact session already exists (resuming)
    const existingSession = await pool.query(
      `SELECT id FROM viewing_sessions 
       WHERE session_id = $1 AND user_id = $2 AND event_id = $3`,
      [sessionId, userId, eventId]
    );

    if (existingSession.rows[0]) {
      // Update heartbeat for existing session
      await pool.query(
        `UPDATE viewing_sessions SET last_heartbeat = NOW() WHERE id = $1`,
        [existingSession.rows[0].id]
      );
      return res.json({ ok: true, resumed: true });
    }

    // Count active sessions for this user and event
    const activeCount = await pool.query(
      `SELECT COUNT(*) as count FROM viewing_sessions 
       WHERE user_id = $1 AND event_id = $2`,
      [userId, eventId]
    );

    const currentCount = parseInt(activeCount.rows[0].count, 10);

    if (currentCount >= MAX_VIEWING_DEVICES) {
      return res.status(429).json({
        error: 'Device limit reached',
        message: `You can only watch from ${MAX_VIEWING_DEVICES} devices at a time. Please close the stream on another device.`,
        maxDevices: MAX_VIEWING_DEVICES,
        currentDevices: currentCount,
      });
    }

    // Create new session
    await pool.query(
      `INSERT INTO viewing_sessions (session_id, user_id, event_id, last_heartbeat)
       VALUES ($1, $2, $3, NOW())`,
      [sessionId, userId, eventId]
    );

    return res.json({ ok: true, resumed: false });
  } catch (err: any) {
    console.error('Failed to start viewing session:', err);
    return res.status(500).json({ error: 'Failed to start session' });
  }
});

const heartbeatSchema = z.object({
  eventId: z.string().uuid(),
  sessionId: z.string().min(1).max(100),
});

// POST /viewing-sessions/heartbeat - Keep session alive
router.post('/heartbeat', requireAuth, async (req, res) => {
  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { eventId, sessionId } = parsed.data;
  const userId = (req as any).user!.id;

  try {
    const result = await pool.query(
      `UPDATE viewing_sessions 
       SET last_heartbeat = NOW() 
       WHERE session_id = $1 AND user_id = $2 AND event_id = $3
       RETURNING id`,
      [sessionId, userId, eventId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Session not found', expired: true });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('Failed to update heartbeat:', err);
    return res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});

const endSessionSchema = z.object({
  eventId: z.string().uuid(),
  sessionId: z.string().min(1).max(100),
});

// POST /viewing-sessions/end - End a viewing session
router.post('/end', requireAuth, async (req, res) => {
  const parsed = endSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { eventId, sessionId } = parsed.data;
  const userId = (req as any).user!.id;

  try {
    await pool.query(
      `DELETE FROM viewing_sessions 
       WHERE session_id = $1 AND user_id = $2 AND event_id = $3`,
      [sessionId, userId, eventId]
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('Failed to end viewing session:', err);
    return res.status(500).json({ error: 'Failed to end session' });
  }
});

// GET /viewing-sessions/status/:eventId - Get current session status for user
router.get('/status/:eventId', requireAuth, async (req, res) => {
  const eventId = req.params.eventId;
  const userId = (req as any).user!.id;

  try {
    // Clean up stale sessions first
    await pool.query(
      `DELETE FROM viewing_sessions 
       WHERE last_heartbeat < NOW() - INTERVAL '${SESSION_HEARTBEAT_TIMEOUT_SECONDS} seconds'`
    );

    const result = await pool.query(
      `SELECT session_id, last_heartbeat, created_at 
       FROM viewing_sessions 
       WHERE user_id = $1 AND event_id = $2
       ORDER BY created_at ASC`,
      [userId, eventId]
    );

    return res.json({
      activeSessions: result.rows.length,
      maxDevices: MAX_VIEWING_DEVICES,
      sessions: result.rows,
    });
  } catch (err: any) {
    console.error('Failed to get session status:', err);
    return res.status(500).json({ error: 'Failed to get session status' });
  }
});

export default router;
