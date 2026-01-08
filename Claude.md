# Claude Project Context - Sampradaya Events (IVS Live Streaming Platform)

## Project Overview

**Sampradaya Events** (Sankeertanotsav 2026 Live) is a production-grade live streaming platform for Indian classical music performances, built with Angular/Ionic frontend and Node.js/Express backend. The platform supports multi-currency payments (INR with GST compliance, USD), live streaming via AWS IVS, recorded video playback, and comprehensive invoice management.

**Repository:** ivs-streaming
**Current Branch:** nice-wu
**Main Branch:** main

**IMPORTANT - Branch Strategy:**
- **Always work on the `nice-wu` branch** for all development and bug fixes
- When starting a new Claude Code session, continue working on `nice-wu` branch
- Do NOT create new feature branches unless explicitly requested by the user
- Only merge to `main` when the user explicitly requests deployment to production
- All commits should be made to `nice-wu` branch

## Technology Stack

### Frontend
- **Framework:** Angular 19 (Standalone Components) + Ionic 8
- **Mobile:** Capacitor 6 (iOS/Android cross-platform)
- **Language:** TypeScript 5.8
- **Styling:** SCSS
- **State Management:** RxJS 7.8 (BehaviorSubject pattern)

### Backend
- **Runtime:** Node.js 20 (TypeScript)
- **Framework:** Express.js 4.19
- **Database:** PostgreSQL 16-Alpine
- **Authentication:** JWT + bcryptjs

### External Services
- **Live Streaming:** AWS IVS (Interactive Video Service)
- **Storage:** AWS S3 + CloudFront CDN
- **Payments:** Razorpay (Indian payment gateway)
- **Email:** Resend
- **PDF Generation:** Puppeteer with Chromium

## Architecture

```
Apache2 (Port 80/443)
├── Static Files: /var/www/ivs-streaming/www/
└── API Proxy: /api/* → localhost:5050
                         ↓
                Docker Backend (Node.js)
                         ↓
                PostgreSQL (Docker)
```

## Key Features

### User Management
- 5 User Roles: `viewer`, `admin`, `superadmin`, `finance-admin`, `content-admin`
- Registration with email/mobile + password
- Login supports both email and mobile (with `is_active` check)
- Password reset via email tokens
- Role-based access control (RBAC)

### Payment & Invoicing
- **INR Payments:** Automatic invoice generation with GST (CGST/SGST/IGST)
- **USD Payments:** Manual invoice generation with currency conversion
- **Season Tickets:** Annual pass with discount support
- **Invoice Formats:** PDF generation with company details, bank info, state GST info
- **Email Delivery:** Automated invoice emails to customers and admins
- **Compliance:** GST-compliant invoices with SAC code, CIN, PAN, GSTIN

### Event Management
- Three event types: `paid`, `free`, `free-short`
- Live streaming via AWS IVS
- Recording storage on S3 with CloudFront signed URLs
- Recording expiry management (configurable hours)
- Support for recording-only events (no live stream)
- Real-time viewer statistics with peak tracking

### Video Streaming
- AWS IVS live playback with signed URLs
- CloudFront CDN for recorded videos
- Multiple player support: IVS player, HTML5, YouTube fallback
- Chromecast support for live and recorded content
- Viewer session tracking with heartbeat mechanism

## Project Structure

