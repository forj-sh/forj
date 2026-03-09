# Deployment Guide

## Initial Setup

### 1. Deploy to Vercel

The site is configured to auto-deploy from the `main` branch on GitHub.

```bash
cd packages/landing
vercel --prod --yes
```

### 2. Configure Environment Variables

In Vercel dashboard, add these environment variables:

**Required:**
- `DATABASE_URL` - Provided automatically by Vercel Neon integration

**Optional (for enhanced features):**
- `VITE_TURNSTILE_SITEKEY` - Cloudflare Turnstile public key (client-side)
- `TURNSTILE_SECRET_KEY` - Cloudflare Turnstile secret key (server-side)
- `RESEND_API_KEY` - Resend API key for email confirmations

### 3. Run Database Migration

After Neon is provisioned through Vercel, run the migration to create tables:

```bash
# Set DATABASE_URL from Vercel environment
export DATABASE_URL="postgres://..."

# Run migration
npm run db:migrate
```

Expected output:
```
🗄️  Running database migrations...
✅ Created signups table
✅ Created email index
✅ Created created_at index
✅ Created updated_at trigger function
✅ Created updated_at trigger
🎉 Migration completed successfully!
```

## Database Schema

```sql
CREATE TABLE signups (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  ip_address VARCHAR(45) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signups_email ON signups(email);
CREATE INDEX idx_signups_created_at ON signups(created_at DESC);
```

## API Endpoints

### POST /api/submit-form

Submit email to waitlist.

**Request:**
```json
{
  "email": "user@example.com",
  "turnstile_token": "optional_captcha_token"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Thanks! You're on the waitlist."
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "This email is already on the waitlist."
}
```

## Spam Protection

Multiple layers active:

1. **Server-side rate limiting** - IP-based, 60-second cooldown
2. **Disposable email blocking** - Rejects known disposable domains
3. **Email validation** - Regex validation on client + server
4. **Duplicate prevention** - Database unique constraint on email
5. **Cloudflare Turnstile** - CAPTCHA (optional, when configured)
6. **Client-side rate limiting** - Browser localStorage, 3/min

## Monitoring

### Check Signup Stats

```typescript
import { getSignupStats } from './src/lib/database';

const stats = await getSignupStats();
// { total: 150, today: 12, this_week: 45 }
```

### View Recent Signups

```typescript
import { getRecentSignups } from './src/lib/database';

const recent = await getRecentSignups(50);
// Array of 50 most recent signups
```

## Troubleshooting

### Migration fails

**Error:** `Connection string not found`
- **Solution:** Set `DATABASE_URL` environment variable from Vercel

**Error:** `Table already exists`
- **Solution:** This is safe - migration creates tables with `IF NOT EXISTS`

### API returns 500 error

**Check:**
1. Vercel logs: `vercel logs --prod`
2. Database connection: Verify `DATABASE_URL` is set in Vercel
3. Migration ran: Check tables exist in Neon dashboard

### Form submissions not storing

**Check:**
1. Browser console for errors
2. Network tab - verify POST to `/api/submit-form` succeeds
3. Vercel function logs for server-side errors
4. Database query: `SELECT * FROM signups ORDER BY created_at DESC LIMIT 10`

## Production URL

https://www.forj.sh/
