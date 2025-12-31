import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { ensureSchema } from '../db/schema';

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function upsertUser(email: string, password: string, role: 'viewer' | 'admin') {
  const passwordHash = await bcrypt.hash(password, 10);

  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
     RETURNING id, email, role`,
    [email, passwordHash, role]
  );

  return rows[0] as { id: string; email: string; role: string };
}

async function main() {
  // Load dotenv the same way as the server
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../config/env');

  await ensureSchema();

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
  const viewerEmail = process.env.SEED_VIEWER_EMAIL || 'viewer@example.com';
  const viewerPassword = process.env.SEED_VIEWER_PASSWORD || 'Viewer@12345';

  const ivsChannelArn = mustGetEnv('SEED_EVENT_IVS_CHANNEL_ARN');

  const now = new Date();
  const startsAt = new Date(now.getTime() - 5 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 60 * 60 * 1000);

  const admin = await upsertUser(adminEmail, adminPassword, 'admin');
  const viewer = await upsertUser(viewerEmail, viewerPassword, 'viewer');

  const eventInsert = await pool.query(
    `INSERT INTO events (title, description, starts_at, ends_at, ivs_channel_arn)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, title, starts_at, ends_at`,
    [
      'Demo Live Event',
      'Seeded event for local testing',
      startsAt.toISOString(),
      endsAt.toISOString(),
      ivsChannelArn,
    ]
  );

  const event = eventInsert.rows[0] as { id: string; title: string };

  await pool.query(
    `INSERT INTO tickets (user_id, event_id, status)
     VALUES ($1,$2,'paid')
     ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'paid'`,
    [viewer.id, event.id]
  );

  // eslint-disable-next-line no-console
  console.log('Seed complete');
  // eslint-disable-next-line no-console
  console.log({
    admin: { email: adminEmail, password: adminPassword },
    viewer: { email: viewerEmail, password: viewerPassword },
    eventId: event.id,
  });

  await pool.end();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
