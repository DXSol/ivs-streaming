import { Router } from 'express';
import { z } from 'zod';
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { env } from '../config/env';
import {
  generateSignedRecordingUrl,
  isRecordingExpired,
  getRecordingExpiryDate,
} from '../services/cloudfront-signer.service';

const router = Router();

const s3Client = new S3Client({
  region: env.aws.region,
  credentials: env.aws.accessKeyId && env.aws.secretAccessKey
    ? {
        accessKeyId: env.aws.accessKeyId,
        secretAccessKey: env.aws.secretAccessKey,
      }
    : undefined,
});

const eventIdSchema = z.object({
  eventId: z.string().uuid(),
});

interface RecordingSession {
  sessionId: string;
  timestamp: string; // YYYY/MM/DD/HH/MM format
  path: string;
  dateTime: Date;
  isValid?: boolean; // Whether the session has valid segment files
}

/**
 * Validate if a recording session has actual playable content.
 * Checks for the presence of segment files (.ts) in the session's HLS directory.
 * A session with only master.m3u8 but no segments is considered invalid.
 */
async function validateSession(sessionPath: string): Promise<boolean> {
  try {
    // Get the HLS directory path (remove master.m3u8 from the path)
    const hlsDir = sessionPath.replace(/master\.m3u8$/, '');

    // List objects in the HLS directory to check for segment files
    const listResult = await s3Client.send(new ListObjectsV2Command({
      Bucket: env.s3.recordingsBucket,
      Prefix: hlsDir,
      MaxKeys: 10, // We just need to find a few segments to confirm validity
    }));

    if (!listResult.Contents || listResult.Contents.length === 0) {
      return false;
    }

    // Check for .ts segment files or variant playlists
    const hasSegments = listResult.Contents.some(obj => {
      const key = obj.Key || '';
      // Valid session should have .ts segments or variant playlist files
      return key.endsWith('.ts') ||
             (key.endsWith('.m3u8') && !key.endsWith('master.m3u8'));
    });

    return hasSegments;
  } catch (error) {
    console.error(`[Recordings] Error validating session ${sessionPath}:`, error);
    return false;
  }
}

/**
 * Find all recording sessions for a channel in S3.
 * IVS stores recordings in: ivs/v1/{accountId}/{channelId}/{YYYY}/{MM}/{DD}/{HH}/{MM}/{sessionId}/media/hls/
 * Returns sessions sorted chronologically (oldest first for sequential playback).
 * Invalid sessions (without segment files) are filtered out.
 */
async function findAllRecordingSessions(channelArn: string): Promise<RecordingSession[]> {
  const arnParts = channelArn.split(':');
  const accountId = arnParts[4];
  const channelId = arnParts[5]?.split('/')[1];
  
  if (!accountId || !channelId) {
    return [];
  }
  
  const prefix = `ivs/v1/${accountId}/${channelId}/`;
  const sessions: RecordingSession[] = [];
  
  try {
    let continuationToken: string | undefined;
    
    do {
      const listResult = await s3Client.send(new ListObjectsV2Command({
        Bucket: env.s3.recordingsBucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }));
      
      // Find all master.m3u8 files (each represents a session)
      const hlsFiles = listResult.Contents?.filter(obj => 
        obj.Key?.endsWith('master.m3u8')
      ) || [];
      
      for (const file of hlsFiles) {
        if (!file.Key) continue;
        
        // Parse path: ivs/v1/{accountId}/{channelId}/{YYYY}/{MM}/{DD}/{HH}/{MM}/{sessionId}/media/hls/master.m3u8
        const pathParts = file.Key.split('/');
        console.log(`[Recordings] Parsing path: ${file.Key}, parts: ${pathParts.length}`);
        
        // pathParts: [ivs, v1, accountId, channelId, YYYY, MM, DD, HH, MM, sessionId, media, hls, master.m3u8]
        if (pathParts.length >= 13) {
          const year = pathParts[4];
          const month = pathParts[5];
          const day = pathParts[6];
          const hour = pathParts[7];
          const minute = pathParts[8];
          const sessionId = pathParts[9];
          
          const timestamp = `${year}/${month}/${day}/${hour}/${minute}`;
          
          // Use file's LastModified as fallback if date parsing fails
          let dateTime: Date;
          try {
            dateTime = new Date(Date.UTC(
              parseInt(year, 10),
              parseInt(month, 10) - 1, // Month is 0-indexed
              parseInt(day, 10),
              parseInt(hour, 10),
              parseInt(minute, 10),
              0
            ));
            if (isNaN(dateTime.getTime())) {
              dateTime = file.LastModified || new Date();
            }
          } catch {
            dateTime = file.LastModified || new Date();
          }
          
          sessions.push({
            sessionId,
            timestamp,
            path: file.Key,
            dateTime,
          });
        }
      }
      
      continuationToken = listResult.NextContinuationToken;
    } while (continuationToken);
    
    // Sort by dateTime (oldest first for sequential playback)
    sessions.sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());

    // Validate each session to ensure it has playable content
    console.log(`[Recordings] Found ${sessions.length} sessions, validating...`);

    const validatedSessions: RecordingSession[] = [];
    for (const session of sessions) {
      const isValid = await validateSession(session.path);
      if (isValid) {
        session.isValid = true;
        validatedSessions.push(session);
        console.log(`[Recordings] Session ${session.sessionId} (${session.timestamp}) is valid`);
      } else {
        console.log(`[Recordings] Session ${session.sessionId} (${session.timestamp}) is INVALID - skipping (no segment files found)`);
      }
    }

    console.log(`[Recordings] ${validatedSessions.length} of ${sessions.length} sessions are valid`);

    return validatedSessions;
  } catch (error) {
    console.error('[Recordings] Error finding sessions:', error);
    return [];
  }
}

