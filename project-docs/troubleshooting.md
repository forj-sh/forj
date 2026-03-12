# Forj Troubleshooting Guide

**Last updated:** March 11, 2026

Common issues and solutions when developing Forj.

---

## Development Environment

### Redis Connection Errors

**Symptom:**
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Cause:** Redis not running.

**Fix:**
```bash
# macOS (Homebrew)
brew services start redis

# Linux (systemd)
sudo systemctl start redis

# Docker
docker run -d -p 6379:6379 redis:alpine

# Verify
redis-cli ping  # Should return PONG
```

**Check REDIS_URL:**
```bash
# packages/api/.env
REDIS_URL=redis://localhost:6379
```

### Database Connection Errors

**Symptom:**
```
Error: password authentication failed for user "postgres"
```

**Cause:** Incorrect `DATABASE_URL` or PostgreSQL not running.

**Fix:**
```bash
# Check PostgreSQL is running
psql -U postgres -c "SELECT 1"

# Verify DATABASE_URL format
DATABASE_URL=postgresql://user:password@host:port/database

# For local development
DATABASE_URL=postgresql://postgres:password@localhost:5432/forj_dev
```

### Database Migration Errors

**Symptom:**
```
Migration failed: relation "projects" already exists
```

**Cause:** Migrations already run, or manual table creation conflicts.

**Fix:**
```bash
# Check migration status
psql $DATABASE_URL -c "SELECT * FROM migrations ORDER BY id DESC LIMIT 5"

# If table doesn't exist, create it:
psql $DATABASE_URL -c "CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  run_on TIMESTAMP NOT NULL DEFAULT NOW()
)"

# Re-run migrations
npm run db:migrate -w packages/api
```

---

## Build & Dependencies

### "Module not found" Errors in CLI

**Symptom:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module './lib/api-client'
```

**Cause:** Missing `.js` extension in import (CLI uses ESM).

**Fix:**
```typescript
// ❌ Wrong (works in other packages, NOT in CLI)
import { api } from './lib/api-client'

// ✅ Correct (CLI requires .js extension)
import { api } from './lib/api-client.js'
```

**Why:** CLI package uses `"type": "module"` and `NodeNext` module resolution, which requires explicit `.js` extensions per ESM spec.

### TypeScript Build Errors After Dependency Update

**Symptom:**
```
error TS2307: Cannot find module '@forj/shared' or its corresponding type declarations
```

**Cause:** Workspace dependency not built, or stale `node_modules`.

**Fix:**
```bash
# Clean and rebuild everything
npm run clean
npm install
npm run build

# Or rebuild specific package
npm run build -w packages/shared
```

### tsup Build Fails with "Cannot resolve dependency"

**Symptom:**
```
error: Could not resolve "ioredis"
```

**Cause:** Peer dependency not marked as external in `tsup.config.ts`.

**Fix:**
```typescript
// packages/*/tsup.config.ts
export default defineConfig({
  external: ['ioredis', 'pg', '@neondatabase/serverless'], // Add missing deps here
})
```

---

## API Server

### Routes Not Registered

**Symptom:**
```
HTTP 404 Not Found for /provision
```

**Cause:** Route defined but not mounted in `server.ts`.

**Fix:**
```typescript
// packages/api/src/server.ts
import { provisionRoutes } from './routes/provision.js';

// After other route registrations:
await server.register(provisionRoutes);
logger.info('Provisioning routes registered');
```

**Verify routes:**
```bash
# Start server
npm run dev -w packages/api

# Check logs for "registered" messages:
# ✓ Health routes registered
# ✓ Auth routes registered
# ✓ Domain routes registered
# ✓ Provisioning routes registered  ← Should see this
```

### Namecheap Routes Return 404

**Symptom:**
```
POST /domains/check → 404 Not Found
```

**Cause:** `ENABLE_NAMECHEAP_ROUTES` not set to `true`, or Namecheap credentials missing.

**Fix:**
```bash
# packages/api/.env
ENABLE_NAMECHEAP_ROUTES=true
NAMECHEAP_API_USER=your_username
NAMECHEAP_API_KEY=your_api_key
NAMECHEAP_USERNAME=your_username
NAMECHEAP_CLIENT_IP=your_ip
```

**Verify in logs:**
```
✓ Namecheap domain routes registered (production mode)
```

Not:
```
⚠ Namecheap credentials not configured - using mock domain routes
```

### "Rate limit exceeded" During Development

**Symptom:**
```
HTTP 429 Too Many Requests
Error: Rate limit exceeded (20 requests per minute)
```

**Cause:** Namecheap sandbox API has strict rate limit (20 req/min). Rate limiter is Redis-backed and persists across restarts.

**Fix:**
```bash
# Check current rate limit state
redis-cli GET ratelimit:namecheap:global

