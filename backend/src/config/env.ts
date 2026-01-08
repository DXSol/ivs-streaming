import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Determine environment (default to development)
const nodeEnv = process.env.NODE_ENV || 'development';

// Backend root directory (where .env files should be placed)
// Use process.cwd() which gives the working directory where node was started (/app)
// This is more reliable than __dirname which depends on compiled file structure
const backendRoot = process.cwd();

// Environment-specific file names in priority order (highest first)
// Priority: .env.{environment}.local > .env.{environment} > .env.local > .env
const envFileNames = [
  `.env.${nodeEnv}.local`,  // Highest priority: local overrides for specific env (gitignored)
  `.env.${nodeEnv}`,        // Environment-specific (e.g., .env.development, .env.production)
  '.env.local',             // Local overrides for any environment (gitignored)
  '.env',                   // Default fallback
];

// Find and load env files (load in reverse order so higher priority overrides)
const loadedFiles: string[] = [];

for (const fileName of [...envFileNames].reverse()) {
  const filePath = path.resolve(backendRoot, fileName);
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: filePath, override: true });
    loadedFiles.push(filePath);
  }
}

if (loadedFiles.length > 0) {
  console.log(`[Env] Environment: ${nodeEnv}`);
  console.log(`[Env] Backend root: ${backendRoot}`);
  console.log(`[Env] Loaded files: ${loadedFiles.join(', ')}`);
} else {
  console.log(`[Env] No .env files found in ${backendRoot}, using process environment variables`);
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

  company: {
    name: process.env.COMPANY_NAME || 'Company Name',
    address: process.env.COMPANY_ADDRESS || 'Company Address',
    phone: process.env.PHONE_NUMBER || '',
    gstin: process.env.COMPANY_GSTIN || 'GSTIN',
    sacCode: process.env.SAC_CODE || '998439',
    cin: process.env.COMPANY_CIN || '',
    pan: process.env.COMPANY_PAN || '',
    email: process.env.COMPANY_EMAIL || 'info@company.com',
    registrationNumber: process.env.COMPANY_REG_NUMBER || '',
    udyamNumber: process.env.COMPANY_UDYAM_NUMBER || '',
    stateCode: process.env.COMPANY_STATE_CODE || '36',
    stateName: process.env.COMPANY_STATE_NAME || 'Telangana',
    bankName: process.env.COMPANY_BANK_NAME || '',
    bankAccountNumber: process.env.COMPANY_BANK_ACCOUNT_NUMBER || '',
    bankIfscCode: process.env.COMPANY_BANK_IFSC_CODE || '',
    bankBranch: process.env.COMPANY_BANK_BRANCH || '',
  },

  // Old company details (DX Solutions) for invoices before 2026-01-01 19:00 IST
  companyOld: {
    name: process.env.COMPANY_NAME_OLD || 'DX Solutions',
    address: process.env.COMPANY_ADDRESS_OLD || 'Company Address',
    phone: process.env.PHONE_NUMBER_OLD || '',
    gstin: process.env.COMPANY_GSTIN_OLD || 'GSTIN',
    sacCode: process.env.SAC_CODE_OLD || '998439',
    cin: process.env.COMPANY_CIN_OLD || '',
    pan: process.env.COMPANY_PAN_OLD || '',
    email: process.env.COMPANY_EMAIL_OLD || 'info@company.com',
    registrationNumber: process.env.COMPANY_REG_NUMBER_OLD || '',
    udyamNumber: process.env.COMPANY_UDYAM_NUMBER_OLD || '',
    stateCode: process.env.COMPANY_STATE_CODE_OLD || '36',
    stateName: process.env.COMPANY_STATE_NAME_OLD || 'Telangana',
    bankName: process.env.COMPANY_BANK_NAME_OLD || '',
    bankAccountNumber: process.env.COMPANY_BANK_ACCOUNT_NUMBER_OLD || '',
    bankIfscCode: process.env.COMPANY_BANK_IFSC_CODE_OLD || '',
    bankBranch: process.env.COMPANY_BANK_BRANCH_OLD || '',
  },

  chromecast: {
    enableLiveCasting: process.env.CHROMECAST_ENABLE_LIVE === 'true',
    enableRecordingCasting: process.env.CHROMECAST_ENABLE_RECORDING !== 'false', // Default true for recordings
  },

  invoices: {
    recipientEmails: process.env.INVOICE_RECIPIENT_EMAILS
      ? process.env.INVOICE_RECIPIENT_EMAILS.split(',').map(email => email.trim()).filter(email => email.length > 0)
      : [],
  },

  admin: {
    notificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL || 'admin@sankeertanotsav.com',
  },

  frontend: {
    url: process.env.FRONTEND_URL || 'https://events.sampradya.live',
  },
};
