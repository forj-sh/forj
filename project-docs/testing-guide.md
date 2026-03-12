# Phase 5 Testing Guide

**Last updated:** March 11, 2026 (Phase 5 complete)

This guide walks through comprehensive testing of the Phase 5 provisioning pipeline: domain registration → GitHub repos → Cloudflare zones → DNS wiring.

---

## Prerequisites

### 1. Services Running

```bash
# Redis
redis-cli ping  # Should return PONG

# PostgreSQL
psql $DATABASE_URL -c "SELECT 1"  # Should return 1
```

### 2. Database Migrations

Run all migrations to create required tables:

```bash
npm run db:migrate -w packages/api
```

This creates:
- `projects` table (domain state tracking)
- `users` table (Phase 5 - for token storage)

### 3. Environment Variables

**Minimum required** (`packages/api/.env`):

```bash
# Core services (REQUIRED)
DATABASE_URL=postgresql://user:pass@localhost:5432/forj_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=$(openssl rand -base64 32)

# Phase 5 - Auth encryption (REQUIRED)
CLOUDFLARE_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Namecheap sandbox (OPTIONAL - uses mock if not set)
NAMECHEAP_API_USER=pcdkdsandbox
NAMECHEAP_API_KEY=751a16fcb4b14f9883e7bce1d95227c2
NAMECHEAP_USERNAME=pcdkdsandbox
NAMECHEAP_CLIENT_IP=127.0.0.1
NAMECHEAP_SANDBOX=true
ENABLE_NAMECHEAP_ROUTES=true

# Stripe (OPTIONAL - only for payment testing)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# GitHub OAuth (REQUIRED for Phase 5)
GITHUB_CLIENT_ID=<from GitHub OAuth App>
GITHUB_CLIENT_SECRET=<from GitHub OAuth App>
```

### 4. GitHub OAuth App Setup

Create a GitHub OAuth App at `github.com/organizations/forj-sh/settings/applications`:

1. Click "New OAuth App"
2. **Application name:** Forj CLI (Development)
3. **Homepage URL:** `http://localhost:3000`
4. **Authorization callback URL:** `http://localhost:3000/auth/github/callback`
5. **Enable Device Flow:** ✓ (checkbox at bottom)
6. Click "Register application"
7. Copy **Client ID** and **Client Secret** to `.env`

### 5. Cloudflare API Token

Create an API token at `dash.cloudflare.com/profile/api-tokens`:

1. Click "Create Token"
2. Use template: "Edit zone DNS"
3. **Permissions:**
   - Zone → Zone → Read
   - Zone → DNS → Edit
4. **Zone Resources:**
   - Include → All zones (or specific zone for testing)
5. Click "Continue to summary" → "Create Token"
6. **Copy the token immediately** (shown only once)

---

## Layer 1: Integration Tests (No External APIs)

**What it tests:** Orchestrator logic, state machine transitions, SSE streaming, worker event emission.

**No credentials needed** (uses mocks).

### Run Integration Tests

```bash
# All integration tests
npm test -w packages/api

# Specific test suites
npm test -w packages/api -- sse-streaming.test.ts
npm test -w packages/api -- orchestrator.test.ts
```

**Expected output:**
```
✓ should publish and receive worker events via Redis pub/sub
✓ should convert worker events to SSE format correctly
✓ orchestrator should coordinate domain → github ∥ cloudflare → ns update → dns wiring
✓ orchestrator should handle partial failures gracefully
```

**Troubleshooting:**
- **Redis connection failed:** Verify `redis-cli ping` returns `PONG`
- **Tests skipped:** Integration tests skip if Redis unavailable (check `REDIS_URL`)

---

## Layer 2: Auth Flows (Real Credentials, Safe Operations)

**What it tests:** GitHub Device Flow, Cloudflare token verification, encrypted storage.

**External APIs called:** GitHub OAuth, Cloudflare API (read-only verification).

### 2.1 Start API Server

```bash
# Terminal 1: API server
npm run dev -w packages/api

# Expected console output:
# ✓ Cloudflare auth routes registered
# ✓ GitHub auth routes registered
# ✓ Provisioning routes registered
# Server listening at http://localhost:3000
```