```
ivs-streaming/
├── src/                          # Angular frontend
│   ├── app/
│   │   ├── admin/               # Admin dashboard, user management, invoices
│   │   ├── auth/                # Auth guards (role-based)
│   │   ├── events/              # Event listing and details
│   │   ├── watch/               # Video player page
│   │   ├── services/            # API clients, auth service
│   │   └── shared/              # Reusable components
│   └── environments/            # Environment configs
│
├── backend/
│   ├── src/
│   │   ├── routes/              # Express route handlers
│   │   │   ├── auth.ts         # Login, register, password reset
│   │   │   ├── invoices.ts     # Invoice CRUD, PDF download
│   │   │   ├── admin.ts        # Admin user management, USD invoices
│   │   │   ├── recordings.ts   # Recording playback URLs
│   │   │   └── ...
│   │   ├── services/            # Business logic
│   │   │   ├── pdf.service.ts           # Invoice PDF generation
│   │   │   ├── invoice-email.service.ts # Email delivery
│   │   │   ├── ivs.service.ts           # AWS IVS integration
│   │   │   ├── cloudfront-signer.service.ts
│   │   │   └── razorpay.service.ts
│   │   ├── middleware/          # Auth, RBAC middleware
│   │   ├── db/                  # PostgreSQL schema & pool
│   │   ├── config/              # Environment variable loading
│   │   ├── scripts/             # Seed data, invoice regeneration
│   │   └── templates/           # HTML templates for PDFs
│   ├── Dockerfile              # Multi-stage Docker build
│   ├── docker-compose.yml      # PostgreSQL + Backend
│   └── .dockerignore
│
└── .claude-worktrees/          # Claude Code worktrees
```

## Database Schema (Key Tables)

```sql
users
  - id (UUID), email, mobile, name, password_hash
  - role (viewer|admin|superadmin|finance-admin|content-admin)
  - is_active (boolean)
  - country, address

events
  - id (UUID), title, description
  - starts_at, ends_at
  - event_type (paid|free|free-short)
  - ivs_channel_arn, playback_url, youtube_url
  - price_paise, recording_s3_path
  - recording_only, recording_available_hours

tickets
  - user_id, event_id (composite key)
  - status (pending|paid|revoked)

payments
  - id (UUID), provider, provider_payment_id
  - user_id, event_id
  - amount_cents, currency (INR|USD)
  - status, invoice_pending, exchange_rate

invoices
  - id (UUID), invoice_number (UNIQUE)
  - user_id, payment_id
  - invoice_type (event_ticket|season_ticket)
  - customer details (name, email, address)
  - amounts: subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise
  - company details: gstin, pan, cin, state_code, state_name
  - bank details: bank_name, account_number, ifsc_code, branch
  - invoice_date, created_at

season_tickets
  - user_id (UNIQUE)
  - status (pending|paid|revoked)
  - purchased_at

viewing_sessions
  - session_id, user_id, event_id
  - last_heartbeat (for active viewer tracking)

event_viewer_stats
  - event_id, viewer_count, recorded_at
  - (Captured every 5 minutes via cron job)
```

## Recent Changes & Current State

### Branch: nice-wu (Latest Work)

**Fixes Completed:**
1. **Admin Role Permissions** - Fixed hardcoded `role === 'admin'` checks to support all admin roles
   - Modified: `backend/src/routes/invoices.ts` (2 places)
   - Modified: `backend/src/routes/recordings.ts`
   - Now properly checks: `['admin', 'superadmin', 'finance-admin', 'content-admin']`

2. **Invoice Email Service** - Fixed missing company fields in PDF invoices sent via email
   - Modified: `backend/src/services/invoice-email.service.ts`
   - Added missing fields: state_code, state_name, bank details, company registration details

3. **User Creation Validation** - Added duplicate email/mobile checks
   - Modified: `backend/src/routes/admin.ts`
   - Prevents creating admin users with duplicate email or mobile numbers

4. **Login Security** - Added `is_active` check
   - Modified: `backend/src/routes/auth.ts`
   - Prevents disabled users from logging in

5. **Docker Environment Loading** - Fixed .env file loading in production
   - Modified: `backend/src/config/env.ts` (use `process.cwd()` instead of `__dirname`)
   - Modified: `backend/.dockerignore` (allow .env files to be copied)
   - Modified: `backend/Dockerfile` (copy .env files from builder to production stage)

6. **Invoice Regeneration Script** - Skip USD payments in bulk regeneration
   - Modified: `backend/src/scripts/regenerate-invoices.ts`
   - Only processes INR payments with `currency = 'INR'` filter

