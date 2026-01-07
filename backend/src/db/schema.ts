import { pool } from './pool';

export async function ensureSchema() {
  // Minimal schema bootstrap for local dev.
  // For production: replace with proper migrations.

  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('viewer','admin','superadmin','finance-admin','content-admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'paid' CHECK (event_type IN ('paid','free','free-short')),
      ivs_channel_arn TEXT,
      playback_url TEXT,
      youtube_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending','paid','revoked')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, event_id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      provider_payment_id TEXT NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      event_id UUID REFERENCES events(id) ON DELETE SET NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      raw_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(provider, provider_payment_id)
    );

    CREATE TABLE IF NOT EXISTS ivs_access_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      event_id UUID REFERENCES events(id) ON DELETE SET NULL,
      ip INET,
      user_agent TEXT,
      token_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS event_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS playback_url TEXT;");
  await pool.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS poster_url TEXT;");
  await pool.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS price_paise INTEGER NOT NULL DEFAULT 50000;");
  await pool.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'paid' CHECK (event_type IN ('paid','free'));");
  await pool.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS youtube_url TEXT;");
  await pool.query("ALTER TABLE events ALTER COLUMN ivs_channel_arn DROP NOT NULL;");
  await pool.query("ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;");
  await pool.query("ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK (event_type IN ('paid','free','free-short'));");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile TEXT;");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;");
  await pool.query("ALTER TABLE users ALTER COLUMN email DROP NOT NULL;");
  await pool.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS recording_s3_path TEXT;");
  await pool.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS recording_only BOOLEAN NOT NULL DEFAULT false;");
  await pool.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS recording_available_hours INTEGER NOT NULL DEFAULT 0;");
  await pool.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS allow_past_purchase BOOLEAN NOT NULL DEFAULT true;");

  // Season ticket table - grants access to all events
  await pool.query(`
    CREATE TABLE IF NOT EXISTS season_tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending','paid','revoked')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id)
    );
  `);

  // Add purchased_at column to season_tickets if it doesn't exist
  await pool.query("ALTER TABLE season_tickets ADD COLUMN IF NOT EXISTS purchased_at TIMESTAMPTZ;");

  // Update existing paid season tickets to have purchased_at set to created_at if NULL
  await pool.query(`
    UPDATE season_tickets
    SET purchased_at = created_at
    WHERE status = 'paid' AND purchased_at IS NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_viewer_stats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      viewer_count INTEGER NOT NULL DEFAULT 0,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_event_viewer_stats_event_id ON event_viewer_stats(event_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_event_viewer_stats_recorded_at ON event_viewer_stats(recorded_at);
  `);

  // Viewing sessions table - track active viewing sessions per user/event
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viewing_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id TEXT NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(session_id, user_id, event_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_viewing_sessions_user_event ON viewing_sessions(user_id, event_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_viewing_sessions_heartbeat ON viewing_sessions(last_heartbeat);
  `);

  // Password reset tokens table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
  `);

  // Invoices table - GST compliant invoices for purchases
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_number TEXT NOT NULL UNIQUE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
      invoice_type TEXT NOT NULL CHECK (invoice_type IN ('event_ticket', 'season_ticket')),
      event_id UUID REFERENCES events(id) ON DELETE SET NULL,
      customer_name TEXT,
      customer_email TEXT,
      customer_address TEXT,
      subtotal_paise INTEGER NOT NULL,
      cgst_paise INTEGER NOT NULL DEFAULT 0,
      sgst_paise INTEGER NOT NULL DEFAULT 0,
      igst_paise INTEGER NOT NULL DEFAULT 0,
      total_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      company_name TEXT NOT NULL,
      company_address TEXT NOT NULL,
      company_phone TEXT,
      company_gstin TEXT NOT NULL,
      sac_code TEXT,
      invoice_date TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date);
  `);

  // Add company_phone column if it doesn't exist
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_phone TEXT;");

  // Add sac_code column if it doesn't exist
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sac_code TEXT;");

  // Add additional company fields for detailed invoices
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_cin TEXT;");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_pan TEXT;");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_email TEXT;");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_registration_number TEXT;");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_udyam_number TEXT;");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_state_code TEXT;");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_state_name TEXT;");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_bank_name TEXT;");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_bank_account_number TEXT;");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_bank_ifsc_code TEXT;");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_bank_branch TEXT;");

  // Add columns for USD invoice handling
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_pending BOOLEAN DEFAULT FALSE;");
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(10,4);");

  // Update users table role constraint to include all admin roles
  await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;");
  await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('viewer','admin','superadmin','finance-admin','content-admin'));");

  // Add mobile and is_active columns to users table
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile TEXT;");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;");
}
