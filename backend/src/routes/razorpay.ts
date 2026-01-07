import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { createOrder, verifyPaymentSignature, getRazorpayKeyId, verifyWebhookSignature, fetchOrder } from '../services/razorpay.service';
import { createInvoice } from './invoices';
import { sendUSDPaymentNotification } from '../services/email.service';
import { env } from '../config/env';

const router = Router();

// GET /razorpay/key - Get Razorpay key ID for frontend
router.get('/key', (_req, res) => {
  return res.json({ keyId: getRazorpayKeyId() });
});

// International pricing constants
const INTERNATIONAL_PRICE_USD_CENTS = 1000; // $10.00 USD in cents
const USD_TO_INR_RATE = 84; // Approximate conversion rate, Razorpay handles actual conversion

// Helper function to determine if user is from India
function isIndianUser(country: string | null | undefined): boolean {
  if (!country) return true; // Default to India if no country specified
  const normalizedCountry = country.toLowerCase().trim();
  return normalizedCountry === 'india' || normalizedCountry === 'in' || normalizedCountry === 'ind';
}

// GET /razorpay/event-price/:eventId - Get event price based on user's country
router.get('/event-price/:eventId', requireAuth, async (req, res) => {
  const eventId = req.params.eventId;
  const userId = req.user!.id;

  try {
    // Get event price
    const eventResult = await pool.query('SELECT id, title, price_paise FROM events WHERE id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get user's country
    const userResult = await pool.query('SELECT country FROM users WHERE id = $1', [userId]);
    const userCountry = userResult.rows[0]?.country;

    const event = eventResult.rows[0];
    const isIndia = isIndianUser(userCountry);

    if (isIndia) {
      return res.json({
        amount: event.price_paise,
        currency: 'INR',
        displayPrice: `₹${(event.price_paise / 100).toFixed(0)}`,
        isInternational: false,
      });
    } else {
      // International user - $10 USD
      return res.json({
        amount: INTERNATIONAL_PRICE_USD_CENTS,
        currency: 'USD',
        displayPrice: '$10',
        isInternational: true,
      });
    }
  } catch (err: any) {
    console.error('Failed to get event price:', err);
    return res.status(500).json({ error: 'Failed to get event price' });
  }
});

// POST /razorpay/create-order - Create a Razorpay order for event subscription
const createOrderSchema = z.object({
  eventId: z.string().uuid(),
});

router.post('/create-order', requireAuth, async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }

  const { eventId } = parsed.data;
  const userId = req.user!.id;

  // Verify event exists and get price
  const eventResult = await pool.query('SELECT id, title, price_paise FROM events WHERE id = $1', [eventId]);
  if (eventResult.rows.length === 0) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // Get user's country
  const userResult = await pool.query('SELECT country FROM users WHERE id = $1', [userId]);
  const userCountry = userResult.rows[0]?.country;

  const event = eventResult.rows[0];
  const isIndia = isIndianUser(userCountry);

  // Determine amount and currency based on user's country
  const amount = isIndia ? event.price_paise : INTERNATIONAL_PRICE_USD_CENTS;
  const currency = isIndia ? 'INR' : 'USD';

  try {
    const order = await createOrder({
      amountPaise: amount, // For USD, this is cents
      currency,
      receipt: `rcpt_${Date.now()}`,
      notes: {
        eventId,
        userId,
        eventTitle: event.title,
        isInternational: String(!isIndia),
      },
    });

    return res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: getRazorpayKeyId(),
      isInternational: !isIndia,
    });
  } catch (err: any) {
    console.error('Razorpay create order error:', err);
    return res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// POST /razorpay/verify-payment - Verify payment and grant ticket
const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  eventId: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.string().min(1),
});