7. **Debug Log Cleanup** - Removed debug console.log statements
   - Modified: `backend/src/routes/auth.ts`
   - Modified: `backend/src/config/env.ts`
   - Modified: `src/app/events/events.page.ts`

8. **Pending USD Invoices Page Modernization** - Complete redesign and UX improvements
   - Modified: `src/app/admin/pending-usd-invoices/pending-usd-invoices.page.ts`
   - Modified: `src/app/admin/pending-usd-invoices/pending-usd-invoices.page.html`
   - Modified: `src/app/admin/pending-usd-invoices/pending-usd-invoices.page.scss`
   - Removed default exchange rate values (now mandatory user input)
   - Added strict validation (no null, empty, or 0 values)
   - Fixed payment date timezone display (UTC to IST using Intl.DateTimeFormat)
   - Modernized design with gradient cards, improved spacing, responsive grid
   - Better badge styling and alignment

**New Features:**
- Admin User Management page (`src/app/admin/manage-users/`)
- Role Guard (`src/app/auth/role.guard.ts`)

## Development & Production Environments

### Local Development Environment

**Operating System:** Windows 11
**Docker:** Not used (native Node.js and PostgreSQL)
**Development Server:**
- Frontend: http://localhost:4200
- Backend: http://localhost:5050

```bash
# Frontend (http://localhost:4200)
cd /path/to/ivs-streaming
npm install
npm start

# Backend (http://localhost:5050)
cd backend
npm install
npm run dev

# Database (PostgreSQL installed locally on Windows)
# Runs as Windows service or standalone
```

### Production Environment

**Cloud Provider:** AWS EC2
**Instance Type:** t2.small
- **Processor:** x86_64 (Intel/AMD 64-bit)
- **RAM:** 2GB
- **Storage:**
  - Root Volume: 30GB (OS, system files)
  - Data Volume: 30GB (application data, database)

**Architecture:** Single-server deployment
- Frontend (Angular static files) - served by Apache2
- Backend (Node.js + Docker) - proxied through Apache2
- Database (PostgreSQL + Docker) - same server
- All components hosted on the same EC2 instance

**Web Server:** Apache2 (Port 80/443)
- Static files served from `/var/www/ivs-streaming/www/`
- API requests proxied to `localhost:5050`
- SSL/TLS via Let's Encrypt

**Application Directory:** `/data/www/ivs-streaming`

### Production Deployment

```bash
# On production server (/data/www/ivs-streaming)
cd /data/www/ivs-streaming

# Pull latest code
git pull origin nice-wu

# Frontend build
npm install
npm run build
# Output: www/ directory (served by Apache2)

# Backend rebuild
cd backend
docker-compose build --no-cache backend
docker-compose up -d

# Check logs
sudo docker logs ivs-backend
sudo docker logs ivs-postgres
```

### Database Operations

```bash
# Access PostgreSQL
sudo docker exec -it ivs-postgres psql -U postgres -d ivs_live

# Run SQL query
sudo docker exec -i ivs-postgres psql -U postgres -d ivs_live -c "SELECT * FROM users WHERE role='superadmin';"

# Seed test data
cd backend
npm run seed
```

### Invoice Management

```bash
# Regenerate all INR invoices (skips USD)
cd backend
npm run regenerate:invoices
```

## Important Configuration

### Environment Variables (.env.production)

