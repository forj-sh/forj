# Phase 5 Implementation Guide

**Status**: ✅ Complete (March 11, 2026)
**Stacks**: 12 stacks (all merged)
**Architecture**: Full infrastructure provisioning with GitHub, Cloudflare, and DNS automation

---

## Overview

Phase 5 implements the complete infrastructure provisioning flow with GitHub organization verification, Cloudflare DNS zone management, and automated DNS record wiring. This phase transforms Forj from a domain registration tool into a complete project infrastructure provisioner.

## What Was Built

### Core Features

1. **Cloudflare Integration** (Stacks 1-2)
   - Full Cloudflare API v4 client
   - Zone creation and management
   - DNS record CRUD operations
   - Token verification and encrypted storage
   - Support for all DNS record types (A, AAAA, CNAME, MX, TXT, NS, SOA)

2. **GitHub Integration** (Stacks 3-5)
   - OAuth Device Flow (RFC 8628) for CLI authentication
   - Organization verification via GitHub API
   - Automated repository creation
   - Branch protection setup
   - GitHub Pages configuration
   - BullMQ worker for GitHub operations

3. **DNS Automation** (Stacks 6-8)
   - Cloudflare zone creation and NS handoff
   - Automated DNS record wiring for email providers
   - Support for Google Workspace and Microsoft 365
   - MX, SPF, DKIM, DMARC, CNAME record auto-configuration
   - DNS health checker with record validation
   - Auto-repair functionality for missing/invalid records

4. **CLI Authentication** (Stack 9)
   - GitHub OAuth Device Flow in CLI
   - Cloudflare guided token creation in CLI
   - Token persistence in `~/.forj/config.json`
   - Interactive browser-based auth flows

5. **Provisioning Orchestration** (Stack 10)
   - 6-phase provisioning flow
   - Parallel execution where possible
   - Dependency management (domain → GitHub/Cloudflare → nameservers → DNS → verification)
   - Job tracking and status monitoring
   - Real-time SSE event streaming

6. **Testing & Documentation** (Stacks 11-12)
   - Integration test suite
   - End-to-end testing guide
   - Security review
   - Production deployment checklist

---

## Architecture

### System Components

```
┌─────────────────┐
│   CLI Client    │
│  (commander.js) │
└────────┬────────┘
         │ HTTPS + SSE
         ▼
┌─────────────────┐
│   API Server    │
│    (Fastify)    │
└────────┬────────┘
         │ BullMQ
         ▼
┌─────────────────────────────────────────┐
│           Worker Pool (BullMQ)          │
├─────────────┬─────────────┬─────────────┤
│   Domain    │   GitHub    │ Cloudflare  │
│   Worker    │   Worker    │   Worker    │
└─────────────┴─────────────┴─────────────┤
│          DNS Wiring Worker              │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│         External Services               │
├─────────────┬─────────────┬─────────────┤
│  Namecheap  │   GitHub    │ Cloudflare  │
│     API     │     API     │     API     │
└─────────────┴─────────────┴─────────────┘
```

### Provisioning Flow

**Phase 1: Domain Registration** (Blocking)
1. Register domain via Namecheap
2. Wait for registration to complete

**Phase 2: Parallel Setup** (Concurrent)
3. Verify GitHub organization exists
4. Create Cloudflare DNS zone
5. Create GitHub repository

**Phase 3: Nameserver Configuration** (Blocking)
6. Extract nameservers from Cloudflare zone
7. Update Namecheap domain with Cloudflare nameservers
8. Wait for nameserver update to complete

**Phase 4: Nameserver Verification** (Blocking)
9. Verify nameserver propagation via Cloudflare API
10. Retry with exponential backoff (up to 10 minutes)

**Phase 5: DNS Wiring** (Blocking)
11. Wire MX records for email provider
12. Wire SPF record
13. Wire DKIM records (if Google Workspace)
14. Wire DMARC record
15. Wire CNAME record (if custom domain)

