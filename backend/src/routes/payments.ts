import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';

const router = Router();

// POST /payments/webhook
// Provider-specific signature verification is required in production.
const webhookSchema = z.object({
  provider: z.string().min(1),
  providerPaymentId: z.string().min(1),
  userId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
  status: z.enum(['success', 'failed']),
  raw: z.any().optional(),
});

router.post('/webhook', async (req, res) => {
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  const payload = parsed.data;

  await pool.query(
    `INSERT INTO payments (provider, provider_payment_id, user_id, event_id, amount_cents, currency, status, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (provider, provider_payment_id) DO UPDATE SET status = EXCLUDED.status, raw_payload = EXCLUDED.raw_payload`,
    [
      payload.provider,
      payload.providerPaymentId,
      payload.userId ?? null,
      payload.eventId ?? null,
      payload.amountCents,
      payload.currency,
      payload.status,
      payload.raw ?? payload,
    ]
  );

  // Grant access (ticket)
  if (payload.status === 'success' && payload.userId && payload.eventId) {
    await pool.query(
      `INSERT INTO tickets (user_id, event_id, status)
       VALUES ($1,$2,'paid')
       ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'paid'`,
      [payload.userId, payload.eventId]
    );
  }

  return res.json({ ok: true });
});

export default router;
