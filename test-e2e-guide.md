# End-to-End Testing Guide

This document describes how to test the complete Forj infrastructure provisioning flow.

## Test Environment Setup

### Prerequisites

1. **Services Running:**
   ```bash
   # Terminal 1: Redis
   redis-server

   # Terminal 2: API Server
   cd packages/api
   npm run dev

   # Terminal 3: Domain Worker
   cd packages/workers
   npm run dev
   ```

2. **Environment Variables:**

   Generate and set these in `packages/api/.env`:
   ```bash
   # Core services (REQUIRED)
   DATABASE_URL=postgresql://...
   REDIS_URL=redis://localhost:6379

   # Generate JWT secret (run in terminal, then copy output to .env file)
   # DO NOT put shell substitution directly in .env - it won't be evaluated
   openssl rand -base64 32
   # Then manually add to .env:
   JWT_SECRET=<paste output from above command>

   # Optional: Real API credentials for live testing
   NAMECHEAP_API_USER=...
   NAMECHEAP_API_KEY=...
   NAMECHEAP_USERNAME=...
   NAMECHEAP_SANDBOX=true
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   CLOUDFLARE_API_TOKEN=...
   ```

## Test Scenarios

### 1. Complete Provisioning Flow

Test the full orchestrator end-to-end using BullMQ and background workers.

**IMPORTANT**: This scenario runs the real provisioning orchestrator. It requires:
- Redis server running
- API server running (`npm run dev -w packages/api`)
- Workers running (`cd packages/workers && npm run dev`)
- External integrations use real or sandbox credentials from your `.env`

Without all services running, the `/provision` endpoint may block or timeout.

**Command:**
```bash
curl -X POST http://localhost:3000/provision \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user-123",
    "projectId": "test-project-123",
    "domain": "test-example.com",
    "namecheapApiUser": "test",
    "namecheapApiKey": "test-key",
    "namecheapUsername": "test",
    "githubToken": "test-github-token",
    "cloudflareApiToken": "test-cf-token",
    "years": 1,
    "contactInfo": {
      "firstName": "Test",
      "lastName": "User",
      "email": "test@example.com",
      "phone": "+1.5551234567",
      "address1": "123 Test St",
      "city": "Test City",
      "stateProvince": "CA",
      "postalCode": "12345",
      "country": "US"
    },
    "githubOrg": "test-org",
    "emailProvider": "google_workspace"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "projectId": "test-project-123",
    "jobs": {
      "domainRegistration": "domain:register:uuid",
      "githubOrgVerify": "github:verify:uuid",
      "githubRepoCreate": "github:create:uuid",
      "cloudflareZone": "cloudflare:zone:uuid",
      "nameserverUpdate": "domain:ns:uuid",
      "nameserverVerify": "cloudflare:verify:uuid",
      "dnsWiring": "dns:wire:uuid",
      "dnsVerification": "dns:verify:uuid"
    },
    "message": "Provisioning started. Use /events/stream/:projectId to monitor progress."
  }
}
```

**Monitor Progress:**
```bash
# Stream SSE events
curl -N http://localhost:3000/events/stream/test-project-123
```

### 2. Domain Registration Only

Test domain worker in isolation.

**Command:**
```bash
curl -X POST http://localhost:3000/domains/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "domainName": "test-domain.com",
    "projectId": "test-project-123",
    "years": 1,
    "registrant": {
      "firstName": "Test",
      "lastName": "User",
      "email": "test@example.com",
      "phone": "+1.5551234567",
      "address1": "123 Test St",
      "city": "Test City",
      "stateProvince": "CA",
      "postalCode": "12345",
      "country": "US"
    },
    "tech": {
      "firstName": "Test",
      "lastName": "User",
      "email": "test@example.com",
      "phone": "+1.5551234567",
      "address1": "123 Test St",
      "city": "Test City",
      "stateProvince": "CA",
      "postalCode": "12345",
      "country": "US"
    },
    "admin": {
      "firstName": "Test",
      "lastName": "User",
      "email": "test@example.com",
      "phone": "+1.5551234567",
      "address1": "123 Test St",
      "city": "Test City",
      "stateProvince": "CA",
      "postalCode": "12345",
      "country": "US"
    },
    "auxBilling": {
      "firstName": "Test",
      "lastName": "User",
      "email": "test@example.com",
      "phone": "+1.5551234567",
      "address1": "123 Test St",
      "city": "Test City",
      "stateProvince": "CA",
      "postalCode": "12345",
      "country": "US"
    },
    "addFreeWhoisguard": true,
    "wgEnabled": true,
    "isPremiumDomain": false
  }'
```

**Check Status:**
```bash
curl http://localhost:3000/domains/jobs/{jobId} \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### 3. GitHub Authentication (CLI)

Test GitHub OAuth Device Flow.

**Command:**
```bash
cd packages/cli
npm run build
node dist/cli.js auth github
```

**Expected Flow:**
1. CLI displays device code and opens browser
2. User authorizes on GitHub
3. CLI polls and receives access token
4. Token saved to `~/.forj/config.json`

### 4. Cloudflare Authentication (CLI)

Test Cloudflare guided token creation.

**Command:**
```bash
node dist/cli.js auth cloudflare
```

**Expected Flow:**
1. CLI guides user to create API token
2. Opens Cloudflare dashboard
3. User creates token with correct permissions
4. CLI verifies token
5. Token saved to `~/.forj/config.json`

### 5. DNS Health Check

Test DNS health checker with live DNS.

**Command:**
```bash
curl "http://localhost:3000/projects/test-123/dns/health?domain=google.com&zoneId=test-zone"
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "domain": "google.com",
    "overall": "healthy",
    "records": [
      {
        "type": "MX",
        "name": "google.com",
        "value": "aspmx.l.google.com",
        "status": "valid"
      }
    ],
    "checkedAt": "<timestamp>"
  }
}
```

### 6. DNS Auto-Repair

Test DNS auto-repair functionality.

**Command:**
```bash
curl -X POST http://localhost:3000/projects/test-123/dns/fix \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "example.com",
    "zoneId": "test-zone-123",
    "cloudflareApiToken": "test-token",
    "recordTypes": ["MX", "TXT"]
  }'