/**
 * GET /recordings/:eventId/playback-url
 * 
 * Returns signed CloudFront URLs for all recording sessions of an event.
 * Sessions are returned in chronological order for sequential playback.
 * 
 * Requirements:
 * - User must be authenticated
 * - User must have a paid ticket for the event (or season ticket)
 * - Event must have ended (recording available)
 * - Recording must not be expired (within 3 days of event end)
 */
router.get('/:eventId/playback-url', requireAuth, async (req, res) => {
  const parsed = eventIdSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid event ID' });
  }

  const { eventId } = parsed.data;
  const user = req.user!;

  try {
    // 1. Fetch event details
    const eventResult = await pool.query(
      `SELECT id, title, starts_at, ends_at, event_type, ivs_channel_arn
       FROM events WHERE id = $1`,
      [eventId]
    );

    const event = eventResult.rows[0];
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // 2. Check if event is a paid event (free/free-short events use YouTube, no recordings)
    if (event.event_type === 'free' || event.event_type === 'free-short') {
      return res.status(400).json({ error: 'Free events do not have recordings' });
    }

    // 3. Check if event has ended (recording should be available)
    const endsAt = new Date(event.ends_at);
    const now = new Date();
    if (now < endsAt) {
      return res.status(400).json({ 
        error: 'Event has not ended yet',
        message: 'Recording will be available after the event ends'
      });
    }

    // 4. Check if recording has expired (3 days after event end)
    if (isRecordingExpired(endsAt)) {
      const expiryDate = getRecordingExpiryDate(endsAt);
      return res.status(410).json({ 
        error: 'Recording expired',
        message: `Recording was available until ${expiryDate.toISOString()}`,
        expiredAt: expiryDate.toISOString()
      });
    }

    // 5. Validate user has access (paid ticket or season ticket)
    // Admin has unrestricted access to all recordings
    let hasValidTicket = user.role === 'admin';

    if (!hasValidTicket) {
      const startsAt = new Date(event.starts_at);

      // Check for individual ticket
      const ticketResult = await pool.query(
        `SELECT status FROM tickets WHERE user_id = $1 AND event_id = $2 AND status = 'paid'`,
        [user.id, eventId]
      );

      hasValidTicket = ticketResult.rows.length > 0;

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
      return res.status(403).json({ error: 'No valid ticket for this event' });
    }

    // 6. Find all recording sessions for this event
    if (!event.ivs_channel_arn) {
      return res.status(404).json({ 
        error: 'Recording not found',
        message: 'No IVS channel configured for this event'
      });
    }

    const sessions = await findAllRecordingSessions(event.ivs_channel_arn);
    
    if (sessions.length === 0) {
      return res.status(404).json({ 
        error: 'Recording not found',
        message: 'The recording for this event is not yet available or was not recorded'
      });
    }

    // 7. Generate signed CloudFront URLs for all sessions
    const signedSessions = sessions.map((session, index) => {
      const { signedUrl, expiresAt } = generateSignedRecordingUrl(session.path);
      
      // Safely convert dateTime to ISO string
      let dateTimeStr: string;
      try {
        dateTimeStr = session.dateTime instanceof Date && !isNaN(session.dateTime.getTime())
          ? session.dateTime.toISOString()
          : new Date().toISOString();
      } catch {
        dateTimeStr = new Date().toISOString();
      }
      
      return {
        index,
        sessionId: session.sessionId,
        timestamp: session.timestamp,
        dateTime: dateTimeStr,
        playbackUrl: signedUrl,
        expiresAt: expiresAt.toISOString(),
      };
    });

    // 8. Log access
    await pool.query(
      `INSERT INTO ivs_access_logs (user_id, event_id, ip, user_agent, token_expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user.id,
        eventId,
        req.ip || null,
        String(req.headers['user-agent'] || ''),
        signedSessions[0].expiresAt,
      ]
    );

    // 9. Return signed URLs for all sessions
    const recordingExpiryDate = getRecordingExpiryDate(endsAt);
    
    return res.json({
      // For backward compatibility, include first session as primary playback URL
      playbackUrl: signedSessions[0].playbackUrl,
      expiresAt: signedSessions[0].expiresAt,
      recordingExpiresAt: recordingExpiryDate.toISOString(),
      eventTitle: event.title,
      // New: all sessions for sequential playback
      sessions: signedSessions,
      totalSessions: signedSessions.length,
    });

  } catch (error: any) {
    console.error('[Recordings] Error generating playback URL:', error);
    return res.status(500).json({ error: 'Failed to generate playback URL' });
  }
});

/**
 * GET /recordings/:eventId/status
 * 
 * Check if a recording is available and when it expires.
 * Does not require ticket validation - just checks availability.
 */
router.get('/:eventId/status', requireAuth, async (req, res) => {
  const parsed = eventIdSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid event ID' });
  }

  const { eventId } = parsed.data;

  try {
    const eventResult = await pool.query(
      `SELECT id, title, ends_at, event_type FROM events WHERE id = $1`,
      [eventId]
    );

    const event = eventResult.rows[0];
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.event_type === 'free' || event.event_type === 'free-short') {
      return res.json({
        available: false,
        reason: 'Free events do not have recordings',
      });
    }

    const endsAt = new Date(event.ends_at);
    const now = new Date();

    if (now < endsAt) {
      return res.json({
        available: false,
        reason: 'Event has not ended yet',
        availableAfter: endsAt.toISOString(),
      });
    }

    if (isRecordingExpired(endsAt)) {
      const expiryDate = getRecordingExpiryDate(endsAt);
      return res.json({
        available: false,
        reason: 'Recording has expired',
        expiredAt: expiryDate.toISOString(),
      });
    }

    // Check if recording exists - first check stored path, then search S3
    const storedPathResult = await pool.query(
      'SELECT recording_s3_path, ivs_channel_arn FROM events WHERE id = $1',
      [eventId]
    );
    
    let recordingExists = false;
    
    if (storedPathResult.rows[0]?.recording_s3_path) {
      recordingExists = true;
    } else if (storedPathResult.rows[0]?.ivs_channel_arn) {
      // Try to find recording in S3
      const arnParts = storedPathResult.rows[0].ivs_channel_arn.split(':');
      const accountId = arnParts[4];
      const channelId = arnParts[5]?.split('/')[1];
      
      if (accountId && channelId) {
        const prefix = `ivs/v1/${accountId}/${channelId}/`;
        try {
          const listResult = await s3Client.send(new ListObjectsV2Command({
            Bucket: env.s3.recordingsBucket,
            Prefix: prefix,
            MaxKeys: 10,
          }));
          
          const hlsFiles = listResult.Contents?.filter(obj => 
            obj.Key?.endsWith('master.m3u8') || obj.Key?.endsWith('index.m3u8')
          ) || [];
          
          recordingExists = hlsFiles.length > 0;
        } catch {
          recordingExists = false;
        }
      }
    }

    const expiryDate = getRecordingExpiryDate(endsAt);

    return res.json({
      available: recordingExists,
      reason: recordingExists ? 'Recording is available' : 'Recording not found',
      expiresAt: expiryDate.toISOString(),
    });

  } catch (error: any) {
    console.error('[Recordings] Error checking status:', error);
    return res.status(500).json({ error: 'Failed to check recording status' });
  }
});

export default router;