router.post('/verify-payment', requireAuth, async (req, res) => {
  const parsed = verifyPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, eventId, amount, currency } = parsed.data;
  const userId = req.user!.id;

  // Verify signature
  const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!isValid) {
    return res.status(400).json({ error: 'Invalid payment signature' });
  }

  try {
    // Record payment - use RETURNING id to get the payment id for invoice generation
    const paymentResult = await pool.query(
      `INSERT INTO payments (provider, provider_payment_id, user_id, event_id, amount_cents, currency, status, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (provider, provider_payment_id) DO UPDATE SET status = EXCLUDED.status
       RETURNING id`,
      [
        'razorpay',
        razorpay_payment_id,
        userId,
        eventId,
        amount, // Store in paise/cents as-is
        currency,
        'success',
        { razorpay_order_id, razorpay_payment_id, razorpay_signature, currency },
      ]
    );
    const paymentId = paymentResult.rows[0]?.id;
    console.log(`[verify-payment] Payment recorded with id: ${paymentId}`);

    // Create/update ticket as paid
    await pool.query(
      `INSERT INTO tickets (user_id, event_id, status)
       VALUES ($1, $2, 'paid')
       ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'paid'`,
      [userId, eventId]
    );

    // Generate invoice for the payment
    let invoiceId: string | null = null;
    if (paymentId) {
      try {
        const invoice = await createInvoice({
          userId,
          paymentId,
          invoiceType: 'event_ticket',
          eventId,
          amountPaise: amount,
          currency: currency || 'INR',
        });
        if (invoice) {
          invoiceId = invoice.id;
          console.log(`Invoice created for payment ${paymentId}: ${invoice.invoice_number}`);
        } else {
          console.log(`Invoice creation skipped for USD payment ${paymentId} - pending manual creation`);

          // Send admin notification for USD payment
          if (currency === 'USD') {
            try {
              const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
              const eventResult = await pool.query('SELECT title FROM events WHERE id = $1', [eventId]);
              const user = userResult.rows[0];
              const event = eventResult.rows[0];

              await sendUSDPaymentNotification({
                adminEmail: env.admin.notificationEmail,
                customerName: user?.name || 'Unknown',
                customerEmail: user?.email || 'Unknown',
                paymentId: razorpay_payment_id,
                amountUSD: amount / 100, // Convert cents to dollars
                eventTitle: event?.title,
                ticketType: 'event_ticket',
                paymentDate: new Date(),
              });

              console.log(`Admin notification sent for USD event ticket payment: ${razorpay_payment_id}`);
            } catch (emailErr) {
              console.error('Failed to send admin notification:', emailErr);
            }
          }
        }
      } catch (invoiceErr) {
        console.error('Failed to create invoice:', invoiceErr);
        // Don't fail the payment verification if invoice creation fails
      }
    }

    return res.json({ success: true, message: 'Payment verified and ticket granted', invoiceId });
  } catch (err: any) {
    console.error('Payment verification error:', err);
    return res.status(500).json({ error: 'Failed to process payment' });
  }
});

// GET /razorpay/season-ticket-price - Get season ticket price (sum of upcoming paid events with configurable discount)
router.get('/season-ticket-price', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  try {
    // Get user's country
    const userResult = await pool.query('SELECT country FROM users WHERE id = $1', [userId]);
    const userCountry = userResult.rows[0]?.country;
    const isIndia = isIndianUser(userCountry);

    // Get discount percentage from environment variable (default to 10 if not set)
    const discountPercent = parseInt(process.env.SEASON_TICKET_DISCOUNT_PERCENT || '10', 10);
    const discountMultiplier = (100 - discountPercent) / 100;

    // Only include upcoming paid events (ends_at > now AND event_type = 'paid')
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(price_paise), 0) as total
       FROM events
       WHERE ends_at > NOW() AND event_type = 'paid'`
    );
    const totalPaise = parseInt(rows[0].total, 10);
    const discountedPaise = Math.round(totalPaise * discountMultiplier);

    const countResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM events
       WHERE ends_at > NOW() AND event_type = 'paid'`
    );

    const eventCount = parseInt(countResult.rows[0].count, 10);

    // For international users, calculate USD pricing
    if (!isIndia) {
      const pricePerEventUSD = 10; // $10 per event
      const totalUSDCents = pricePerEventUSD * eventCount * 100; // Convert to cents
      const discountedUSDCents = Math.round(totalUSDCents * discountMultiplier);

      return res.json({
        originalCents: totalUSDCents,
        discountedCents: discountedUSDCents,
        discountPercent,
        eventCount,
        currency: 'USD',
        displayPrice: `$${(discountedUSDCents / 100).toFixed(2)}`,
        isInternational: true,
      });
    }

    return res.json({
      originalPaise: totalPaise,
      discountedPaise,
      discountPercent,
      eventCount,
      currency: 'INR',
      displayPrice: `₹${(discountedPaise / 100).toFixed(0)}`,
      isInternational: false,
    });
  } catch (err: any) {
    console.error('Failed to get season ticket price:', err);
    return res.status(500).json({ error: 'Failed to get season ticket price' });
  }
});