```bash
# Database
DB_HOST=ivs-postgres
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=<secure-password>
DB_NAME=ivs_live

# JWT
JWT_SECRET=<secure-secret>
JWT_ISSUER=ivs-live-streaming

# AWS IVS
IVS_PLAYBACK_KEY_PAIR_ID=<key-pair-id>
IVS_PLAYBACK_PRIVATE_KEY=<private-key-pem>

# AWS CloudFront
CLOUDFRONT_RECORDINGS_DOMAIN=<distribution-domain>
CLOUDFRONT_KEY_PAIR_ID=<key-pair-id>
CLOUDFRONT_PRIVATE_KEY=<private-key-pem>

# Razorpay
RAZORPAY_KEY_ID=<key-id>
RAZORPAY_KEY_SECRET=<secret>
RAZORPAY_WEBHOOK_SECRET=<webhook-secret>

# Resend Email
RESEND_API_KEY=<api-key>
RESEND_FROM_EMAIL=noreply@sankeertanotsav.com

# Company (for invoices)
COMPANY_NAME=Hope Arts and Performing Enrichment
COMPANY_ADDRESS=<full-address>
COMPANY_GSTIN=<gstin>
COMPANY_PAN=<pan>
COMPANY_CIN=<cin>
COMPANY_STATE_CODE=36
COMPANY_STATE_NAME=Telangana
COMPANY_BANK_NAME=<bank>
COMPANY_BANK_ACCOUNT_NUMBER=<account>
COMPANY_BANK_IFSC_CODE=<ifsc>

# Old Company (for historical invoices before 2026-01-01)
COMPANY_NAME_OLD=DX Solutions
# ... (similar fields with _OLD suffix)

# App
FRONTEND_URL=https://events.sampradya.live
NODE_ENV=production
PORT=5050
```

### Apache2 Configuration

```apache
<VirtualHost *:443>
    ServerName events-backend.edifyplus.com

    # Static files
    DocumentRoot /var/www/ivs-streaming/www

    # API Proxy
    ProxyPass /api http://localhost:5050/api
    ProxyPassReverse /api http://localhost:5050/api

    # SSL (Let's Encrypt)
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/events-backend.edifyplus.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/events-backend.edifyplus.com/privkey.pem
</VirtualHost>
```

## Known Issues & Solutions

### Issue: Admin roles cannot view invoices
**Root Cause:** Hardcoded `role === 'admin'` checks
**Solution:** Use array check: `['admin', 'superadmin', 'finance-admin', 'content-admin'].includes(userRole)`
**Status:** ✅ Fixed in invoices.ts and recordings.ts

### Issue: Invoice PDFs missing company state/bank info
**Root Cause:** Missing fields in SELECT query in invoice-email.service.ts
**Solution:** Add all company fields to match invoices.ts query
**Status:** ✅ Fixed

### Issue: Docker .env file not found
**Root Cause:** `.dockerignore` blocking .env files, incorrect path resolution
**Solution:** Remove .env from .dockerignore, use `process.cwd()` in env.ts, copy from builder stage
**Status:** ✅ Fixed

### Issue: Admin users cannot log in
**Root Cause:** Mobile number conflicts with viewer accounts (login query uses `email OR mobile`)
**Solution:** Admin users must use unique mobile numbers or log in with email instead
**Status:** ⚠️ Validation added, existing conflicts need manual cleanup

## API Endpoints (Key Routes)

### Authentication
- `POST /api/auth/login` - Login with email/mobile + password
- `POST /api/auth/register` - User registration
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token

### Events
- `GET /api/events` - List all events
- `GET /api/events/:id` - Event details
- `POST /api/events` - Create event (admin)
- `PATCH /api/events/:id` - Update event (admin)
- `DELETE /api/events/:id` - Delete event (admin)

### Payments
- `POST /api/razorpay/create-order` - Create Razorpay order
- `POST /api/razorpay/webhook` - Payment webhook

### Invoices
- `GET /api/invoices` - List user invoices
- `GET /api/invoices/:id` - Invoice details
- `GET /api/invoices/:id/pdf` - Download invoice PDF
- `GET /api/invoices/admin/statement` - Invoice statement (admin)
- `GET /api/invoices/admin/pending-usd` - Pending USD invoices (admin)
- `POST /api/invoices/admin/generate-usd-invoice` - Generate USD invoice (admin)

### Admin
- `GET /api/admin/users` - List users (superadmin)
- `POST /api/admin/users` - Create admin user (superadmin)
- `PUT /api/admin/users/:id` - Update user (superadmin)
- `PUT /api/admin/users/:id/role` - Change user role (superadmin)
- `PUT /api/admin/users/:id/status` - Toggle user status (superadmin)
- `DELETE /api/admin/users/:id` - Delete user (superadmin)

