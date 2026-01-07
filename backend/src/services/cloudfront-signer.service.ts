import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { env } from '../config/env';

export interface SignedUrlResult {
  signedUrl: string;
  expiresAt: Date;
}

/**
 * Convert escaped newlines in PEM key to actual newlines.
 * Environment variables often store \n as literal characters.
 */
function normalizePrivateKey(key: string): string {
  // Replace literal \n with actual newlines
  let normalized = key.replace(/\\n/g, '\n');
  
  // Ensure proper PEM format
  if (!normalized.includes('-----BEGIN')) {
    // Try to wrap if it looks like a base64 key without headers
    normalized = `-----BEGIN RSA PRIVATE KEY-----\n${normalized}\n-----END RSA PRIVATE KEY-----`;
  }
  
  return normalized;
}

/**
 * Generate a CloudFront signed URL for accessing S3 recordings.
 * Uses CloudFront key pair for signing (not S3 presigned URLs).
 */
export function generateSignedRecordingUrl(
  resourcePath: string,
  expiryMinutes: number = env.recordings.signedUrlExpiryMinutes
): SignedUrlResult {
  if (!env.cloudfront.recordingsDistributionDomain) {
    throw new Error('CloudFront recordings distribution domain is not configured');
  }
  if (!env.cloudfront.keyPairId || !env.cloudfront.privateKeyPem) {
    throw new Error('CloudFront key pair is not configured');
  }

  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  
  // Construct the full CloudFront URL
  const url = `https://${env.cloudfront.recordingsDistributionDomain}/${resourcePath}`;

  // Normalize the private key (handle escaped newlines from env vars)
  const privateKey = normalizePrivateKey(env.cloudfront.privateKeyPem);

  const signedUrl = getSignedUrl({
    url,
    keyPairId: env.cloudfront.keyPairId,
    privateKey,
    dateLessThan: expiresAt.toISOString(),
  });

  return { signedUrl, expiresAt };
}

/**
 * Build the S3 recording path for an event.
 * IVS stores recordings in: s3://{bucket}/{prefix}/{channelId}/{streamId}/...
 * We'll use a simplified path: {prefix}/{eventId}/index.m3u8
 */
export function getRecordingPath(eventId: string): string {
  return `${env.s3.recordingsPrefix}/${eventId}/index.m3u8`;
}

/**
 * Check if a recording is still within the allowed viewing window.
 * For upcoming events: expiry = event_end + 3 days
 * For past events: expiry = payment_date + 3 days
 */
export function isRecordingExpired(eventEndDate: Date, paymentDate?: Date): boolean {
  const now = new Date();

  // Calculate expiry as exact milliseconds (days * 24 hours * 60 minutes * 60 seconds * 1000 ms)
  const expiryMilliseconds = env.recordings.expiryDays * 24 * 60 * 60 * 1000;

  // If no payment date, use event end date + expiry days
  if (!paymentDate) {
    const expiryDate = new Date(eventEndDate.getTime() + expiryMilliseconds);
    return now > expiryDate;
  }

  // Check if payment was made before or after event ended
  const eventEndedAtPurchase = paymentDate > eventEndDate;

  // If purchased BEFORE event ended: use event_end + 3 days
  if (!eventEndedAtPurchase) {
    const expiryDate = new Date(eventEndDate.getTime() + expiryMilliseconds);
    return now > expiryDate;
  }

  // If purchased AFTER event ended: use payment_date + 3 days
  const paymentExpiryDate = new Date(paymentDate.getTime() + expiryMilliseconds);
  return now > paymentExpiryDate;
}

/**
 * Get the expiry date for a recording.
 * For upcoming events: expiry = event_end + 3 days
 * For past events: expiry = payment_date + 3 days
 */
export function getRecordingExpiryDate(eventEndDate: Date, paymentDate?: Date): Date {
  // Calculate expiry as exact milliseconds (days * 24 hours * 60 minutes * 60 seconds * 1000 ms)
  const expiryMilliseconds = env.recordings.expiryDays * 24 * 60 * 60 * 1000;

  // If no payment date, use event end date + expiry days
  if (!paymentDate) {
    return new Date(eventEndDate.getTime() + expiryMilliseconds);
  }

  // Check if payment was made before or after event ended
  const eventEndedAtPurchase = paymentDate > eventEndDate;

  // If purchased BEFORE event ended: use event_end + 3 days
  if (!eventEndedAtPurchase) {
    return new Date(eventEndDate.getTime() + expiryMilliseconds);
  }

  // If purchased AFTER event ended: use payment_date + 3 days
  return new Date(paymentDate.getTime() + expiryMilliseconds);
}
