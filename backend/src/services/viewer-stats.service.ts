import { pool } from '../db/pool';
import { getStreamStatus } from './ivs.service';

interface ActiveEvent {
  id: string;
  ivs_channel_arn: string;
}

let statsInterval: NodeJS.Timeout | null = null;

async function getActiveEvents(): Promise<ActiveEvent[]> {
  const now = new Date().toISOString();
  // Get events that have started (current or past) and have an IVS channel configured
  const { rows } = await pool.query(
    `SELECT id, ivs_channel_arn FROM events 
     WHERE starts_at <= $1 AND ivs_channel_arn IS NOT NULL`,
    [now]
  );
  return rows;
}

async function recordViewerStats() {
  try {
    const activeEvents = await getActiveEvents();
    
    for (const event of activeEvents) {
      try {
        const status = await getStreamStatus(event.ivs_channel_arn);
        
        if (status.isLive && status.viewerCount > 0) {
          await pool.query(
            `INSERT INTO event_viewer_stats (event_id, viewer_count) VALUES ($1, $2)`,
            [event.id, status.viewerCount]
          );
          console.log(`[ViewerStats] Recorded ${status.viewerCount} viewers for event ${event.id}`);
        }
      } catch (err) {
        console.error(`[ViewerStats] Failed to record stats for event ${event.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[ViewerStats] Failed to get active events:', err);
  }
}

export function startViewerStatsRecording() {
  if (statsInterval) {
    clearInterval(statsInterval);
  }

  // Record stats every 1 minute (60000 ms)
  const INTERVAL_MS = 1 * 60 * 1000;

  console.log('[ViewerStats] Starting viewer stats recording (every 1 minute)');
  
  // Record immediately on start
  recordViewerStats();

  statsInterval = setInterval(recordViewerStats, INTERVAL_MS);
}

export function stopViewerStatsRecording() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
    console.log('[ViewerStats] Stopped viewer stats recording');
  }
}