### Recordings
- `GET /api/recordings/:eventId/playback-url` - Get signed CloudFront URL

### IVS
- `POST /api/ivs/playback-token` - Get IVS playback token
- `GET /api/ivs/channel/:channelArn` - Get channel status

## Security Considerations

1. **JWT Authentication:** All protected routes require `Authorization: Bearer <token>` header
2. **Role-Based Access:** Middleware checks user role before allowing access
3. **Password Hashing:** bcryptjs with 10 salt rounds
4. **SQL Injection:** All queries use parameterized statements
5. **CORS:** Configured for development, restricted in production
6. **Signed URLs:** Time-limited CloudFront and IVS URLs prevent unauthorized access
7. **Active User Check:** Login endpoint verifies `is_active = true`

## Testing & Quality

### Manual Testing Checklist
- [ ] Login with email (all admin roles)
- [ ] Login with mobile (unique mobile numbers only)
- [ ] Create admin user (duplicate email/mobile should fail)
- [ ] View invoice as superadmin/finance-admin
- [ ] Download invoice PDF (should have all company fields)
- [ ] Generate USD invoice with conversion rate
- [ ] Regenerate invoices (should skip USD payments)
- [ ] Access recording as admin (should not check expiry)

## Deployment Checklist

```bash
# 1. Commit changes locally
git status
git add <files>
git commit -m "Descriptive message"

# 2. Push to remote
git push origin nice-wu

# 3. On production server
cd /data/www/ivs-streaming
git pull origin nice-wu

# 4. Rebuild frontend (if changed)
npm install
npm run build

# 5. Rebuild backend (if changed)
cd backend
sudo docker-compose build --no-cache backend
sudo docker-compose up -d

# 6. Verify deployment
sudo docker logs ivs-backend | tail -50
curl -I https://events-backend.edifyplus.com/api/events

# 7. Test critical features
# - Login as superadmin
# - View invoices
# - Create test event
```

## Future Improvements

1. **Admin Dashboard:** Add more analytics (revenue charts, user growth)
2. **Bulk Operations:** Bulk invoice download as ZIP
3. **Email Templates:** More customizable email templates
4. **Recording Management:** UI for managing S3 recording files
5. **Viewer Analytics:** Real-time dashboard with live viewer counts
6. **Mobile App:** Build and publish iOS/Android apps via Capacitor
7. **Internationalization:** i18n support for multiple languages
8. **Testing:** Add unit tests (Jest) and e2e tests (Playwright)

## Contact & Resources

- **Production URL:** https://events.sampradya.live
- **Admin Email:** admin@sankeertanotsav.com
- **Support:** Contact system administrator

## Notes for Claude Code

When working on this project:

1. **CRITICAL: Branch Strategy** - ALWAYS work on `nice-wu` branch. Do NOT create new branches. Continue using `nice-wu` for all sessions and changes. Only merge to `main` when user explicitly requests production deployment.
2. **Always check user role permissions** - Don't hardcode `role === 'admin'`, use array includes for all admin roles: `['admin', 'superadmin', 'finance-admin', 'content-admin']`
3. **Invoice queries must include all company fields** - Compare with invoices.ts route to ensure all company, state, and bank fields are included
4. **Docker .env files** - Remember .dockerignore allows .env files now (intentionally not blocked)
5. **Login supports email OR mobile** - Be aware of potential conflicts with duplicate mobile numbers
6. **USD invoices are manual** - Bulk scripts skip USD payments intentionally (they require manual exchange rate entry)
7. **Database schema** - Always check `backend/src/db/schema.ts` before modifying tables
8. **Timezone handling** - Use `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'` for IST display

This project follows Angular standalone components pattern and uses Ionic/Capacitor for mobile support. Backend is stateless (JWT) and designed for horizontal scaling.