**Phase 6: DNS Verification** (Async)
16. Verify DNS propagation (background job, non-blocking)

---

## API Reference

### Provisioning Endpoints

#### `POST /provision`
Start infrastructure provisioning.

**SECURITY NOTE**: The current implementation (Phase 5) accepts third-party credentials directly in the request body for MVP simplicity. **This is NOT production-ready.** A secure implementation would:
1. Client authenticates with short-lived JWT token
2. API server retrieves user's stored credentials from encrypted vault (server-side)
3. Credentials never transit from client to API on each request

**TODO (Phase 6)**: Implement server-side credential vault with encrypted storage. See `SECURITY-REVIEW.md` for full threat model.

**Request (Current - MVP only):**
```json
{
  "userId": "user-123",
  "projectId": "project-456",
  "domain": "example.com",
  "namecheapApiUser": "...",
  "namecheapApiKey": "...",
  "namecheapUsername": "...",
  "githubToken": "ghp_...",
  "cloudflareApiToken": "...",
  "years": 1,
  "contactInfo": { /* ... */ },
  "githubOrg": "example-org",
  "emailProvider": "google_workspace"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "projectId": "project-456",
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

#### `GET /provision/status/:projectId`
Get provisioning status.

**Response:**
```json
{
  "success": true,
  "data": {
    "projectId": "project-456",
    "status": "in_progress",
    "phases": {
      "domain": { "status": "completed", "duration": 45000 },
      "github": { "status": "completed", "duration": 12000 },
      "cloudflare": { "status": "in_progress", "duration": null },
      "dns": { "status": "pending", "duration": null }
    }
  }
}
```

### DNS Health Endpoints

#### `GET /projects/:id/dns/health`
Check DNS record health.

**Query Parameters:**
- `domain` (required): Domain to check
- `zoneId` (required): Cloudflare zone ID
- `emailProvider` (optional): Email provider (google_workspace, microsoft_365)

**Response:**
```json
{
  "success": true,
  "data": {
    "domain": "example.com",
    "overall": "healthy",
    "records": [
      {
        "type": "MX",
        "name": "example.com",
        "value": "aspmx.l.google.com",
        "status": "valid"
      },
      {
        "type": "TXT",
        "name": "example.com",
        "value": "v=spf1 include:_spf.google.com ~all",
        "status": "valid"
      }
    ],
    "checkedAt": "2026-03-11T22:00:00.000Z"
  }
}
```

#### `POST /projects/:id/dns/fix`
Auto-repair DNS records.

**Request:**
```json
{
  "domain": "example.com",
  "zoneId": "zone-123",
  "cloudflareApiToken": "...",
  "recordTypes": ["MX", "TXT"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "domain": "example.com",
    "recordsFixed": 5,
    "details": [
      { "type": "MX", "name": "example.com", "action": "created" },
      { "type": "TXT", "name": "example.com", "action": "updated" }
    ]
  }
}
```

---

## Worker State Machines

### GitHub Worker States

```
PENDING → QUEUED → VERIFYING_ORG → ORG_VERIFIED → CREATING_REPO →
CONFIGURING_REPO → COMPLETE
                                                              ↓
                                                           FAILED
```

**Skip Paths:**
- If organization already verified: PENDING → QUEUED → ORG_VERIFIED
- If repository already exists: CREATING_REPO → COMPLETE

### Cloudflare Worker States

```
PENDING → QUEUED → CREATING_ZONE → ZONE_CREATED → EXTRACTING_NS →
NS_EXTRACTED → COMPLETE
                                                              ↓
                                                           FAILED
```

### DNS Wiring Worker States

```
PENDING → QUEUED → WIRING_MX → WIRING_SPF → WIRING_DKIM →
WIRING_DMARC → WIRING_CNAME → WIRING_COMPLETE → VERIFYING →
COMPLETE
    ↓
 FAILED
