import Razorpay from 'razorpay';
import crypto from 'crypto';
import { env } from '../config/env';

let razorpayInstance: Razorpay | null = null;

function getRazorpayInstance(): Razorpay {
  if (!razorpayInstance) {
    if (!env.razorpay.keyId || !env.razorpay.keySecret) {
      throw new Error('Razorpay credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
    }
    razorpayInstance = new Razorpay({
      key_id: env.razorpay.keyId,
      key_secret: env.razorpay.keySecret,
    });
  }
  return razorpayInstance;
}

export interface CreateOrderParams {
  amountPaise: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrder {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  created_at: number;
}

export async function createOrder(params: CreateOrderParams): Promise<RazorpayOrder> {
  const options = {
    amount: params.amountPaise,
    currency: params.currency || 'INR',
    receipt: params.receipt || `rcpt_${Date.now()}`,
    notes: params.notes || {},
  };

  const order = await getRazorpayInstance().orders.create(options);
  return order as RazorpayOrder;
}

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const body = orderId + '|' + paymentId;
  const expectedSignature = crypto
    .createHmac('sha256', env.razorpay.keySecret)
    .update(body)
    .digest('hex');

  return expectedSignature === signature;
}

export function getRazorpayKeyId(): string {
  return env.razorpay.keyId;
}

export function verifyWebhookSignature(body: string, signature: string): boolean {
  if (!env.razorpay.webhookSecret) {
    console.warn('[Razorpay] Webhook secret not configured, skipping signature verification');
    return true; // Allow in development, but log warning
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', env.razorpay.webhookSecret)
    .update(body)
    .digest('hex');

  return expectedSignature === signature;
}

export async function fetchOrder(orderId: string): Promise<RazorpayOrder | null> {
  try {
    const order = await getRazorpayInstance().orders.fetch(orderId);
    return order as RazorpayOrder;
  } catch (err) {
    console.error('[Razorpay] Failed to fetch order:', err);
    return null;
  }
}

export async function fetchPayment(paymentId: string): Promise<any | null> {
  try {
    const payment = await getRazorpayInstance().payments.fetch(paymentId);
    return payment;
  } catch (err) {
    console.error('[Razorpay] Failed to fetch payment:', err);
    return null;
  }
}
