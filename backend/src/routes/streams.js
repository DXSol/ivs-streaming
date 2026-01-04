const express = require('express');

const router = express.Router();

// GET /api/streams/:id/playback
// Production responsibilities:
// - verify authenticated user
// - verify entitlement (paid subscription/ppv)
// - return IVS playback URL (+ playback auth token if enabled)
router.get('/:id/playback', async (req, res) => {
  const { id } = req.params;

  // Stub: use env var or fallback
  const playbackUrl = process.env.IVS_PLAYBACK_URL_DEFAULT;

  if (!playbackUrl) {
    return res.status(500).json({ error: 'IVS_PLAYBACK_URL_DEFAULT is not configured' });
  }

  return res.json({
    streamId: id,
    playbackUrl,
  });
});

module.exports = router;