```

**Skip Paths:**
- Non-Google Workspace: WIRING_SPF → WIRING_DMARC (skip DKIM)
- No custom domain: WIRING_DMARC → WIRING_COMPLETE (skip CNAME)
- Skip verification: WIRING_COMPLETE → COMPLETE

---

## DNS Record Defaults

### Google Workspace

**MX Records:**
```
Priority 1:  aspmx.l.google.com
Priority 5:  alt1.aspmx.l.google.com
Priority 5:  alt2.aspmx.l.google.com
Priority 10: alt3.aspmx.l.google.com
Priority 10: alt4.aspmx.l.google.com
```

**SPF Record:**
```
v=spf1 include:_spf.google.com ~all
```

**DMARC Record:**
```
v=DMARC1; p=none; rua=mailto:dmarc@{domain}
```

### Microsoft 365

**MX Record:**
```
Priority 0: {domain-prefix}.mail.protection.outlook.com
```

**SPF Record:**
```
v=spf1 include:spf.protection.outlook.com ~all
```

**DMARC Record:**
```
v=DMARC1; p=none; rua=mailto:dmarc@{domain}
```

---

## Environment Variables

### Required for Production

**API Server** (`packages/api/.env`):
```bash
# Core services
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
JWT_SECRET=$(openssl rand -base64 32)

# Namecheap (domain registration)
NAMECHEAP_API_USER=...
NAMECHEAP_API_KEY=...
NAMECHEAP_USERNAME=...
NAMECHEAP_CLIENT_IP=...
NAMECHEAP_SANDBOX=false  # Use production API
ENABLE_NAMECHEAP_ROUTES=true

# Stripe (payments)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...

# Workers
DOMAIN_WORKER_CONCURRENCY=5
GITHUB_WORKER_CONCURRENCY=10
CLOUDFLARE_WORKER_CONCURRENCY=10
DNS_WORKER_CONCURRENCY=5

# Features
RATE_LIMITING_ENABLED=true
LOG_LEVEL=info
```

### Optional for Development

```bash
# Use sandbox APIs
NAMECHEAP_SANDBOX=true

# Enable debugging
LOG_LEVEL=debug
ENABLE_BULL_BOARD=true  # Queue monitoring UI

# Use test Stripe keys
STRIPE_SECRET_KEY=sk_test_...
```

---

## Security Review

### ✅ Implemented Security Measures

1. **Authentication**
   - ✅ JWT auth middleware on all protected routes
   - ✅ Token expiration (30 days, configurable)
   - ✅ Authorization checks prevent IDOR attacks
   - ✅ GitHub OAuth Device Flow (RFC 8628)

2. **API Security**
   - ✅ Stripe webhook signature verification
   - ✅ Server-side pricing validation
   - ✅ Input validation on all endpoints
   - ✅ Error sanitization (no credential leakage)

3. **Rate Limiting**
   - ✅ Namecheap API: Redis-backed sliding window (20 req/min)
   - ✅ Priority queue with fairness guarantees

4. **Credential Management**
   - ✅ Cloudflare tokens encrypted with AES-256-GCM
   - ⚠️ GitHub tokens stored in plaintext in CLI config (see Security TODO)
   - ✅ Namecheap API keys encrypted at rest

### ⚠️ Security TODO

1. **Rate Limiting**
   - ⚠️ Per-user API rate limiting (not yet implemented)
   - ⚠️ Per-IP rate limiting (not yet implemented)
   - ⚠️ Burst protection (not yet implemented)

2. **Monitoring**
   - ⚠️ Error tracking (Sentry integration pending)
   - ⚠️ Security event logging (audit trail pending)
   - ⚠️ Alerting for suspicious activity (pending)

3. **Production Hardening**
   - ⚠️ CORS configuration review
   - ⚠️ Content Security Policy headers
   - ⚠️ DDoS protection (Cloudflare WAF)

---

## Testing

### Running Tests

```bash
# Integration tests
npm test -w packages/api -- orchestrator.test.ts