# Clear rate limiter (use cautiously - may hide rate limit bugs)
redis-cli DEL ratelimit:namecheap:global

# Or flush entire Redis DB (nuclear option)
redis-cli FLUSHDB
```

**Better approach:** Use request queue with lower concurrency:
```typescript
// packages/shared/src/namecheap/request-queue.ts
// Lower concurrency for development:
const MAX_CONCURRENT_REQUESTS = 2 // Instead of 5
```

---

## Workers

### BullMQ Worker Not Processing Jobs

**Symptom:**
Worker starts but jobs stay in "waiting" state indefinitely.

**Cause:**
1. Redis connection failed
2. Queue name mismatch
3. Worker crashed silently

**Fix:**

**1. Verify Redis connection:**
```bash
redis-cli ping  # Should return PONG

# Check worker logs for Redis connection errors
npm run dev -w packages/workers
```

**2. Verify queue names match:**
```typescript
// API (job creation)
const queue = getDomainQueue() // Returns queue named "domain"

// Worker (job processing)
new Worker('domain', async (job) => { ... }) // Must match "domain"
```

**3. Check worker logs:**
```bash
# Worker should log job processing
cd packages/workers
npm run dev

# Expected output:
# Processing job domain:check:123
# Job domain:check:123 completed successfully
```

### Worker Crashes on Job Failure

**Symptom:**
```
UnhandledPromiseRejectionWarning: Error: Namecheap API error
```

**Cause:** Worker throws error without proper handling. BullMQ expects workers to throw for retryable failures.

**Fix:**

**For retryable errors, throw:**
```typescript
if (error.retryable) {
  throw error // BullMQ will retry based on job options
}
```

**For non-retryable errors, mark as failed:**
```typescript
if (!error.retryable) {
  logger.error({ error }, 'Non-retryable error, marking job as failed')
  // Don't throw - job will be marked as failed
  return
}
```

---

## Authentication & Security

### JWT Verification Failed

**Symptom:**
```
HTTP 401 Unauthorized
Error: Invalid JWT token
```

**Cause:**
1. `JWT_SECRET` not set
2. Token expired
3. Token generated with different secret

**Fix:**

**1. Ensure JWT_SECRET is set:**
```bash
# packages/api/.env
JWT_SECRET=$(openssl rand -base64 32)
```

**2. Check token expiration:**
```typescript
// packages/api/src/lib/jwt.ts
// Default expiration: 30 days
const expiresIn = '30d'
```

**3. Generate new token:**
```bash
TOKEN=$(curl -s http://localhost:3000/auth/cli | jq -r '.data.token')
echo $TOKEN
```

### Stripe Webhook Signature Verification Failed

**Symptom:**
```
HTTP 400 Bad Request
Error: Invalid webhook signature
```

**Cause:** `STRIPE_WEBHOOK_SECRET` doesn't match Stripe's signing secret.

**Fix:**

**For local development with Stripe CLI:**
```bash
# Start Stripe CLI webhook forwarding
stripe listen --forward-to localhost:3000/webhooks/stripe

# Copy the webhook signing secret from output:
# > Ready! Your webhook signing secret is whsec_abc123...

# Add to .env
STRIPE_WEBHOOK_SECRET=whsec_abc123...

# Restart API server
npm run dev -w packages/api
```

**For production:**
Use the signing secret from Stripe Dashboard → Webhooks → [your endpoint] → Signing secret.

### "Unauthorized to access this job" (IDOR Protection)

**Symptom:**
```
HTTP 403 Forbidden
Error: Unauthorized to access this job
```

**Cause:** User trying to access another user's job (correct behavior - IDOR protection working).

**Fix:**

This is **expected behavior** if the job doesn't belong to the authenticated user.

**To test with your own jobs:**
```bash
# Create job as authenticated user
JOB_RESPONSE=$(curl -s -X POST http://localhost:3000/domains/register \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain":"test.com",...}')

# Extract job ID
JOB_ID=$(echo $JOB_RESPONSE | jq -r '.data.jobId')

# Access your own job (should succeed)
curl -X GET "http://localhost:3000/domains/jobs/$JOB_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Namecheap Integration

### "Authentication Failed" from Namecheap API

**Symptom:**
```
NamecheapError: Authentication failed (error code: 1011150)
```

**Cause:**
1. API key incorrect
2. IP address not whitelisted
3. Sandbox mode mismatch

**Fix:**

**1. Verify API credentials:**
```bash
# Log into Namecheap → Profile → Tools → API Access
# Copy exact values for:
NAMECHEAP_API_USER=your_username
NAMECHEAP_API_KEY=your_api_key  # Long hex string
NAMECHEAP_USERNAME=your_username
```

**2. Whitelist IP address:**
```bash
# Get your public IP
curl https://api.ipify.org

# Add to Namecheap dashboard → API Access → Whitelisted IPs
NAMECHEAP_CLIENT_IP=<your public IP>
```

**3. Verify sandbox mode:**
```bash
# For sandbox API (api.sandbox.namecheap.com):
NAMECHEAP_SANDBOX=true

# For production API (api.namecheap.com):
NAMECHEAP_SANDBOX=false
```

### "Domain Not Available" for Known Available Domain

**Symptom:**
Domain check returns `available: false` even though domain is available.

**Cause:**
1. Namecheap sandbox has limited TLD support
2. Domain recently registered (cache issue)
3. Premium domain flagged incorrectly

**Fix:**

**1. Check sandbox TLD support:**
Namecheap sandbox only supports: `.com`, `.net`, `.org`, `.info`, `.biz`, `.us`, `.co.uk`

**2. Clear pricing cache:**
```bash
redis-cli DEL pricing:cache:*
```

**3. Test with different domain:**
```bash
# Use randomized domain to avoid conflicts
curl -X POST http://localhost:3000/domains/check \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"domains":["test-forj-'$(date +%s)'.com"]}'
```

---

## Cloudflare Integration

### "Invalid API Token" from Cloudflare

**Symptom:**
```
CloudflareError: Invalid token (code: 6003)
```

**Cause:**
1. Token expired
2. Token lacks required permissions
3. Token revoked

**Fix:**

**1. Verify token permissions:**
Token must have:
- Zone → Zone → Read
- Zone → DNS → Edit

**2. Test token directly:**
```bash
curl -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected response:
# {"result":{"status":"active"},"success":true}
```

**3. Create new token:**
Go to `dash.cloudflare.com/profile/api-tokens` → Create Token → Edit zone DNS template.

### "Zone Creation Failed: account_id required"

**Symptom:**
```
CloudflareError: account_id is required (code: 1000)
```

**Cause:** Zone creation requires account ID, which isn't provided.

**Fix:**

**1. Get account ID:**
```bash
curl -X GET "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq '.result[0].id'
```

**2. Pass in provisioning config:**
```typescript
{
  "cloudflareApiToken": "...",
  "cloudflareAccountId": "abc123..."  // Add this
}
```

### Nameserver Update Fails After Zone Creation

**Symptom:**
Cloudflare zone created successfully, but Namecheap nameserver update fails.

**Cause:**
1. Nameserver format incorrect
2. Rate limit exceeded
3. Domain locked

**Fix:**

**1. Verify nameserver format:**
Cloudflare returns nameservers like: `["ns1.cloudflare.com.", "ns2.cloudflare.com."]`

Must remove trailing dot for Namecheap:
```typescript
const nameservers = cloudflareNS.map(ns => ns.replace(/\.$/, ''))
// ["ns1.cloudflare.com", "ns2.cloudflare.com"]
```

**2. Check rate limiter:**
```bash
redis-cli GET ratelimit:namecheap:global
```

**3. Verify domain not locked:**
```bash
# Check domain transfer lock status
curl -X POST https://api.sandbox.namecheap.com/xml.response \
  -d "ApiUser=..." \
  -d "Command=namecheap.domains.getInfo" \
  -d "DomainName=test.com"
```

---

## GitHub Integration

### GitHub Device Flow Timeout

**Symptom:**
Device flow initiated, but user authorization times out after 15 minutes.

**Cause:** User didn't authorize within expiration window (default 900 seconds).

**Fix:**

**1. Check expiration:**
```typescript
// Device code expires_in: 900 (15 minutes)
// Must complete authorization within this window
```

**2. Re-initiate flow:**
```bash
# Generate new device code
curl -X POST http://localhost:3000/auth/github/device \
  -H "Authorization: Bearer $TOKEN"
```

### "GitHub Org Not Found" During Provisioning

**Symptom:**
```
GitHubError: Organization 'my-org' not found (404)
```

**Cause:**
1. Org name typo
2. Token lacks `admin:org` scope
3. User isn't org member

**Fix:**

**1. Verify org exists:**
```bash
gh org view my-org
```

**2. Check token scopes:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.github.com/user | jq '.scopes'

# Must include: ["admin:org", "repo"]
```

**3. Verify user is org member:**
```bash
gh api orgs/my-org/members --jq '.[].login'
```

---

## DNS

### DNS Records Not Propagating

**Symptom:**
DNS worker completes successfully, but `dig` shows no records.

**Cause:**
1. DNS propagation delay (normal)
2. Records not actually created
3. Querying wrong nameservers

**Fix:**

**1. Check records via Cloudflare API (authoritative):**
```bash
curl -X GET "https://api.cloudflare.com/client/v4/zones/ZONE_ID/dns_records" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq '.result[] | {name, type, content}'
```

**2. Query Cloudflare nameservers directly:**
```bash
# Get nameservers from zone
dig NS example.com +short
# ns1.cloudflare.com
# ns2.cloudflare.com

# Query Cloudflare directly (bypasses cache)
dig @ns1.cloudflare.com MX example.com +short
```

**3. Wait for global propagation:**
DNS propagation can take 5-60 minutes. Check multiple locations:
```bash
# Use dnschecker.org or:
for ns in 8.8.8.8 1.1.1.1 9.9.9.9; do
  echo "Testing $ns:"
  dig @$ns MX example.com +short
done
```

### "DKIM Record Too Long" Error

**Symptom:**
```
CloudflareError: DNS record content exceeds maximum length
```

**Cause:** DKIM keys are 2048-bit and exceed DNS record length limit (255 chars per string).

**Fix:**

**Split long TXT records:**
```typescript
// ❌ Wrong (single string > 255 chars)
const dkimValue = 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...'

// ✅ Correct (split into chunks)
const dkimValue = '"v=DKIM1; k=rsa; " "p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."'
```

Cloudflare API handles chunking automatically if you pass the full string.

---

## CLI

### CLI Can't Connect to API Server

**Symptom:**
```
Error: connect ECONNREFUSED localhost:3000
```

**Cause:** API server not running, or API_URL mismatch.

**Fix:**

**1. Start API server:**
```bash
npm run dev -w packages/api
```

**2. Verify API_URL:**
```typescript
// packages/cli/src/lib/api-client.ts
const API_URL = process.env.API_URL || 'http://localhost:3000'
```

**3. Test API health:**
```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2026-03-11T..."}
```

### SSE Connection Drops Immediately

**Symptom:**
SSE stream connects but disconnects after 1-2 seconds without events.

**Cause:**
1. Fastify default timeout (60s)
2. Project ID doesn't exist
3. No events being published

**Fix:**

**1. Increase SSE timeout:**
```typescript
// packages/api/src/routes/events.ts
reply.raw.setTimeout(0) // Disable timeout for SSE
```

**2. Verify project exists:**
```bash
psql $DATABASE_URL -c "SELECT * FROM projects WHERE project_id = 'test-project-1'"
```

**3. Manually publish test event:**
```bash
# In separate terminal with Redis client
redis-cli PUBLISH events:test-project-1 '{"type":"test","message":"Hello"}'

# Should appear in SSE stream:
# data: {"type":"test","message":"Hello"}
```

---

## Performance

### Slow Domain Checks (10+ seconds)

**Symptom:**
Domain availability check takes 10+ seconds instead of expected 2-5s.

**Cause:**
1. Namecheap API latency
2. Rate limiter queueing requests
3. Network issues

**Fix:**

**1. Check rate limiter queue length:**
```bash
# If many requests queued, increase concurrency
# packages/shared/src/namecheap/request-queue.ts
MAX_CONCURRENT_REQUESTS = 5  # Increase to 8-10 (stay under rate limit)
```

**2. Check Namecheap API latency:**
```bash
time curl -X POST https://api.sandbox.namecheap.com/xml.response \
  -d "ApiUser=..." \
  -d "Command=namecheap.domains.check" \
  -d "DomainList=example.com"
```

**3. Enable pricing cache warmup:**
```typescript
// packages/api/src/server.ts
if (pricingCache) {
  await pricingCache.warmup() // Await warmup instead of fire-and-forget
}
```

### High Memory Usage in Workers

**Symptom:**
Worker process memory grows to 500MB+ over time.

**Cause:**
1. Memory leak in job processing
2. Large job payloads
3. Cached data not expiring

**Fix:**

**1. Check job payload sizes:**
```typescript
// Limit payload size in job options
const job = await queue.add('domain-check', data, {
  removeOnComplete: 100, // Keep only last 100 completed jobs
  removeOnFail: 200,
})
```

**2. Monitor memory:**
```bash
# Check worker memory usage
ps aux | grep 'node.*worker'

# Enable Node.js heap profiling
node --inspect packages/workers/dist/index.js
```

---

## Getting Help

If you encounter an issue not covered here:

1. **Check logs:** API server and workers log detailed errors
2. **Enable debug mode:** Set `DEBUG=*` for verbose logging
3. **Search GitHub issues:** `github.com/forj-sh/forj/issues`
4. **Ask in Discord:** (once community exists)
5. **File a bug:** Include logs, environment, and reproduction steps
