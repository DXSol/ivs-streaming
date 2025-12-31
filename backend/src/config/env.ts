import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envAtBackendRoot = path.resolve(__dirname, '../../.env');
const envAtSrc = path.resolve(__dirname, '../.env');

if (fs.existsSync(envAtBackendRoot)) {
  dotenv.config({ path: envAtBackendRoot, override: true });
} else if (fs.existsSync(envAtSrc)) {
  dotenv.config({ path: envAtSrc, override: true });
} else {
  dotenv.config({ override: true });
}

export const env = {
  port: Number(process.env.PORT || 5050),
  nodeEnv: process.env.NODE_ENV || 'development',

  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-change-me',
  jwtIssuer: process.env.JWT_ISSUER || 'ivs-live-streaming',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ivs_live',
  },

  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },

  ivsPlaybackAuth: {
    keyPairId: process.env.IVS_PLAYBACK_KEY_PAIR_ID || '',
    privateKeyPem: process.env.IVS_PLAYBACK_PRIVATE_KEY || '',
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.RESEND_FROM_EMAIL || 'noreply@sankeertanotsav.com',
  },

  app: {
    frontendUrl: process.env.FRONTEND_URL || 'https://events.sampradya.live',
  },

  cloudfront: {
    recordingsDistributionDomain: process.env.CLOUDFRONT_RECORDINGS_DOMAIN || '',
    keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID || '',
    privateKeyPem: process.env.CLOUDFRONT_PRIVATE_KEY || '',
  },

  s3: {
    recordingsBucket: process.env.S3_RECORDINGS_BUCKET || 'ivs-recordings-yourapp',
    recordingsPrefix: process.env.S3_RECORDINGS_PREFIX || 'ivs-recordings/events',
  },

  recordings: {
    expiryDays: Number(process.env.RECORDINGS_EXPIRY_DAYS || 3),
    signedUrlExpiryMinutes: Number(process.env.RECORDINGS_SIGNED_URL_EXPIRY_MINUTES || 30),
  },
};