```

## Integration Test Suite

### Running Tests

```bash
# API tests
cd packages/api
npm test

# CLI tests (when implemented)
cd packages/cli
npm test

# Workers tests
cd packages/workers
npm test
```

### Coverage

Generate test coverage reports:

```bash
# API coverage
cd packages/api
npm run test:coverage

# Workers coverage
cd packages/workers
npm run test:coverage
```

## Load Testing

Test system under load with multiple concurrent provisioning requests.

**Setup:**
```bash
npm install -g artillery
```

**Run Load Test:**
```bash
artillery quick --count 10 --num 5 http://localhost:3000/health
```

**Custom Scenario:**
```yaml
# artillery-provision.yml
config:
  target: 'http://localhost:3000'
  phases:
    - duration: 60
      arrivalRate: 5
scenarios:
  - flow:
    - post:
        url: '/provision'
        json:
          userId: 'load-test-{{ $randomString() }}'
          projectId: 'load-test-{{ $randomString() }}'
          domain: 'test-{{ $randomString() }}.com'
          # ... rest of config
```

```bash
artillery run artillery-provision.yml
```

## Monitoring

### Queue Health

```bash
curl http://localhost:3000/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "<timestamp>",
  "services": {
    "database": "connected",
    "redis": "connected",
    "queues": {
      "domain": { "waiting": 0, "active": 0, "completed": 5, "failed": 0 },
      "github": { "waiting": 0, "active": 0, "completed": 3, "failed": 0 },
      "cloudflare": { "waiting": 0, "active": 0, "completed": 3, "failed": 0 },
      "dns": { "waiting": 0, "active": 0, "completed": 2, "failed": 0 }
    }
  }
}
```

### Worker Logs

Monitor worker activity in real-time:

```bash
# Domain worker logs
cd packages/workers
npm run dev | grep -i "domain"

# All workers
npm run dev
```

## Troubleshooting

### Common Issues

1. **Jobs stuck in pending:**
   - Check workers are running
   - Verify Redis connection
   - Check worker logs for errors

2. **Authentication failures:**
   - Verify JWT_SECRET is set
   - Check token expiration
   - Ensure authorization header format

3. **DNS verification fails:**
   - DNS propagation takes time (up to 48 hours)
   - Check nameservers are correct
   - Verify Cloudflare zone is active

4. **Worker crashes:**
   - Check Redis memory
   - Verify all environment variables
   - Review error logs

### Debug Mode

Enable debug logging:

```bash
# API
LOG_LEVEL=debug npm run dev

# Workers
LOG_LEVEL=debug npm run dev
```

## Production Testing

Before deploying to production:

1. **Sanity Checks:**
   - [ ] All tests passing
   - [ ] No failing jobs in queues
   - [ ] Health endpoint returns healthy
   - [ ] SSE streaming works
   - [ ] Authentication flows work
   - [ ] DNS health checker works

2. **Load Testing:**
   - [ ] System handles 10 concurrent provisions
   - [ ] No memory leaks under load
   - [ ] Queue processing times acceptable
   - [ ] Database connection pool stable

3. **Security:**
   - [ ] JWT secret is strong
   - [ ] API keys encrypted at rest
   - [ ] Rate limiting enabled
   - [ ] CORS configured correctly
   - [ ] Input validation on all endpoints

4. **Monitoring:**
   - [ ] Error tracking configured (Sentry)
   - [ ] Metrics collection enabled
   - [ ] Alerting rules set up
   - [ ] Log aggregation working

## Manual Test Checklist

Complete provisioning flow with real credentials:

- [ ] Register test domain via Namecheap sandbox
- [ ] Create GitHub organization
- [ ] Verify GitHub org via API
- [ ] Create GitHub repository
- [ ] Create Cloudflare zone
- [ ] Update domain nameservers
- [ ] Verify nameserver propagation
- [ ] Wire DNS records (MX, SPF, DMARC, CNAME)
- [ ] Verify DNS propagation
- [ ] Test DNS health checker
- [ ] Test DNS auto-repair
- [ ] Monitor via SSE streaming
- [ ] Check all job statuses
- [ ] Verify project state in database

## Test Data Cleanup

After testing, clean up test data:

```bash
# Clear Redis queues
# WARNING: FLUSHDB deletes ALL data in the current Redis database (default DB 0)
# Consider using a dedicated Redis DB for tests to avoid data loss
# For example: REDIS_URL=redis://localhost:6379/15 in test .env

# Option 1: Flush current DB (use with caution)
redis-cli FLUSHDB

# Option 2: Use dedicated test DB (recommended)
redis-cli -n 15 FLUSHDB  # Only flush test DB 15

# Delete test projects from database
psql $DATABASE_URL -c "DELETE FROM projects WHERE user_id LIKE 'test-%'"

# Clean up test config
rm ~/.forj/config.json
```
