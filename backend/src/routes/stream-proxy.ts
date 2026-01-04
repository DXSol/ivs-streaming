import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import * as os from 'os';

const router = Router();

// Get local network IP for Chromecast access
function getLocalNetworkIp(): string {
  const networkInterfaces = os.networkInterfaces();
  for (const name of Object.keys(networkInterfaces)) {
    for (const iface of networkInterfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Get proxy base URL that's accessible from Chromecast
function getProxyBaseUrl(req: Request): string {
  const host = req.get('host') || '';
  if (host.includes('localhost') || host.startsWith('127.0.0.1')) {
    const localIp = getLocalNetworkIp();
    const port = host.split(':')[1] || '5050';
    return `http://${localIp}:${port}`;
  }
  return `${req.protocol}://${host}`;
}

// In-memory cache for proxy sessions (in production, use Redis)
const proxySessionCache = new Map<string, {
  playbackUrl: string;
  token: string;
  expiresAt: Date;
  userId: string;
  eventId: string;
}>();

// Clean up expired sessions periodically
setInterval(() => {
  const now = new Date();
  for (const [key, session] of proxySessionCache.entries()) {
    if (session.expiresAt < now) {
      proxySessionCache.delete(key);
    }
  }
}, 60000); // Clean every minute

const createProxySessionSchema = z.object({
  eventId: z.string().uuid(),
});

/**
 * Create a proxy session for Chromecast streaming
 * This generates a unique session ID that can be used to access the stream via proxy
 */
router.post('/create-session', requireAuth, async (req: Request, res: Response) => {
  const parsed = createProxySessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Missing eventId' });
  }

  const { eventId } = parsed.data;
  const user = req.user!;

  // Verify event exists and user has access
  const eventResult = await pool.query(
    'SELECT id, starts_at, ends_at, ivs_channel_arn, playback_url, recording_only, recording_available_hours FROM events WHERE id = $1',
    [eventId]
  );

  const event = eventResult.rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const now = new Date();
  const startsAt = new Date(event.starts_at);
  const endsAt = new Date(event.ends_at);

  // For recordings, allow access based on recording_available_hours after event ends
  // For live events, allow 30 min buffer before/after
  const isRecording = event.recording_only || now > endsAt;
  
  if (isRecording) {
    // Recording mode: check if within recording availability window
    const recordingHours = event.recording_available_hours || 48; // Default 48 hours
    const recordingExpiresAt = new Date(endsAt.getTime() + recordingHours * 60 * 60 * 1000);
    if (now > recordingExpiresAt) {
      return res.status(403).json({ error: 'Recording no longer available' });
    }
  } else {
    // Live mode: allow 30 min buffer before start
    const bufferMs = 30 * 60 * 1000;
    if (now < new Date(startsAt.getTime() - bufferMs)) {
      return res.status(403).json({ error: 'Event has not started yet' });
    }
  }

  // Check for valid ticket (individual or season)
  const ticketResult = await pool.query(
    'SELECT status FROM tickets WHERE user_id = $1 AND event_id = $2',
    [user.id, eventId]
  );

  let hasValidTicket = ticketResult.rows[0]?.status === 'paid';

  if (!hasValidTicket) {
    const seasonTicketResult = await pool.query(
      `SELECT status, purchased_at FROM season_tickets 
       WHERE user_id = $1 AND status = 'paid'`,
      [user.id]
    );
    const seasonTicket = seasonTicketResult.rows[0];
    if (seasonTicket) {
      const purchasedAt = new Date(seasonTicket.purchased_at);
      if (startsAt >= purchasedAt) {
        hasValidTicket = true;
      }
    }
  }

  if (!hasValidTicket) {
    return res.status(403).json({ error: 'No valid ticket' });
  }

  if (!env.ivsPlaybackAuth.keyPairId || !env.ivsPlaybackAuth.privateKeyPem) {
    return res.status(500).json({ error: 'IVS playback auth not configured' });
  }

  // Generate IVS token
  const maxExpSeconds = Math.floor(Date.now() / 1000) + 10 * 60;
  const desiredExpiresAt = new Date(endsAt.getTime() + 15 * 60 * 1000);
  const desiredExpSeconds = Math.floor(desiredExpiresAt.getTime() / 1000);
  const expSeconds = Math.min(desiredExpSeconds, maxExpSeconds);

  const payload: Record<string, unknown> = {
    'aws:channel-arn': event.ivs_channel_arn,
    'aws:access-control-allow-origin': '*',
    'aws:viewer-id': user.id,
    'aws:single-use-uuid': randomUUID(),
    'aws:maximum-resolution': 'FULL_HD',
    exp: expSeconds,
  };

  const token = jwt.sign(payload, env.ivsPlaybackAuth.privateKeyPem, {
    algorithm: 'ES384',
    keyid: env.ivsPlaybackAuth.keyPairId,
  });

  // Create proxy session
  const sessionId = randomUUID();
  const expiresAt = new Date(expSeconds * 1000);

  proxySessionCache.set(sessionId, {
    playbackUrl: event.playback_url,
    token,
    expiresAt,
    userId: user.id,
    eventId,
  });

  // Return the proxy URL that Chromecast can use (network-accessible, not localhost)
  const proxyBaseUrl = getProxyBaseUrl(req);
  const proxyUrl = `${proxyBaseUrl}/api/stream-proxy/hls/${sessionId}/playlist.m3u8`;

  console.log(`[StreamProxy] Created session ${sessionId} for user ${user.id}, event ${eventId}`);

  return res.json({
    proxyUrl,
    sessionId,
    expiresAt: expiresAt.toISOString(),
  });
});

/**
 * Proxy HLS playlist (m3u8)
 * Fetches the playlist from IVS and rewrites segment URLs to go through proxy
 */
router.get('/hls/:sessionId/playlist.m3u8', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  const session = proxySessionCache.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  if (new Date() > session.expiresAt) {
    proxySessionCache.delete(sessionId);
    return res.status(403).json({ error: 'Session expired' });
  }

  try {
    // Fetch the master playlist from IVS
    const ivsUrl = `${session.playbackUrl}?token=${session.token}`;
    
    const response = await fetch(ivsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StreamProxy/1.0)',
      },
    });

    if (!response.ok) {
      console.error(`[StreamProxy] IVS fetch failed: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ error: 'Failed to fetch stream' });
    }

    let playlist = await response.text();
    
    // Log the original playlist for debugging
    console.log(`[StreamProxy] Original playlist for session ${sessionId}:\n${playlist.substring(0, 500)}...`);
    
    // Get the base URL for IVS segments
    const ivsBaseUrl = session.playbackUrl.substring(0, session.playbackUrl.lastIndexOf('/') + 1);
    const proxyBaseUrl = `${getProxyBaseUrl(req)}/api/stream-proxy/hls/${sessionId}`;

    // Rewrite URLs in the playlist to go through our proxy
    // Handle both relative and absolute URLs
    playlist = playlist.split('\n').map(line => {
      const trimmedLine = line.trim();
      
      // Skip comments and empty lines (but keep them in output)
      if (trimmedLine.startsWith('#') || trimmedLine === '') {
        // Rewrite URI= attributes in EXT-X-MEDIA and EXT-X-I-FRAME-STREAM-INF
        if (trimmedLine.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/g, (match, uri) => {
            if (uri.startsWith('http')) {
              return `URI="${proxyBaseUrl}/segment?url=${encodeURIComponent(uri)}"`;
            }
            return `URI="${proxyBaseUrl}/segment?url=${encodeURIComponent(ivsBaseUrl + uri)}"`;
          });
        }
        return line;
      }
      
      // This is a URL line (segment or variant playlist)
      if (trimmedLine.startsWith('http')) {
        // Absolute URL
        return `${proxyBaseUrl}/segment?url=${encodeURIComponent(trimmedLine)}`;
      } else if (trimmedLine.endsWith('.m3u8')) {
        // Variant playlist - proxy it
        return `${proxyBaseUrl}/variant?url=${encodeURIComponent(ivsBaseUrl + trimmedLine)}`;
      } else if (trimmedLine.endsWith('.ts') || trimmedLine.endsWith('.aac') || trimmedLine.endsWith('.mp4')) {
        // Segment file
        return `${proxyBaseUrl}/segment?url=${encodeURIComponent(ivsBaseUrl + trimmedLine)}`;
      }
      
      // Unknown format, try to proxy anyway
      return `${proxyBaseUrl}/segment?url=${encodeURIComponent(ivsBaseUrl + trimmedLine)}`;
    }).join('\n');

    // Set CORS headers for Chromecast
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

    return res.send(playlist);
  } catch (error) {
    console.error('[StreamProxy] Error fetching playlist:', error);
    return res.status(500).json({ error: 'Failed to fetch stream' });
  }
});

/**
 * Proxy variant playlist (quality levels)
 */
router.get('/hls/:sessionId/variant', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const session = proxySessionCache.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  if (new Date() > session.expiresAt) {
    proxySessionCache.delete(sessionId);
    return res.status(403).json({ error: 'Session expired' });
  }

  try {
    // Add token to the URL
    const fetchUrl = url.includes('?') ? `${url}&token=${session.token}` : `${url}?token=${session.token}`;
    
    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StreamProxy/1.0)',
      },
    });

    if (!response.ok) {
      console.error(`[StreamProxy] Variant fetch failed: ${response.status}`);
      return res.status(response.status).json({ error: 'Failed to fetch variant' });
    }

    let playlist = await response.text();
    
    // Get the base URL for segments
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    const proxyBaseUrl = `${getProxyBaseUrl(req)}/api/stream-proxy/hls/${sessionId}`;

    // Rewrite segment URLs
    playlist = playlist.split('\n').map(line => {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('#') || trimmedLine === '') {
        return line;
      }
      
      if (trimmedLine.startsWith('http')) {
        return `${proxyBaseUrl}/segment?url=${encodeURIComponent(trimmedLine)}`;
      } else if (trimmedLine.endsWith('.ts') || trimmedLine.endsWith('.aac') || trimmedLine.endsWith('.mp4') || trimmedLine.includes('.ts?')) {
        return `${proxyBaseUrl}/segment?url=${encodeURIComponent(baseUrl + trimmedLine)}`;
      }
      
      return `${proxyBaseUrl}/segment?url=${encodeURIComponent(baseUrl + trimmedLine)}`;
    }).join('\n');

    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

    return res.send(playlist);
  } catch (error) {
    console.error('[StreamProxy] Error fetching variant:', error);
    return res.status(500).json({ error: 'Failed to fetch variant' });
  }
});

/**
 * Proxy HLS segments (video/audio chunks)
 */
router.get('/hls/:sessionId/segment', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const session = proxySessionCache.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  if (new Date() > session.expiresAt) {
    proxySessionCache.delete(sessionId);
    return res.status(403).json({ error: 'Session expired' });
  }

  try {
    // Add token if not already present
    const fetchUrl = url.includes('token=') ? url : (url.includes('?') ? `${url}&token=${session.token}` : `${url}?token=${session.token}`);
    
    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StreamProxy/1.0)',
      },
    });

    if (!response.ok) {
      console.error(`[StreamProxy] Segment fetch failed: ${response.status} for ${url}`);
      return res.status(response.status).json({ error: 'Failed to fetch segment' });
    }

    const contentType = response.headers.get('content-type') || 'video/mp2t';
    const buffer = await response.arrayBuffer();

    res.set({
      'Content-Type': contentType,
      'Content-Length': buffer.byteLength.toString(),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
      'Cache-Control': 'max-age=3600',
    });

    return res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('[StreamProxy] Error fetching segment:', error);
    return res.status(500).json({ error: 'Failed to fetch segment' });
  }
});

// Handle CORS preflight
router.options('/hls/:sessionId/*', (req: Request, res: Response) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
    'Access-Control-Max-Age': '86400',
  });
  return res.sendStatus(204);
});

export default router;