**⚠️ CRITICAL:** If you see "Provisioning routes NOT registered", the `/provision` endpoint isn't mounted. You'll need to add it to `server.ts`.

### 2.2 Test Cloudflare Token Verification

```bash
# Get JWT token (mock auth for testing)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/cli \
  -H "Content-Type: application/json" \
  -d '{"email":"test@forj.sh"}' | jq -r '.data.token')

# Verify Cloudflare token + store encrypted
curl -X POST http://localhost:3000/auth/cloudflare \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apiToken": "YOUR_CLOUDFLARE_TOKEN"}'

# Expected response:
# {
#   "success": true,
#   "data": {
#     "message": "Cloudflare token verified and stored",
#     "zones": 3  # Number of zones accessible with this token
#   }
# }
```

**What happens:**
1. API calls Cloudflare `/user/tokens/verify` to validate token
2. Fetches accessible zones via `/zones`
3. Encrypts token with AES-256-GCM using `CLOUDFLARE_ENCRYPTION_KEY`
4. Stores encrypted token in `users.cloudflare_token_encrypted` (PostgreSQL)

### 2.3 Test GitHub Device Flow

**Step 1: Initiate Device Flow**

```bash
curl -X POST http://localhost:3000/auth/github/device \
  -H "Authorization: Bearer $TOKEN"

# Expected response:
# {
#   "success": true,
#   "data": {
#     "device_code": "3584d83530557fdd1f46af8289938c8ef79f9dc5",
#     "user_code": "WDJB-MJHT",
#     "verification_uri": "https://github.com/login/device",
#     "expires_in": 900,
#     "interval": 5
#   }
# }
```

**Step 2: User Authorization**

1. Open `https://github.com/login/device` in browser
2. Enter the `user_code` (e.g., `WDJB-MJHT`)
3. Click "Continue" → "Authorize Forj CLI"

**Step 3: Poll for Token**

```bash
# Poll endpoint (repeat every 5 seconds until authorized)
curl -X POST http://localhost:3000/auth/github/poll \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device_code": "3584d83530557fdd1f46af8289938c8ef79f9dc5"}'

# While pending:
# {"success": false, "error": "authorization_pending"}

# After user authorizes:
# {
#   "success": true,
#   "data": {
#     "message": "GitHub token received and stored",
#     "scopes": ["admin:org", "repo"]
#   }
# }
```

**What happens:**
1. CLI polls GitHub OAuth token endpoint every 5 seconds
2. When user authorizes, GitHub returns access token
3. API encrypts token with AES-256-GCM
4. Stores in `users.github_token_encrypted`

---

## Layer 3: Full Provisioning Pipeline (All External APIs)

**What it tests:** End-to-end provisioning with real domain registration, repo creation, zone creation, DNS wiring.

**⚠️ WARNING:** This **actually registers domains** and creates GitHub repos. Use a test domain and org.

### 3.1 Start All Services

```bash
# Terminal 1: API server
npm run dev -w packages/api

# Terminal 2: Workers
cd packages/workers && npm run dev

# Terminal 3: SSE monitoring (optional)
curl -N http://localhost:3000/events/stream/test-project-1
```

### 3.2 Trigger Provisioning

```bash
curl -X POST http://localhost:3000/provision \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user-1",
    "projectId": "test-project-1",
    "domain": "test-sandbox-forj-12345.com",
    "namecheapApiUser": "pcdkdsandbox",
    "namecheapApiKey": "751a16fcb4b14f9883e7bce1d95227c2",
    "namecheapUsername": "pcdkdsandbox",
    "githubToken": "YOUR_GITHUB_PAT",
    "cloudflareApiToken": "YOUR_CLOUDFLARE_TOKEN",
    "githubOrg": "your-test-org",
    "years": 1,
    "contactInfo": {
      "firstName": "Test",
      "lastName": "User",
      "email": "test@example.com",
      "phone": "+1.5555555555",
      "address1": "123 Test St",
      "city": "San Francisco",
      "stateProvince": "CA",
      "postalCode": "94105",
      "country": "US"
    },
    "emailProvider": "google_workspace"
  }'

# Expected response (immediate):
# {
#   "success": true,
#   "data": {
#     "projectId": "test-project-1",
#     "message": "Provisioning started in background. Use /events/stream/:projectId to monitor progress."
#   }
# }
```

