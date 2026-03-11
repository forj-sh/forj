# Phase 4 Testing Guide

**Last Updated:** March 11, 2026

## Overview

Phase 4 (Integration + Security) includes 11 stacks implementing:
- JWT authentication & authorization
- Redis pub/sub + SSE streaming
- Namecheap API integration
- Stripe checkout + webhook verification
- Server-side pricing validation

## Prerequisites

### Required Services
- **Redis** (localhost:6379)
- **PostgreSQL** (Neon or local)
- **Node.js** 18+

### Environment Variables

Create `packages/api/.env`:
```bash
# Core
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
JWT_SECRET=$(openssl rand -base64 32)

# Namecheap Sandbox
NAMECHEAP_API_USER=<your-sandbox-username>
NAMECHEAP_API_KEY=<your-sandbox-api-key>
NAMECHEAP_USERNAME=<your-sandbox-username>
NAMECHEAP_CLIENT_IP=<your-public-ip>
NAMECHEAP_SANDBOX=true
ENABLE_NAMECHEAP_ROUTES=true

# Stripe (Optional)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

## Running Tests

### 1. Start Services

```bash
# Install Redis (if not already installed)
brew install redis
brew services start redis

# Verify Redis
redis-cli ping  # Should return PONG
```

### 2. Start API Server

```bash
# From project root
npm run dev -w packages/api

# Expected output:
# ✓ Database connection successful
# ✓ Redis connection successful
# ✓ Namecheap domain routes registered (production mode)
# ✓ Stripe checkout routes registered
# ✓ Server listening at http://0.0.0.0:3000
```

### 3. Run Integration Tests

```bash
# SSE streaming tests
npm test -w packages/api -- sse-streaming.test.ts

# Expected: 3/3 tests passing
```

### 4. Manual API Tests

```bash
# Get JWT token
TOKEN=$(curl -s -X POST http://localhost:3000/auth/cli \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.data.token')

# Test domain availability
curl -s -X POST http://localhost:3000/domains/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"domains": ["example.com", "test.io"]}' | jq

# Test without auth (should fail with 401)
curl -s -X POST http://localhost:3000/domains/check \
  -H "Content-Type: application/json" \
  -d '{"domains": ["example.com"]}'
```

## Namecheap Sandbox Setup

### 1. Create Sandbox Account

1. Go to: https://www.sandbox.namecheap.com
2. Sign up for free sandbox account
3. Verify email

### 2. Enable API Access

1. Login to: https://ap.www.sandbox.namecheap.com
2. Navigate: Profile > Tools
3. Find: "Namecheap API Access" section
4. Toggle **ON**
5. Accept Terms of Service
6. Enter password to confirm

### 3. Whitelist Your IP

1. In API Access section, find "Whitelisted IPs"
2. Click "Edit" > "Add IP"
3. Get your public IP: `curl https://api.ipify.org`
4. Enter IP address
5. Click "Save Changes"

### 4. Copy Credentials

From the API Access page:
- **API Key** - Copy this to `NAMECHEAP_API_KEY`
- **Username** - Copy to `NAMECHEAP_API_USER` and `NAMECHEAP_USERNAME`

### 5. Test API Connection

```bash
# Replace with your actual credentials
curl "https://api.sandbox.namecheap.com/xml.response?\
ApiUser=<USERNAME>&\
ApiKey=<API_KEY>&\
UserName=<USERNAME>&\
Command=namecheap.domains.check&\
ClientIp=<YOUR_IP>&\
DomainList=test.com"

# Expected: <ApiResponse Status="OK">
```

## Common Issues

### "API Key is invalid" (Error 1011102)

**Possible causes:**
1. Wrong username (ApiUser must match your sandbox account username)
2. IP not whitelisted in sandbox portal
3. API access not enabled in sandbox (check it's ON)
4. Accessing production portal instead of sandbox
5. Propagation delay (wait 5-10 minutes after enabling)

**Solution:**
1. Verify you're on **sandbox portal**: https://ap.www.sandbox.namecheap.com
2. Check API Access is **ON**
3. Verify IP is whitelisted (must be IPv4, exact match)
4. Double-check username matches exactly
5. Wait 10 minutes, restart API server

### "Redis connection failed"

```bash
# Check Redis is running
redis-cli ping

# Start Redis
brew services start redis

# Verify URL in .env
REDIS_URL=redis://localhost:6379
```

### "JWT verification failed"

```bash
# Ensure JWT_SECRET is set in .env
echo $JWT_SECRET  # Should not be empty

# Generate new secret
openssl rand -base64 32
```

### "Module not found" in CLI

CLI package uses `.js` extensions for ESM imports.
Ensure imports use: `import { foo } from './bar.js'`

## Expected Test Results

### JWT Authentication
- ✅ 401 without token
- ✅ 200 with valid JWT
- ✅ Token includes userId, email, iat, exp

### Domain Availability
- ✅ Batch checking works (multiple domains)
- ✅ Real Namecheap data (google.com shows as taken)
- ✅ Available domains return `available: true`

### SSE Streaming
- ✅ 3/3 integration tests pass
- ✅ Event isolation per projectId
- ✅ Multi-subscriber support

### Authorization
- ✅ Protected routes require auth
- ✅ IDOR protection (can't access others' jobs)
- ✅ User ID enforced from JWT

## Verification Checklist

- [ ] Redis running and connected
- [ ] Database connected
- [ ] JWT tokens generating correctly
- [ ] Auth rejects invalid tokens
- [ ] Namecheap sandbox API working
- [ ] Domain checks return real data
- [ ] SSE integration tests passing
- [ ] Server handles errors gracefully

## Security Notes

⚠️ **Never commit credentials:**
- Sandbox API keys should stay in `.env` only
- Add test files with credentials to `.gitignore`
- Redact credentials when sharing logs

⚠️ **Production vs Sandbox:**
- Use separate API keys for production
- Production requires $50 deposit or 20+ domains
- Always test in sandbox first

## Next Steps

After Phase 4 testing is complete:
- Phase 5: GitHub OAuth + repository creation
- Phase 6: Cloudflare zone management
- Phase 7: DNS wiring automation
- Phase 8: Credential security + agent API keys

## Resources

- Namecheap API Docs: https://www.namecheap.com/support/api/intro/
- Sandbox Signup: https://www.sandbox.namecheap.com
- Sandbox Portal: https://ap.www.sandbox.namecheap.com