# State machine tests
npm test -w packages/shared -- dns-worker.test.ts
npm test -w packages/shared -- github-worker.test.ts
npm test -w packages/shared -- cloudflare-worker.test.ts

# All tests
npm test
```

### Manual E2E Testing

See `test-e2e-guide.md` for comprehensive testing instructions.

**Quick test:**
```bash
# Terminal 1: Start API server
npm run dev -w packages/api

# Terminal 2: Start workers
cd packages/workers && npm run dev

# Terminal 3: Test provisioning
curl -X POST http://localhost:3000/provision \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @test-provision-config.json
```

---

## Deployment

### Prerequisites

1. **Infrastructure**
   - Neon Postgres database (serverless)
   - Redis instance (Upstash or managed)
   - Node.js 18+ runtime (Railway, Render, or Fly.io)

2. **External Accounts**
   - Namecheap Reseller API ($50 deposit)
   - Stripe account (payment processing)
   - Cloudflare account (optional, for user's own zones)

3. **Secrets**
   - Generate strong JWT_SECRET: `openssl rand -base64 32`
   - Create Stripe webhook endpoint and save secret
   - Configure Namecheap production API credentials

### Deployment Steps

1. **Database Setup**
   ```bash
   # Run migrations
   npm run db:migrate -w packages/api
   ```

2. **Environment Variables**
   - Set all required env vars in production hosting platform
   - Ensure `NAMECHEAP_SANDBOX=false` for production
   - Set `ENABLE_NAMECHEAP_ROUTES=true`

3. **Deploy API Server**
   ```bash
   # Railway example
   railway up

   # Or Render
   render deploy
   ```

4. **Deploy Workers**
   - Workers can run in same process as API server
   - Or deploy separately for better isolation
   - Ensure Redis connection is shared

5. **Verify Deployment**
   ```bash
   # Check health endpoint
   curl https://api.forj.sh/health

   # Expected: {"status":"healthy","services":{...}}
   ```

### Monitoring

1. **Queue Health**
   - Monitor `/health` endpoint for queue metrics
   - Alert on high failed job counts
   - Track job processing times

2. **Application Metrics**
   - API response times
   - Worker job durations
   - Redis memory usage
   - Database connection pool

3. **Business Metrics**
   - Domain registrations per day
   - Provisioning success rate
   - Average provisioning time
   - Failed jobs by type

---

## Troubleshooting

### Common Issues

**"GitHub organization not found"**
- User must create org manually first (15-second browser flow)
- Verify org name is exact match (case-sensitive)
- Check GitHub token has `admin:org` scope

**"Cloudflare nameserver verification timeout"**
- DNS propagation can take up to 48 hours
- Retry logic has 10-minute timeout with exponential backoff
- Check Namecheap nameserver update actually succeeded

**"DNS records not wiring correctly"**
- Verify Cloudflare zone is active (not pending)
- Check Cloudflare API token has Zone.DNS.Edit permission
- Review worker logs for specific record creation errors

**"Microsoft 365 MX record has wrong domain"**
- Placeholder replacement uses first part of domain before first dot
- Example: `getacme.com` → `getacme.mail.protection.outlook.com`
- Verify this matches Microsoft 365 expected format

**"Worker jobs stuck in pending"**
- Check Redis connection is healthy
- Verify workers are running: `npm run dev` in packages/workers
- Check worker logs for startup errors

### Debug Mode

```bash
# API server
LOG_LEVEL=debug npm run dev -w packages/api

# Workers
LOG_LEVEL=debug npm run dev -w packages/workers