### 3.3 Monitor SSE Stream

In Terminal 3, you should see events flowing:

```
data: {"type":"connection","message":"Connected to event stream"}

data: {"type":"domain","status":"queued","domain":"test-sandbox-forj-12345.com"}
data: {"type":"domain","status":"checking","domain":"test-sandbox-forj-12345.com"}
data: {"type":"domain","status":"available","domain":"test-sandbox-forj-12345.com"}
data: {"type":"domain","status":"registering","domain":"test-sandbox-forj-12345.com"}

data: {"type":"github","status":"verifying_org","org":"your-test-org"}
data: {"type":"github","status":"creating_repo","repo":"your-test-org/test-sandbox-forj-12345"}

data: {"type":"cloudflare","status":"creating_zone","domain":"test-sandbox-forj-12345.com"}
data: {"type":"cloudflare","status":"zone_created","zoneId":"abc123","nameservers":["ns1.cloudflare.com","ns2.cloudflare.com"]}

data: {"type":"domain","status":"updating_nameservers","nameservers":["ns1.cloudflare.com","ns2.cloudflare.com"]}
data: {"type":"domain","status":"complete"}

data: {"type":"dns","status":"wiring_records","records":["MX","SPF","DKIM","DMARC","CNAME"]}
data: {"type":"dns","status":"complete"}

data: {"type":"provisioning","status":"complete","duration_ms":123456}
```

### 3.4 Verify Results

**Domain registration (Namecheap):**
```bash
# Check domain is registered
curl -X GET "https://ap.www.namecheap.com/domains/domaincontrolpanel/test-sandbox-forj-12345.com/domain"
```

**GitHub repo:**
```bash
# Verify repo exists
gh repo view your-test-org/test-sandbox-forj-12345
```

**Cloudflare zone:**
```bash
# List zones (using your Cloudflare token)
curl -X GET "https://api.cloudflare.com/client/v4/zones" \
  -H "Authorization: Bearer YOUR_CLOUDFLARE_TOKEN" | jq '.result[] | select(.name=="test-sandbox-forj-12345.com")'
```

**DNS records:**
```bash
# Check MX record
dig MX test-sandbox-forj-12345.com +short

# Check SPF
dig TXT test-sandbox-forj-12345.com +short | grep spf

# Check DMARC
dig TXT _dmarc.test-sandbox-forj-12345.com +short
```

---

## Troubleshooting

### "Provisioning routes NOT registered"

**Symptom:** API server starts but you can't call `/provision` (404 Not Found).

**Cause:** Routes defined in `packages/api/src/routes/provision.ts` but not mounted in `server.ts`.

**Fix:** Add to `packages/api/src/server.ts`:

```typescript
import { provisionRoutes } from './routes/provision.js';

// ... after other route registrations ...
await server.register(provisionRoutes);
logger.info('Provisioning routes registered');
```

### "Invalid GitHub token" during provisioning

**Symptom:** GitHub worker fails with `401 Unauthorized`.

**Cause:** Token doesn't have required scopes (`admin:org`, `repo`).

**Fix:** Re-create GitHub OAuth App with correct scopes, or use a Personal Access Token (PAT) with those scopes for testing.

### "Cloudflare zone creation failed: account_id required"

**Symptom:** Cloudflare worker can't create zone.

**Cause:** API token doesn't include account-level permissions, or account ID not provided.

**Fix:**
1. Get account ID: `curl -H "Authorization: Bearer YOUR_TOKEN" https://api.cloudflare.com/client/v4/accounts | jq '.result[0].id'`
2. Pass it in provisioning config: `"cloudflareAccountId": "your-account-id"`

### "Nameserver update failed"

