# End-to-End Testing Guide

This document provides instructions for testing the complete Forj provisioning flow.

## Prerequisites

1. **Environment Variables**
   ```bash
   # Database
   DATABASE_URL=postgresql://...
   REDIS_URL=redis://localhost:6379

   # Authentication
   JWT_SECRET=$(openssl rand -base64 32)
   CLOUDFLARE_ENCRYPTION_KEY=$(openssl rand -base64 32)

   # Namecheap (Sandbox mode for testing)
   ENABLE_NAMECHEAP_ROUTES=true
   NAMECHEAP_API_USER=...
   NAMECHEAP_API_KEY=...
   NAMECHEAP_USERNAME=...
   NAMECHEAP_CLIENT_IP=...
   NAMECHEAP_SANDBOX=true

   # GitHub (Optional - for testing GitHub integration)
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

2. **Services Running**
   ```bash
   # Terminal 1: API Server
   npm run dev -w packages/api

   # Terminal 2: Workers
   npm run dev -w packages/workers

   # Terminal 3: Redis (if not running)
   redis-server
   ```

## Test Scenarios

### 1. Domain-Only Provisioning

**Objective:** Test domain registration via Namecheap sandbox

```bash
# Build CLI
npm run build -w packages/cli

# Authenticate
curl -X POST http://localhost:3000/auth/cli \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","cliVersion":"0.1.0"}' \
  | jq -r '.data.token' > /tmp/forj-token.txt

# Save token to CLI config
mkdir -p ~/.forj
echo "{\"authToken\":\"$(cat /tmp/forj-token.txt)\",\"apiUrl\":\"http://localhost:3000\"}" > ~/.forj/config.json

# Run provisioning
cd packages/cli
node dist/cli.js init test-project --domain test-$(date +%s).com --services domain --non-interactive
```

**Expected Results:**
- Project created in database
- Domain registration job queued
- Worker processes job
- SSE events streamed to CLI
- Domain registered in Namecheap sandbox
- CLI completes or times out after 10 minutes

**Validation:**
```bash
# Check project status
curl -H "Authorization: Bearer $(cat /tmp/forj-token.txt)" \
  http://localhost:3000/projects/{projectId}/status
```

### 2. Full Stack Provisioning (Domain + Cloudflare + GitHub)

**Objective:** Test complete infrastructure provisioning

**Prerequisites:**
- User must have Cloudflare token stored (via auth flow)
- User must have GitHub token stored (via Device Flow)
- GitHub org must exist

```bash
# 1. Store Cloudflare credentials (one-time setup)
# TODO: Implement /auth/cloudflare/store endpoint

# 2. Store GitHub credentials (one-time setup)
# TODO: Implement /auth/github/device-flow endpoint

# 3. Run full provisioning
node dist/cli.js init my-startup \
  --domain my-startup-$(date +%s).com \
  --services domain,cloudflare,github \
  --github-org my-startup-org \
  --non-interactive
```

**Expected Results:**
- Domain registered via Namecheap
- Cloudflare zone created
- Nameservers updated on domain
- GitHub org verified and repo created
- DNS records wired (MX, SPF, DKIM, DMARC)
- All events streamed via SSE
- CLI completes successfully

### 3. Timeout Handling

**Objective:** Verify CLI doesn't hang indefinitely

```bash
# Simulate slow/stalled provisioning by stopping workers
# Kill worker process (Terminal 2)

# Run provisioning (will timeout after 10 minutes)
node dist/cli.js init timeout-test \
  --domain timeout-test.com \
  --services domain \
  --non-interactive
```

**Expected Results:**
- CLI waits for events
- After 10 minutes, timeout error displayed
- CLI exits cleanly
- Error message: "Connection timed out after 600 seconds..."

## Integration Test Checklist

Before launch, verify all these scenarios pass:

- [ ] Domain-only provisioning completes successfully
- [ ] Domain registration creates Namecheap order
- [ ] Cloudflare zone creation works
- [ ] Nameserver update propagates
- [ ] GitHub org verification succeeds
- [ ] GitHub repo creation works
- [ ] DNS records are wired correctly (MX, SPF, DKIM, DMARC)
- [ ] SSE events stream in real-time to CLI
- [ ] CLI timeout triggers after 10 minutes of inactivity
- [ ] Database persistence works (project state saved)
- [ ] User credential encryption/decryption works
- [ ] Rate limiting works (per-user and per-IP)
- [ ] API key authentication works
- [ ] Authorization checks prevent IDOR
- [ ] Domain uniqueness check prevents duplicates

## Troubleshooting

### Workers Not Processing Jobs

```bash
# Check Redis connection
redis-cli ping

# Check queue status
curl http://localhost:3000/queues

# View worker logs
# Check Terminal 2 for worker output
```

### CLI Hangs Forever

**Cause:** Timeout not configured or workers crashed

**Fix:**
1. Check workers are running (`npm run dev -w packages/workers`)
2. Verify Redis is running (`redis-cli ping`)
3. Check API logs for errors

### Database Errors

**Cause:** Migrations not run

**Fix:**
```bash
npm run db:migrate -w packages/api
```

### Credentials Not Decrypting

**Cause:** CLOUDFLARE_ENCRYPTION_KEY mismatch

**Fix:**
- Ensure same key used for encryption and decryption
- Re-encrypt credentials if key changed

## Performance Benchmarks

Target provisioning times:

- Domain only: < 2 minutes
- Domain + Cloudflare: < 3 minutes
- Full stack (Domain + CF + GitHub + DNS): < 5 minutes

If provisioning takes longer, investigate:
- Namecheap API response times
- Worker concurrency settings
- Network latency
- Redis pub/sub performance