# Enable Bull Board (queue UI)
ENABLE_BULL_BOARD=true npm run dev -w packages/api
# Access at http://localhost:3000/queues
```

---

## Performance Characteristics

### Provisioning Times (Typical)

| Phase | Duration | Notes |
|-------|----------|-------|
| Domain registration | 30-60s | Namecheap API latency |
| GitHub org verify | 2-5s | API call only |
| GitHub repo create | 5-10s | Includes branch protection setup |
| Cloudflare zone create | 5-10s | Immediate zone activation |
| Nameserver update | 30-60s | Namecheap API latency |
| Nameserver verify | 1-10min | DNS propagation delay |
| DNS wiring | 10-20s | 5-10 DNS records created |
| DNS verification | 5-60min | Full propagation (async) |

**Total end-to-end**: 2-15 minutes (depending on DNS propagation)

### Scaling Limits

- **Namecheap API**: 20 requests/min (hard limit)
- **GitHub API**: 5000 requests/hour per token
- **Cloudflare API**: 1200 requests/5min per token
- **Worker concurrency**: Configurable (default 5-10 per worker type)

---

## Files Created in Phase 5

### Stack 1: Cloudflare API Client
- `packages/shared/src/cloudflare/client.ts`
- `packages/shared/src/cloudflare/types.ts`

### Stack 2: Cloudflare Token Verification
- `packages/shared/src/cloudflare/auth.ts`

### Stack 3: GitHub OAuth Device Flow
- `packages/shared/src/github/oauth.ts`

### Stack 4: GitHub API Client
- `packages/shared/src/github/client.ts`
- `packages/shared/src/github/types.ts`

### Stack 5: GitHub Worker
- `packages/shared/src/github-worker.ts`
- `packages/workers/src/github-worker.ts`
- `packages/shared/src/__tests__/github-worker.test.ts`

### Stack 6: Cloudflare Worker
- `packages/shared/src/cloudflare-worker.ts`
- `packages/workers/src/cloudflare-worker.ts`
- `packages/shared/src/__tests__/cloudflare-worker.test.ts`

### Stack 7: DNS Wiring Worker
- `packages/shared/src/dns-worker.ts`
- `packages/workers/src/dns-worker.ts`
- `packages/shared/src/__tests__/dns-worker.test.ts`

### Stack 8: DNS Health Checker
- `packages/api/src/lib/dns-health-checker.ts`
- `packages/api/src/routes/projects.ts` (updated)

### Stack 9: CLI Auth Flows
- `packages/cli/src/lib/auth-github.ts`
- `packages/cli/src/lib/auth-cloudflare.ts`
- `packages/cli/src/lib/config.ts` (updated)

### Stack 10: Provisioning Orchestrator
- `packages/api/src/lib/orchestrator.ts`
- `packages/api/src/routes/provision.ts`
- `packages/api/src/lib/queues.ts` (updated)
- `packages/api/src/lib/redis.ts` (updated)

### Stack 11: E2E Integration Testing
- `packages/api/src/__tests__/integration/orchestrator.test.ts`
- `test-e2e-guide.md`

### Stack 12: Documentation
- `PHASE5-IMPLEMENTATION.md` (this file)
- `SECURITY-REVIEW.md` (security audit)
- `PRODUCTION-DEPLOYMENT.md` (deployment guide)

---

## Next Steps (Post-Phase 5)

### Phase 6: Credential Security & Agent API
- Agent API keys for non-interactive mode
- Credential encryption at rest
- MCP server definition for AI coding agents
- Webhook support for provisioning events

### Phase 7: Production Launch
- Security audit and penetration testing
- Performance optimization
- Error tracking (Sentry integration)
- Monitoring and alerting setup
- npm publish forj-cli
- Landing page updates
- Launch announcement

---

## Support

For issues, questions, or feature requests:
- GitHub Issues: https://github.com/forj-sh/forj/issues
- Documentation: https://docs.forj.sh (coming soon)
- Email: support@forj.sh

---

**Phase 5 Status**: ✅ Complete
**Last Updated**: March 11, 2026
**Maintainers**: Forj Engineering Team