**Symptom:** Domain registered, Cloudflare zone created, but NS update fails.

**Cause:** Namecheap API rate limit exceeded, or NS values incorrectly formatted.

**Fix:**
- Check rate limiter: `redis-cli GET ratelimit:namecheap:global`
- Verify NS format: Must be FQDN without trailing dot (e.g., `ns1.cloudflare.com`, not `ns1.cloudflare.com.`)

### "DNS records not propagating"

**Symptom:** `dig` shows no records even after `dns` worker completes.

**Cause:** DNS propagation delay (can take 5-60 minutes).

**Fix:**
- Check records directly via Cloudflare API:
  ```bash
  curl -X GET "https://api.cloudflare.com/client/v4/zones/ZONE_ID/dns_records" \
    -H "Authorization: Bearer YOUR_TOKEN"
  ```
- Use `dnschecker.org` to check global propagation

---

## Testing Checklist

### Phase 5 Core Features

- [ ] **Stack 1-2**: Cloudflare API client works, token verification succeeds
- [ ] **Stack 3-4**: GitHub Device Flow completes, token stored encrypted
- [ ] **Stack 5**: GitHub org verification + repo creation works
- [ ] **Stack 6**: Cloudflare zone creation + NS extraction works
- [ ] **Stack 7**: DNS record wiring creates all records (MX, SPF, DKIM, DMARC, CNAME)
- [ ] **Stack 8**: DNS health checker detects missing/incorrect records
- [ ] **Stack 9**: CLI auth flows prompt for tokens correctly
- [ ] **Stack 10**: Orchestrator runs domain → (github ∥ cloudflare) → ns → dns in correct order
- [ ] **Stack 11**: End-to-end integration test passes
- [ ] **Stack 12**: Documentation updated, security reviewed

### Orchestration Logic

- [ ] Domain registration completes before NS update
- [ ] GitHub and Cloudflare run in parallel
- [ ] NS update waits for Cloudflare zone creation
- [ ] DNS wiring waits for NS update
- [ ] SSE events emitted at each stage
- [ ] Partial failures handled gracefully (e.g., GitHub fails but Cloudflare succeeds)

### Security

- [ ] Cloudflare tokens encrypted at rest (AES-256-GCM)
- [ ] GitHub tokens encrypted at rest (AES-256-GCM)
- [ ] Tokens never logged in plaintext
- [ ] Auth endpoints require JWT
- [ ] `/provision` endpoint requires JWT (if implemented)

---

## Performance Benchmarks

**Expected timings:**

| Stage | Duration | Notes |
|-------|----------|-------|
| Domain check | 2-5s | Namecheap API latency |
| Domain registration | 30-60s | Includes Namecheap processing |
| GitHub repo creation | 5-10s | Parallel with Cloudflare |
| Cloudflare zone creation | 5-10s | Parallel with GitHub |
| Nameserver update | 10-20s | Namecheap API + rate limiting |
| DNS record wiring | 10-30s | 5+ API calls to Cloudflare |
| **Total end-to-end** | **90-180s** | ~2-3 minutes |

DNS propagation (external verification) can take 5-60 minutes after provisioning completes.

---

## Clean Up Test Data

After testing, clean up:

```bash
# Delete test domain (Namecheap)
# (manual via Namecheap dashboard - sandbox domains auto-expire)

# Delete GitHub repo
gh repo delete your-test-org/test-sandbox-forj-12345 --yes

# Delete Cloudflare zone
curl -X DELETE "https://api.cloudflare.com/client/v4/zones/ZONE_ID" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Clear Redis cache
redis-cli FLUSHDB

# Drop test database records
psql $DATABASE_URL -c "DELETE FROM projects WHERE project_id = 'test-project-1'"
psql $DATABASE_URL -c "DELETE FROM users WHERE email = 'test@forj.sh'"
```

---

## Next Steps

After Phase 5 testing passes:

1. **Phase 6:** Implement agent API keys, per-user rate limiting, credential rotation
2. **Phase 7:** Ship - npm publish, landing page update, demo video, Show HN
