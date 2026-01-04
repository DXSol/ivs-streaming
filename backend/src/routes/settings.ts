import { Router } from 'express';
import { env } from '../config/env';

const router = Router();

/**
 * GET /settings/chromecast
 * Returns Chromecast settings for the frontend
 */
router.get('/chromecast', (_req, res) => {
  return res.json({
    enableLiveCasting: env.chromecast.enableLiveCasting,
    enableRecordingCasting: env.chromecast.enableRecordingCasting,
  });
});

export default router;