// POST /razorpay/create-season-order - Create a Razorpay order for season ticket
router.post('/create-season-order', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  try {
    // Get user's country
    const userResult = await pool.query('SELECT country FROM users WHERE id = $1', [userId]);
    const userCountry = userResult.rows[0]?.country;
    const isIndia = isIndianUser(userCountry);

    // Get discount percentage from environment variable (default to 10 if not set)
    const discountPercent = parseInt(process.env.SEASON_TICKET_DISCOUNT_PERCENT || '10', 10);
    const discountMultiplier = (100 - discountPercent) / 100;

    // Get event count for pricing calculation
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM events WHERE ends_at > NOW() AND event_type = 'paid'`
    );
    const eventCount = parseInt(countResult.rows[0].count, 10);

    if (eventCount <= 0) {
      return res.status(400).json({ error: 'No upcoming events available for season ticket' });
    }

    let amount: number;
    let currency: string;
    let originalAmount: number;
    let discountedAmount: number;

    if (isIndia) {
      // Calculate INR pricing based on sum of event prices
      const { rows } = await pool.query(
        'SELECT COALESCE(SUM(price_paise), 0) as total FROM events WHERE ends_at > NOW() AND event_type = \'paid\''
      );
      const totalPaise = parseInt(rows[0].total, 10);
      const discountedPaise = Math.round(totalPaise * discountMultiplier);

      amount = discountedPaise;
      currency = 'INR';
      originalAmount = totalPaise;
      discountedAmount = discountedPaise;
    } else {
      // Calculate USD pricing: $10 per event
      const pricePerEventUSD = 10;
      const totalUSDCents = pricePerEventUSD * eventCount * 100; // Convert to cents
      const discountedUSDCents = Math.round(totalUSDCents * discountMultiplier);

      amount = discountedUSDCents;
      currency = 'USD';
      originalAmount = totalUSDCents;
      discountedAmount = discountedUSDCents;
    }

    const order = await createOrder({
      amountPaise: amount, // For USD, this is cents
      currency,
      receipt: `season_${Date.now()}`,
      notes: {
        userId,
        type: 'season_ticket',
        isInternational: String(!isIndia),
      },
    });

    return res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: getRazorpayKeyId(),
      originalAmount,
      discountedAmount,
      isInternational: !isIndia,
    });
  } catch (err: any) {
    console.error('Razorpay create season order error:', err);
    return res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// POST /razorpay/verify-season-payment - Verify season ticket payment
const verifySeasonPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  amountPaise: z.number().int().positive(),
  currency: z.string().min(1).optional().default('INR'),
});

router.post('/verify-season-payment', requireAuth, async (req, res) => {
  const parsed = verifySeasonPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amountPaise, currency } = parsed.data;
  const userId = req.user!.id;

  // Verify signature
  const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!isValid) {
    return res.status(400).json({ error: 'Invalid payment signature' });
  }

  try {
    // Record payment
    const paymentResult = await pool.query(
      `INSERT INTO payments (provider, provider_payment_id, user_id, event_id, amount_cents, currency, status, raw_payload)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
       ON CONFLICT (provider, provider_payment_id) DO UPDATE SET status = EXCLUDED.status
       RETURNING id`,
      [
        'razorpay',
        razorpay_payment_id,
        userId,
        amountPaise, // Store in paise/cents as-is
        currency,
        'success',
        { razorpay_order_id, razorpay_payment_id, razorpay_signature, type: 'season_ticket', currency },
      ]
    );
    const paymentId = paymentResult.rows[0]?.id;

    // Create/update season ticket as paid
    await pool.query(
      `INSERT INTO season_tickets (user_id, status, purchased_at)
       VALUES ($1, 'paid', NOW())
       ON CONFLICT (user_id) DO UPDATE SET status = 'paid', purchased_at = NOW()`,
      [userId]
    );

    // Generate invoice for the season ticket payment
    let invoiceId: string | null = null;
    if (paymentId) {
      try {
        const invoice = await createInvoice({
          userId,
          paymentId,
          invoiceType: 'season_ticket',
          amountPaise,
          currency,
        });
        if (invoice) {
          invoiceId = invoice.id;
          console.log(`Invoice created for season ticket payment ${paymentId}: ${invoice.invoice_number}`);
        } else {
          console.log(`Invoice creation skipped for USD payment ${paymentId} - pending manual creation`);

          // Send admin notification for USD payment
          if (currency === 'USD') {
            try {
              const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
              const user = userResult.rows[0];

              await sendUSDPaymentNotification({
                adminEmail: env.admin.notificationEmail,
                customerName: user?.name || 'Unknown',
                customerEmail: user?.email || 'Unknown',
                paymentId: razorpay_payment_id,
                amountUSD: amountPaise / 100, // Convert cents to dollars
                ticketType: 'season_ticket',
                paymentDate: new Date(),
              });

              console.log(`Admin notification sent for USD season ticket payment: ${razorpay_payment_id}`);
            } catch (emailErr) {
              console.error('Failed to send admin notification:', emailErr);
            }
          }
        }
      } catch (invoiceErr) {
        console.error('Failed to create invoice for season ticket:', invoiceErr);
        // Don't fail the payment verification if invoice creation fails
      }
    }

    return res.json({ success: true, message: 'Season ticket purchased successfully', invoiceId });
  } catch (err: any) {
    console.error('Season payment verification error:', err);
    return res.status(500).json({ error: 'Failed to process payment' });
  }
});

// POST /razorpay/webhook - Handle Razorpay webhook events
// This endpoint receives payment notifications from Razorpay
router.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['x-razorpay-signature'] as string;
  
  // Get raw body for signature verification (set by middleware in server.ts)
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  
  // Verify webhook signature
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.error('[Razorpay Webhook] Invalid signature. Signature:', signature?.substring(0, 20) + '...');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = req.body.event;
  const payload = req.body.payload;

  console.log(`[Razorpay Webhook] Received event: ${event}`);

  try {
    // Handle payment.captured event
    if (event === 'payment.captured' || event === 'order.paid') {
      const payment = payload?.payment?.entity;
      const order = payload?.order?.entity || (payment?.order_id ? await fetchOrder(payment.order_id) : null);
      
      if (!payment) {
        console.error('[Razorpay Webhook] No payment entity in payload');
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const orderId = payment.order_id;
      const paymentId = payment.id;
      const amount = payment.amount;
      const currency = payment.currency;
      const notes = order?.notes || payment.notes || {};

      console.log(`[Razorpay Webhook] Processing payment: ${paymentId} for order: ${orderId}`);
      console.log(`[Razorpay Webhook] Notes:`, notes);

      // Check if this is a season ticket payment
      if (notes.type === 'season_ticket') {
        const userId = notes.userId;
        
        if (!userId) {
          console.error('[Razorpay Webhook] No userId in season ticket notes');
          return res.status(400).json({ error: 'Missing userId in notes' });
        }

        // Record payment
        const paymentResult = await pool.query(
          `INSERT INTO payments (provider, provider_payment_id, user_id, event_id, amount_cents, currency, status, raw_payload)
           VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
           ON CONFLICT (provider, provider_payment_id) DO UPDATE SET status = EXCLUDED.status
           RETURNING id`,
          ['razorpay', paymentId, userId, amount, currency, 'success', req.body]
        );

        // Create/update season ticket
        await pool.query(
          `INSERT INTO season_tickets (user_id, status, purchased_at)
           VALUES ($1, 'paid', NOW())
           ON CONFLICT (user_id) DO UPDATE SET status = 'paid', purchased_at = NOW()`,
          [userId]
        );

        // Generate invoice for season ticket
        try {
          const invoice = await createInvoice({
            userId,
            paymentId: paymentResult.rows[0].id,
            invoiceType: 'season_ticket',
            amountPaise: amount,
            currency: currency
          });
          if (invoice) {
            console.log(`[Razorpay Webhook] Invoice generated: ${invoice.invoice_number}`);
          } else {
            console.log(`[Razorpay Webhook] Invoice creation skipped for USD payment - pending manual creation`);

            // Send admin notification for USD payment
            if (currency === 'USD') {
              try {
                const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
                const user = userResult.rows[0];

                await sendUSDPaymentNotification({
                  adminEmail: env.admin.notificationEmail,
                  customerName: user?.name || 'Unknown',
                  customerEmail: user?.email || 'Unknown',
                  paymentId: paymentId,
                  amountUSD: amount / 100, // Convert cents to dollars
                  ticketType: 'season_ticket',
                  paymentDate: new Date(),
                });

                console.log(`[Razorpay Webhook] Admin notification sent for USD season ticket payment: ${paymentId}`);
              } catch (emailErr) {
                console.error('[Razorpay Webhook] Failed to send admin notification:', emailErr);
              }
            }
          }
        } catch (invoiceErr) {
          console.error('[Razorpay Webhook] Failed to generate invoice:', invoiceErr);
        }

        console.log(`[Razorpay Webhook] Season ticket granted for user: ${userId}`);
      } else {
        // Regular event ticket payment
        const eventId = notes.eventId;
        const userId = notes.userId;

        if (!eventId || !userId) {
          console.error('[Razorpay Webhook] Missing eventId or userId in notes');
          return res.status(400).json({ error: 'Missing eventId or userId in notes' });
        }

        // Record payment
        const paymentResult = await pool.query(
          `INSERT INTO payments (provider, provider_payment_id, user_id, event_id, amount_cents, currency, status, raw_payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (provider, provider_payment_id) DO UPDATE SET status = EXCLUDED.status
           RETURNING id`,
          ['razorpay', paymentId, userId, eventId, amount, currency, 'success', req.body]
        );

        // Create/update ticket as paid
        await pool.query(
          `INSERT INTO tickets (user_id, event_id, status)
           VALUES ($1, $2, 'paid')
           ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'paid'`,
          [userId, eventId]
        );

        // Generate invoice for event ticket
        try {
          const invoice = await createInvoice({
            userId,
            paymentId: paymentResult.rows[0].id,
            invoiceType: 'event_ticket',
            eventId,
            amountPaise: amount,
            currency: currency
          });
          if (invoice) {
            console.log(`[Razorpay Webhook] Invoice generated: ${invoice.invoice_number}`);
          } else {
            console.log(`[Razorpay Webhook] Invoice creation skipped for USD payment - pending manual creation`);

            // Send admin notification for USD payment
            if (currency === 'USD') {
              try {
                const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
                const eventResult = await pool.query('SELECT title FROM events WHERE id = $1', [eventId]);
                const user = userResult.rows[0];
                const event = eventResult.rows[0];

                await sendUSDPaymentNotification({
                  adminEmail: env.admin.notificationEmail,
                  customerName: user?.name || 'Unknown',
                  customerEmail: user?.email || 'Unknown',
                  paymentId: paymentId,
                  amountUSD: amount / 100, // Convert cents to dollars
                  eventTitle: event?.title,
                  ticketType: 'event_ticket',
                  paymentDate: new Date(),
                });

                console.log(`[Razorpay Webhook] Admin notification sent for USD event ticket payment: ${paymentId}`);
              } catch (emailErr) {
                console.error('[Razorpay Webhook] Failed to send admin notification:', emailErr);
              }
            }
          }
        } catch (invoiceErr) {
          console.error('[Razorpay Webhook] Failed to generate invoice:', invoiceErr);
        }

        console.log(`[Razorpay Webhook] Ticket granted for user: ${userId}, event: ${eventId}`);
      }
    } else if (event === 'payment.failed') {
      const payment = payload?.payment?.entity;
      if (payment) {
        console.log(`[Razorpay Webhook] Payment failed: ${payment.id}, reason: ${payment.error_description}`);
      }
    }

    return res.json({ status: 'ok' });
  } catch (err: any) {
    console.error('[Razorpay Webhook] Error processing webhook:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /razorpay/verify-pending - Check and verify any pending payments for the user
router.get('/verify-pending', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  try {
    // Check if user has any recent pending tickets (created in last 30 minutes)
    const pendingTickets = await pool.query(
      `SELECT t.event_id, t.status, t.created_at 
       FROM tickets t 
       WHERE t.user_id = $1 AND t.status = 'pending' 
       AND t.created_at > NOW() - INTERVAL '30 minutes'`,
      [userId]
    );

    // Check if user has pending season ticket
    const pendingSeasonTicket = await pool.query(
      `SELECT status, created_at 
       FROM season_tickets 
       WHERE user_id = $1 AND status = 'pending' 
       AND created_at > NOW() - INTERVAL '30 minutes'`,
      [userId]
    );

    // Get current ticket status
    const ticketStatus = await pool.query(
      `SELECT event_id, status FROM tickets WHERE user_id = $1`,
      [userId]
    );

    const seasonTicketStatus = await pool.query(
      `SELECT status, purchased_at FROM season_tickets WHERE user_id = $1`,
      [userId]
    );

    return res.json({
      tickets: ticketStatus.rows.reduce((acc: Record<string, string>, row: any) => {
        acc[row.event_id] = row.status;
        return acc;
      }, {}),
      hasSeasonTicket: seasonTicketStatus.rows[0]?.status === 'paid',
      seasonTicketPurchasedAt: seasonTicketStatus.rows[0]?.purchased_at || null,
      hasPendingPayments: pendingTickets.rows.length > 0 || pendingSeasonTicket.rows.length > 0,
    });
  } catch (err: any) {
    console.error('[Razorpay] Error verifying pending payments:', err);
    return res.status(500).json({ error: 'Failed to verify pending payments' });
  }
});

export default router;
