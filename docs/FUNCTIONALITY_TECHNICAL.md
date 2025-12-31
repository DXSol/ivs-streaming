# Sankeertanotsav 2026 Live - Application Functionality Documentation

## Overview

This is a live streaming platform for Indian classical music concerts built with **Ionic Angular** (frontend) and **Node.js/Express** (backend). It supports both paid events (via AWS IVS) and free events (via YouTube embeds), with integrated payment processing through Razorpay.

---

## Table of Contents

1. [User Authentication](#1-user-authentication)
2. [Event Management](#2-event-management)
3. [Ticketing System](#3-ticketing-system)
4. [Season Ticket Subscription](#4-season-ticket-subscription)
5. [Live Streaming](#5-live-streaming)
6. [Recording Playback](#6-recording-playback)
7. [Payment Integration](#7-payment-integration)
8. [Access Control](#8-access-control)
9. [Timezone Handling](#9-timezone-handling)
10. [Admin Features](#10-admin-features)
11. [UI/UX Features](#11-uiux-features)

---

## 1. User Authentication

### Registration
- **Route**: `/register`
- **Fields**: Name, Email, Mobile, Country, Password
- **Features**:
  - Form validation with real-time feedback
  - Password strength requirements
  - Country selection dropdown
  - Automatic redirect to events page after registration
  - Pending purchase handling (continues checkout flow if user was buying a ticket)

### Login
- **Route**: `/login`
- **Features**:
  - Email/password authentication
  - JWT token-based session management
  - "Browse Events" link for unauthenticated access
  - Home button for navigation
  - Pending purchase handling after login

### Session Management
- JWT tokens stored in localStorage
- Auth interceptor automatically attaches tokens to API requests
- Token refresh handled transparently

---

## 2. Event Management

### Event Types
1. **Paid Events**: Require ticket purchase, streamed via AWS IVS
2. **Free Events**: Open access, embedded YouTube streams

### Event Listing (`/events`)
- **Default landing page** (no authentication required)
- Tabbed interface: Paid Events | Free Events
- Event cards display:
  - Poster image
  - Title
  - Date/time with timezone support
  - Description (truncated)
  - Price (for paid events)
  - Action buttons based on user status

### Event Detail (`/events/:id`)
- Full event information
- Large poster display
- Complete description
- Action buttons based on:
  - Authentication status
  - Ticket ownership
  - Season ticket coverage
  - Event timing (upcoming/live/past)

### Event States
- **Upcoming**: Event hasn't started yet
- **Live**: Event is currently streaming
- **Past**: Event has ended (recording may be available)

---

## 3. Ticketing System

### Individual Event Tickets
- Purchase via Razorpay payment gateway
- Ticket status: `pending` → `paid` → (optional) `revoked`
- One ticket per user per event (enforced by database constraint)

### Ticket Purchase Flow
1. User clicks "Buy Ticket" on event
2. **If not logged in**: Redirected to register with pending purchase saved
3. **If logged in**: Razorpay checkout opens
4. On successful payment: Ticket created, user gains access

### Pending Purchase Service
- Stores intended purchase in localStorage when user is not authenticated
- Keys stored: `eventId`, `type` (event/season), `returnUrl`
- Automatically processes after login/registration

---

## 4. Season Ticket Subscription

### Overview
A season ticket grants access to **all paid events** starting from the purchase date.

### Coverage Logic
- Events covered = All paid events where `event.starts_at >= seasonTicket.purchased_at`
- Includes both upcoming events and past events (for recordings)

### Season Ticket Display
- **For non-owners**: Full promotional card with:
  - Event count
  - Original price (strikethrough)
  - Discounted price
  - Discount percentage badge
  - "Buy Season Ticket" button

- **For owners**: Compact banner showing:
  - "Season Ticket Active" status
  - Number of concerts covered

### Pricing
- Configured via `season_ticket_config` table
- Fields: `original_paise`, `discounted_paise`, `event_count`

---

## 5. Live Streaming

### AWS IVS Integration (Paid Events)
- Real-time stream status checking
- Automatic polling every 30 seconds
- Stream states: `loading`, `live`, `offline`, `error`, `device-limit`
- Low-latency playback via IVS Player SDK

### YouTube Embed (Free Events)
- Embedded YouTube player
- Supports live streams and regular videos
- Auto-extracted video ID from various YouTube URL formats

### Watch Page (`/watch/:id`)
- Full-screen video player
- Event information display
- Viewer count (for live events)
- Share functionality
- Comments section
- Session navigation (for multi-part recordings)

### Viewing Sessions
- Tracks active viewers per event
- Heartbeat mechanism to maintain session
- Device limit enforcement (configurable)

---

## 6. Recording Playback

### Recording Availability
- Recordings stored in S3 via AWS IVS auto-recording
- Available for **3 days** after event end time

### Recording Expiry Display
- Shows countdown: "Recording expires: 2d 5h left"
- Shows "Recording Expired" badge after 3 days
- Calculated from `event.ends_at + 3 days`

### Multi-Session Recordings
- Events may have multiple recording sessions
- Session navigation UI for switching between parts
- Timestamp display for each session

### Access Control
- Same as live access: requires ticket or season ticket
- Admin users have unrestricted access

---

## 7. Payment Integration

### Razorpay Integration
- **Event Tickets**: Individual event purchases
- **Season Tickets**: Subscription purchases

### Payment Flow
1. Frontend creates order via `/api/razorpay/create-order`
2. Razorpay checkout modal opens
3. User completes payment
4. Frontend verifies via `/api/razorpay/verify-payment`
5. Backend creates ticket record on successful verification

### Order Types
- `event_ticket`: For individual event purchases
- `season_ticket`: For season subscription

### Payment Records
- Stored in `payments` table
- Links to user and event (if applicable)
- Stores Razorpay payment ID and raw payload

---

## 8. Access Control

### Public Access (No Authentication)
- Event listing page
- Event detail page
- Free event streams (YouTube)

### Authenticated Access Required
- Watch page for paid events
- Profile page
- Ticket purchases

### Ticket-Based Access (Paid Events)
User can watch if ANY of these conditions are met:
1. Has individual ticket for the event (`status = 'paid'`)
2. Has season ticket AND event starts on/after season ticket purchase date
3. Is an admin user

### Admin Access
- Unrestricted access to all events (live and recordings)
- Can watch without ticket or season ticket
- Access to admin dashboard and event management

### Watch Page Verification
- Checks authentication on page load
- Verifies ticket/season ticket status
- Redirects unauthorized users to event detail page
- Shows appropriate error messages

---

## 9. Timezone Handling

### Storage
- All dates stored as `TIMESTAMPTZ` in PostgreSQL (UTC internally)
- Server timezone: Asia/Kolkata (IST, UTC+05:30)

### Display Logic
- **Users in IST**: Shows date/time without timezone label
  - Example: `Dec 22, 2025 11:13 AM`

- **Users in other timezones**: Shows both IST and local time
  - Example: `Dec 22, 2025 11:13 AM IST / Dec 21, 2025 11:43 PM CST`

### Implementation
- Custom `EventTimePipe` for consistent formatting
- Uses `Intl.DateTimeFormat` for timezone conversion
- Automatically detects user's browser timezone

### Affected Pages
- Events listing
- Event detail
- Watch page

---

## 10. Admin Features

### Admin Dashboard
- Event management overview
- Viewer statistics
- Payment tracking

### Event CRUD Operations
- **Create Event** (`/admin/create-event`):
  - Title, description
  - Event type (paid/free)
  - Start/end datetime
  - IVS channel ARN (paid) or YouTube URL (free)
  - Poster image URL
  - Price (for paid events)

- **Edit Event** (`/admin/edit-event/:id`):
  - Modify all event fields
  - Update streaming sources

- **Delete Event**:
  - Confirmation dialog
  - Cascades to tickets and related records

### Mark Paid (`/admin/mark-paid`)
- Manually mark users as paid for events
- Useful for offline payments or special access

### Admin Indicators
- Edit/Delete buttons on event cards (admin only)
- Admin badge in toolbar

---

## 11. UI/UX Features

### Responsive Design
- Mobile-first approach
- Adapts to tablet and desktop
- Touch-friendly controls

### Navigation
- **Toolbar**: Logo, home button, login/register or profile
- **Home Button**: Present on all pages for easy navigation
- **Back Button**: Context-aware navigation

### Visual Feedback
- Loading spinners during async operations
- Toast notifications for success/error states
- Button states (disabled during processing)

### Event Cards
- Poster image with fallback accent bar
- Truncated description with line-clamp
- Status badges (Live, Past, Free, etc.)
- Recording expiry countdown

### Season Ticket Section
- Prominent placement on paid events tab
- Visual distinction between purchase card and active banner
- Animated decorations

### Footer
- Consistent across all pages
- Copyright and branding

---

## Technical Architecture

### Frontend Stack
- **Framework**: Ionic 7 + Angular 17 (Standalone Components)
- **Styling**: SCSS with CSS variables
- **Icons**: Ionicons (CDN)
- **State Management**: Services with RxJS

### Backend Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Raw SQL with `pg` driver
- **Validation**: Zod schemas

### External Services
- **AWS IVS**: Live streaming and recording
- **AWS S3**: Recording storage
- **Razorpay**: Payment processing
- **YouTube**: Free event embeds

### Database Schema
Key tables:
- `users`: User accounts
- `events`: Event definitions
- `tickets`: Individual event tickets
- `season_tickets`: Season subscriptions
- `payments`: Payment records
- `viewing_sessions`: Active viewer tracking
- `event_viewer_stats`: Historical viewer counts
- `event_comments`: User comments on events

---

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Current user info

### Events
- `GET /api/events` - List all events
- `GET /api/events/:id` - Get event details
- `POST /api/events` - Create event (admin)
- `PUT /api/events/:id` - Update event (admin)
- `DELETE /api/events/:id` - Delete event (admin)
- `GET /api/events/:id/access` - Check user access to event

### Payments
- `POST /api/razorpay/create-order` - Create payment order
- `POST /api/razorpay/verify-payment` - Verify and process payment
- `GET /api/razorpay/season-ticket-price` - Get season ticket pricing

### Streaming
- `GET /api/ivs/stream-status/:channelArn` - Check stream status
- `GET /api/recordings/:eventId` - Get recording sessions

### Viewing Sessions
- `POST /api/viewing-sessions/start` - Start viewing session
- `POST /api/viewing-sessions/heartbeat` - Update session heartbeat
- `POST /api/viewing-sessions/end` - End viewing session

---

## Environment Configuration

### Frontend (`environment.ts`)
```typescript
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:5050/api'
};
```

### Backend (`.env`)
```
PORT=5050
NODE_ENV=development
JWT_SECRET=your-secret
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-password
DB_NAME=ivs_live
AWS_REGION=ap-south-1
RAZORPAY_KEY_ID=your-key
RAZORPAY_KEY_SECRET=your-secret
```

---

## Deployment

### Frontend
- Build: `ionic build --prod`
- Output: `www/` directory
- Deploy to: Netlify, Vercel, or any static host

### Backend
- Build: `npm run build`
- Deploy to: AWS EC2, ECS, or any Node.js host
- Database: AWS RDS PostgreSQL or Docker container

---

*Documentation generated: December 24, 2025*
