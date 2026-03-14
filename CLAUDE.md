# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**Current Status (March 14, 2026):**
- **Phase:** 6 (Auth + Credential Security + Security Audit) - ✅ COMPLETE (PRs #63-#72 + #82-#88)
- **Next Phase:** 7 (Ship - Pre-launch validation & deployment)
- **Branch:** main (all Graphite stacks merged, security audit fixes applied)
- **Architecture:** Cloudflare as DNS authority. Namecheap is registrar only.

### Essential Commands
```bash
# Development (npm workspaces)
npm run dev -w packages/api          # Start API server (localhost:3000)
npm run dev -w packages/cli          # CLI watch mode
npm run dev -w packages/workers      # Start BullMQ workers
npm run dev -w packages/landing      # Landing page dev server

# Testing
npm test -w packages/api                              # Run all API tests
npm test -w packages/api -- sse-streaming.test.ts     # Run specific test
npm run test:watch -w packages/api                    # Watch mode
npm run test:coverage -w packages/api                 # Coverage report
curl http://localhost:3000/health                     # API health check

# Database migrations
npm run db:migrate -w packages/api                    # Run pending migrations
npm run db:migrate:create -w packages/api -- <name>   # Create new migration

# Type checking
npm run type-check -w packages/api    # Check API types
npm run type-check -w packages/cli    # Check CLI types

# Build
npm run build                         # Build all packages
npm run build -w packages/api         # Build API only

# Graphite workflow
gt create -m "Stack N: Description"  # Create new stack
gt modify                             # Amend current stack
gt restack                            # Rebase all stacks
gt submit                             # Push + create PRs
gt log short                          # View stack tree
```

### Critical Information

**Phase 6 Completion Checklist:**
- ✅ API key data model + generation service (Stack 1, PR #63)
- ✅ API key authentication middleware (Stack 2, PR #64)
- ✅ API key management routes (Stack 3, PR #65)
- ✅ Auth middleware on /provision route (Stack 4, PR #66)
- ✅ Per-user rate limiting infrastructure (Stack 5, PR #67)
- ✅ Per-IP rate limiting infrastructure (Stack 6, PR #68)
- ✅ Rate limiting applied to all routes (Stack 7, PR #69)
- ✅ API key rotation endpoint (Stack 8, PR #70)
- ✅ Credential rotation for OAuth tokens (Stack 9, PR #71)
- ✅ MCP tool definition + integration docs (Stack 10, PR #72)

**Security Audit Fixes (March 13-14):**
- ✅ Mock auth endpoint gating (PR #82 - CRITICAL)
- ✅ Database query optimization (PR #83 - MEDIUM)
- ✅ SSE stream authentication (PR #84 - MEDIUM)
- ✅ Remove credentials from job queue (PR #85 - MEDIUM)
- ✅ API key rotation bug fixes (PR #86 - MEDIUM)
- ✅ IP spoofing prevention (PR #87 - HIGH)
- ✅ Encryption key validation (PR #88 - LOW)

**Security Status (Post-Audit):**
- ✅ JWT authentication protects all domain routes
- ✅ IDOR vulnerability fixed (ownership checks)
- ✅ Stripe webhook forgery prevented (signature verification)
- ✅ Price manipulation prevented (server-side validation)
- ✅ Cloudflare/GitHub tokens encrypted at rest (AES-256-GCM)
- ✅ Per-user/per-IP rate limiting (sliding window, Redis + Lua)
- ✅ Agent API key auth with scope-based authorization
- ✅ Credential rotation support (API keys + OAuth tokens)
- ✅ `/provision` route protected with auth + rate limiting
- ✅ MCP integration for AI coding assistants
- ✅ **NEW**: Mock auth endpoint properly gated (CRITICAL fix)
- ✅ **NEW**: IP spoofing prevention via proxy trust (HIGH fix)
- ✅ **NEW**: SSE streams authenticated and authorized (MEDIUM fix)
- ✅ **NEW**: Credentials removed from Redis job queue (MEDIUM fix)

**Audit Results**: 8 vulnerabilities fixed (1 CRITICAL, 2 HIGH, 4 MEDIUM, 2 LOW)
**Security Posture**: ✅ STRONG - Ready for production launch after Phase 7 pre-launch tasks

**Environment Variables Required for Testing:**
```bash
# Minimum for development
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
JWT_SECRET=$(openssl rand -base64 32)

# Namecheap
ENABLE_NAMECHEAP_ROUTES=true
NAMECHEAP_API_USER=...
NAMECHEAP_API_KEY=...
NAMECHEAP_USERNAME=...
NAMECHEAP_CLIENT_IP=...
NAMECHEAP_SANDBOX=true

# Phase 5 additions
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
CLOUDFLARE_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

**Key Constraints:**
- ALL Namecheap API calls MUST use `requestQueue.submit()` for rate limiting
- CLI package requires `.js` extensions in imports (ESM requirement)
- NEVER bypass Graphite CLI (`gt`) for branch management
- Routes require `ENABLE_NAMECHEAP_ROUTES=true` to mount production endpoints

---

## Project Overview

**Forj** is an infrastructure provisioning CLI tool that creates production-ready project infrastructure with a single command. `npx forj-cli init my-startup` provisions domain registration (Namecheap), GitHub repos, Cloudflare DNS zone, and automatically wires all DNS records (MX, SPF, DKIM, DMARC) correctly in under 2 minutes.

The complete product specification is in `project-docs/forj-spec.md`.

## Branding & Naming

- **Domain**: forj.sh
- **GitHub org**: forj-sh
- **npm package**: forj-cli
- **CLI invocation (cold)**: `npx forj-cli init acme`
- **CLI invocation (global)**: `forj init acme` (after `npm install -g forj-cli`)

## Repository Structure

**Monorepo:** npm workspaces with 5 packages. Use `-w <package-name>` flag for package-specific commands.

```
forj/ (GitHub: forj-sh/forj)
├── packages/
│   ├── landing/        ✅ Landing page (Vite + TypeScript, forj.sh on Vercel)
│   ├── cli/            ✅ CLI client (ESM with .js extensions, commander + inquirer + SSE)
│   ├── api/            ✅ Fastify API server (routes, auth, Stripe, JWT)
│   │   ├── src/
│   │   │   ├── routes/        — 14 route files (health, domains, auth, projects, etc.)
│   │   │   ├── middleware/    — auth, rate-limit, ip-rate-limit
│   │   │   ├── lib/           — redis, queues, db, stripe, logger
│   │   │   └── __tests__/     — Integration tests (SSE, provisioning pipeline)
│   │   └── migrations/        — 4 migrations (projects, users, api-keys)
│   ├── workers/        ✅ BullMQ workers (domain, GitHub, Cloudflare, DNS)
│   │   └── src/               — 4 worker files + start script
│   └── shared/         ✅ Shared types + API clients
│       └── src/
│           ├── namecheap/     — Namecheap API client + rate limiter
│           ├── cloudflare/    — Cloudflare API client
│           ├── github/        — GitHub Device Flow OAuth + API client
│           └── *.ts           — Shared types (projects, domains, events, services)
├── api/                ✅ Vercel serverless functions (waitlist form)
├── lib/                ✅ Shared database utilities
├── project-docs/       ✅ Product specs, build plan, testing guide
└── CLAUDE.md           ✅ This file
```

**Package dependencies:**
- `api` depends on `shared` (for types and API clients)
- `workers` depends on `shared` (for worker implementations)
- `cli` is independent (no internal deps)

## Architecture

### System Design Principles

1. **CLI is a thin client** — All orchestration happens server-side via API. CLI authenticates, sends config, streams events back via SSE.
2. **Idempotent workers** — Each service worker (domain, GitHub, Cloudflare, DNS) can be re-run safely. Partial failures never corrupt state.
3. **State machine per project** — Each service has independent state: `pending → running → complete | failed`.
4. **Credentials are ephemeral** — Created, delivered once to CLI, then purged from server. Never persisted post-handoff.
5. **DNS wiring is first-class** — Auto-configuration of MX, SPF, DKIM, DMARC, CNAME records is a core operation, not an afterthought.

### Component Architecture

```
CLI Client (commander.js + inquirer)
    ↓ HTTPS + SSE
API Server (Fastify + TypeScript)
    ↓
Job Queue (BullMQ + Redis)
    ↓
Worker Pool:
  - Domain Worker (Namecheap Reseller API)
  - GitHub Worker (Device Flow auth + repo automation)
  - Cloudflare Worker (guided token auth → zone + NS management)
  - DNS Wiring Worker (MX/SPF/DKIM/DMARC via Cloudflare API)
    ↓
State Store (Postgres with JSONB for service states)
    ↓
Payment Processing (Stripe checkout → Namecheap wholesale billing)
```

### Provisioning Flow

```
1. Domain registered via Namecheap
2. GitHub org verified + repos created     ← parallel with step 3
3. Cloudflare zone created                 ← returns nameserver pair
4. Nameservers updated on Namecheap        ← uses setCustomNameservers()
5. DNS records wired via Cloudflare API    ← MX, SPF, DKIM, DMARC, CNAME
```

### Auth Approaches

- **GitHub**: OAuth Device Flow (RFC 8628) — user gets one-time code, enters at `github.com/login/device`. CLI polls until authorized. Same pattern as `gh auth login`.
- **Cloudflare**: Guided API token creation — CLI opens Cloudflare dashboard, user creates token with `Zone:Edit` + `DNS:Edit`, pastes back into CLI. Cloudflare does not support standard OAuth2 for third-party zone management.

### Data Model

Projects table stores project state with JSONB `services` column. Users table stores encrypted Cloudflare/GitHub tokens (AES-256-GCM).

**Database migrations:**
- `1741570800000_init-projects-table.cjs` — Projects table (UUID PK, JSONB services, VARCHAR user_id)
- `1741915200000_create-users-table.cjs` — Users table (encrypted token storage)
- `1773363143000_alter-user-id-to-varchar.cjs` — Migration to VARCHAR user IDs for auth flexibility
- `1773411143000_create-api-keys-table.cjs` — API keys table for agent authentication

## Tech Stack

**Backend:** Fastify 4, BullMQ + Redis, Neon Postgres (serverless), Pino logging
**CLI:** commander.js, inquirer, chalk, ora, eventsource (SSE)
**Integrations:** Namecheap Reseller API, GitHub REST API, Cloudflare API v4, Stripe Checkout, jose (JWT)
**Build:** tsup (esbuild), TypeScript strict mode, Node.js 18+

## Build Progress

| Phase | Status | Description |
|-------|--------|-------------|
| 1. CLI Client | ✅ Complete | All 6 commands, interactive + non-interactive modes |
| 2. API Server Scaffold | ✅ Complete | Fastify + Postgres + BullMQ + Redis (PRs #12-#18) |
| 3. Namecheap Domain Integration | ✅ Complete | Full API client, rate limiter, priority queue, domain worker (PRs #19-#30) |
| 4. Integration + Security | ✅ Complete | Route mounting, auth middleware, Stripe verification, SSE wiring (PRs #31-#41) |
| 5. GitHub + Cloudflare + DNS Wiring | ✅ Complete | Cloudflare API + zones, GitHub Device Flow + repos, DNS wiring, orchestrator (PRs #42-#62) |
| 6. Auth + Credential Security | ✅ Complete | Agent API keys, per-user/IP rate limiting, credential rotation, MCP definition (PRs #63-#72) |
| 7. Ship | 🔲 Next | npm publish, demo, launch |

**Full build plan:** `project-docs/build-plan.md`

## Testing

```bash
# Run all integration tests
npm test -w packages/api

# Run specific test file
npm test -w packages/api -- sse-streaming.test.ts
npm test -w packages/api -- provisioning-pipeline.test.ts

# Watch mode for TDD
npm run test:watch -w packages/api

# Coverage report
npm run test:coverage -w packages/api

# Start services for manual testing
npm run dev -w packages/api          # Terminal 1: API server on :3000
npm run dev -w packages/workers      # Terminal 2: BullMQ workers
redis-server                         # Terminal 3: Redis (if not running)

# Health checks
curl http://localhost:3000/health                     # API health
curl http://localhost:3000/queues                     # Queue status
```

**Test requirements:**
- All tests use Jest with ts-jest preset for ESM support
- Mock strategy: `global.fetch` for HTTP calls, `jest.fn()` for Redis
- Tests run with `NODE_OPTIONS=--experimental-vm-modules` for ESM compatibility
- Integration tests require Redis running locally

See `project-docs/testing-guide.md` for comprehensive testing instructions.

## Development Workflow

### Git Workflow: Graphite Stacking Method

**IMPORTANT**: All feature development MUST use the Graphite CLI (`gt`) for stacked PRs. Do NOT use raw `git` commands for branch management.

```bash
# Essential commands
gt create -m "Stack 1: Description"      # Create new branch on top of current stack
gt modify                                  # Amend current stack (after making changes)
gt restack                                 # Rebase all stacks after lower stack changes
gt submit                                  # Push all stacks + create/update PRs on GitHub
gt log short                               # View your current stack
gt checkout <branch>                       # Switch between stacks
gt trunk                                   # Switch back to main
```

**Stack guidelines:** Each stack should be independently testable, represent a complete logical unit, and be small enough to review in < 10 minutes (50-500 lines). Always provide clear PR descriptions with Summary, Changes, Stack Context, Dependencies, and Testing sections.

**Common mistakes to avoid:**
- ❌ Don't use raw `git` commands for branch management
- ❌ Don't make stacks too large (> 500 lines) or too granular (< 50 lines)
- ❌ Don't skip PR descriptions

## Local Development Setup

### Prerequisites
- **Node.js**: >= 18.0.0 / **npm**: >= 9.0.0
- **Redis**: Required for API/workers (rate limiting, BullMQ)
- **PostgreSQL**: Neon Postgres in production, local Postgres for dev

### First-Time Setup

```bash
npm install
npm run db:migrate -w packages/api
npm run build
npm run dev
```

## Key Architectural Patterns

**Import Conventions:**
- CLI package uses `.js` extensions (ESM requirement)
- Other packages omit extensions
- All async code uses async/await

**Error Handling:**
- API responses: `{ success: boolean, data?: any, error?: string }`
- Worker errors: throw for BullMQ retry mechanism
- Namecheap errors: 6 categories (AUTH, INPUT, AVAILABILITY, PAYMENT, SYSTEM, NETWORK) with retryability flags
- Cloudflare/GitHub errors: similar categorization pattern

**State Machines:**
- Domain: PENDING → QUEUED → CHECKING → AVAILABLE → REGISTERING → CONFIGURING → COMPLETE/FAILED
- Cloudflare: PENDING → CREATING_ZONE → ZONE_CREATED → UPDATING_NS → VERIFYING → COMPLETE/FAILED
- GitHub: PENDING → VERIFYING_ORG → CREATING_REPO → CONFIGURING → COMPLETE/FAILED
- DNS: PENDING → WIRING_MX → WIRING_SPF → WIRING_DKIM → WIRING_DMARC → WIRING_CNAME → VERIFYING → COMPLETE/FAILED

**TypeScript Patterns:**
- Strict mode, discriminated unions for job types, `export type` for types

**Testing Patterns:**
- Jest with ts-jest + ESM support
- Mock strategy: `global.fetch` for HTTP, `jest.fn()` for Redis
- Test files: adjacent to source in `__tests__/` directories

## Security Considerations

1. **Never persist credentials post-handoff** — Encrypt with AES-256-GCM, deliver once, purge immediately
2. **Audit all OAuth token access** — Log every read/use of GitHub/Cloudflare tokens
3. **Validate all external API responses** — Never trust API data without schema validation
4. **Rate limiting** — ✅ Namecheap API (20 req/min). ✅ Per-user/per-IP sliding window (Redis + Lua scripts)
5. **Stripe webhook verification** — ✅ Signature verification via `stripe.webhooks.constructEvent()`
6. **Authorization (IDOR)** — ✅ Ownership checks on all routes + scope-based auth for API keys
7. **Authentication middleware** — ✅ JWT + API key auth on all protected routes including `/provision`
8. **Server-side pricing validation** — ✅ All Stripe checkout sessions validated
9. **Credential encryption** — ✅ AES-256-GCM for Cloudflare/GitHub tokens with rotation support
10. **Error sanitization** — ✅ API keys sanitized in error messages
11. **API key rotation** — ✅ Atomic revoke-old-create-new pattern for zero-downtime rotation
12. **MCP integration** — ✅ Secure HTTP-based tool definitions for AI coding assistants
13. **Penetration test before public launch** — Credential handoff flow is primary attack surface

## Target Users

1. **Vibe-coders / Solo devs** — Non-traditional devs using AI assistance
2. **Early-stage founders** — Technical co-founders at 0→1 stage
3. **AI coding agents** — Cursor, Claude Code, Windsurf
4. **Serial builders** — Devs starting many projects, agencies, freelancers
5. **Accelerator cohorts** — YC/Techstars batches (white-label opportunity)

## Phase 7: Ship - Next Steps

With Phase 6 complete, the Forj MVP is feature-complete and ready for launch. Phase 7 focuses on polishing, testing, and public launch.

### Pre-Launch Checklist

**1. End-to-End Testing**
- [ ] Test full provisioning flow with real Namecheap account (sandbox → production)
- [ ] Test GitHub OAuth Device Flow with real GitHub App
- [ ] Test Cloudflare zone creation with real API token
- [ ] Test DNS wiring creates all records correctly (MX, SPF, DKIM, DMARC, CNAME)
- [ ] Test Stripe checkout flow with real payment
- [ ] Test API key creation and authentication
- [ ] Test rate limiting thresholds under load
- [ ] Test MCP integration with Claude Code

**2. Security Audit**
- [ ] Review all authentication middleware implementations
- [ ] Review all rate limiting configurations
- [ ] Review all credential encryption/decryption flows
- [ ] Test for common vulnerabilities (OWASP Top 10)
- [ ] Penetration testing on credential handoff flow
- [ ] Review all error messages for information leakage
- [ ] Verify all secrets are in environment variables (not hardcoded)

**3. Landing Page & Marketing**
- [ ] Update forj.sh landing page with demo video
- [ ] Create CLI demo GIF showing full `forj init` flow
- [ ] Write launch blog post explaining value proposition
- [ ] Prepare Show HN post with compelling hook
- [ ] Create Twitter/X launch thread
- [ ] Update README.md with installation instructions

**4. npm Package Publishing**
- [ ] Test CLI installation: `npm install -g forj-cli`
- [ ] Verify global `forj` command works
- [ ] Test `npx forj-cli init` cold start
- [ ] Publish to npm registry
- [ ] Test installation on clean machine (macOS, Linux, Windows)

**5. Documentation**
- [ ] Update API documentation with all endpoints
- [ ] Create troubleshooting guide for common issues
- [ ] Document environment variable requirements
- [ ] Add MCP integration guide to docs
- [ ] Create video walkthrough for first-time users

**6. Monitoring & Observability**
- [ ] Set up error tracking (Sentry or similar)
- [ ] Configure log aggregation (Datadog, Logtail, etc.)
- [ ] Set up uptime monitoring for API
- [ ] Create dashboard for key metrics (provisioning success rate, error rates, etc.)
- [ ] Set up alerts for critical failures

**7. Launch Targets**
- [ ] Deploy to production (Vercel for landing, Railway/Fly.io for API)
- [ ] Publish npm package
- [ ] Post to Show HN
- [ ] Post to Twitter/X
- [ ] Share in relevant Discord/Slack communities (Indie Hackers, etc.)
- [ ] Target: 50 projects provisioned in first week
- [ ] Target: 10 paying customers ($49-199 tiers)

### Post-Launch Iteration

**Week 1-2:**
- Monitor error rates and fix critical bugs
- Tune rate limits based on real usage patterns
- Collect user feedback on UX pain points
- Quick wins: CLI output improvements, better error messages

**Week 3-4:**
- Implement most-requested features
- Optimize provisioning speed (currently 2-5 minutes)
- Add telemetry for usage analytics
- Consider V2 features (Vercel, Railway integrations)

**Month 2:**
- Plan V2 roadmap based on user feedback
- Consider enterprise features (white-label, bulk provisioning)
- Evaluate Google Workspace reseller application timing

## Phase 7: What's Next - Pre-Launch Setup Guide

With Phase 6 complete and all security audit fixes merged, the MVP is feature-complete. Phase 7 focuses on production deployment preparation, monitoring setup, and final validation.

### Agent Environment Setup

AI coding agents (Claude Code, Cursor, Windsurf) can automatically provision the required environment variables and perform necessary setup actions.

**Step 1: Generate Encryption Keys**

```bash
# Generate JWT secret (required)
export JWT_SECRET=$(openssl rand -base64 32)

# Generate Cloudflare encryption key (required for Phase 5+)
export CLOUDFLARE_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Generate GitHub encryption key (required for Phase 5+)
export GITHUB_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Display keys for verification
echo "JWT_SECRET=$JWT_SECRET"
echo "CLOUDFLARE_ENCRYPTION_KEY=$CLOUDFLARE_ENCRYPTION_KEY"
echo "GITHUB_ENCRYPTION_KEY=$GITHUB_ENCRYPTION_KEY"
```

**Step 2: Create .env File**

Agents should create a `.env` file in `packages/api/` with the following structure:

```bash
# Core Configuration
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@host:5432/forj_dev

# Redis (required for queues and rate limiting)
REDIS_URL=redis://localhost:6379

# Authentication (generated above)
JWT_SECRET=<generated-value>
ENABLE_MOCK_AUTH=false  # IMPORTANT: false by default for security

# Namecheap Integration
ENABLE_NAMECHEAP_ROUTES=true
NAMECHEAP_API_USER=your_username
NAMECHEAP_API_KEY=your_api_key
NAMECHEAP_USERNAME=your_username
NAMECHEAP_CLIENT_IP=your_whitelisted_ip
NAMECHEAP_SANDBOX=true  # Use sandbox for development

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SUCCESS_URL=https://forj.sh/success
STRIPE_CANCEL_URL=https://forj.sh/cancel
REQUIRE_PAYMENT=false  # false for development

# Cloudflare Integration
CLOUDFLARE_ENCRYPTION_KEY=<generated-value>

# GitHub OAuth App
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_ENCRYPTION_KEY=<generated-value>

# Proxy Trust Configuration (Production Security)
TRUST_PROXY=false  # false for local dev, true for production behind Cloudflare

# Rate Limiting
RATE_LIMITING_ENABLED=true  # Enable rate limiting (recommended)
```

**Step 3: Run Database Migrations**

```bash
# Navigate to API package
cd packages/api

# Run all pending migrations
npm run db:migrate

# Verify migrations succeeded
npm run db:migrate -- --list
```

**Expected migrations:**
1. `1741570800000_init-projects-table.cjs` - Projects table
2. `1741915200000_create-users-table.cjs` - Users table with encrypted tokens
3. `1773363143000_alter-user-id-to-varchar.cjs` - VARCHAR user IDs
4. `1773411143000_create-api-keys-table.cjs` - API keys table

**Step 4: Verify Setup**

```bash
# Start Redis (if not running)
redis-server

# Start API server
npm run dev -w packages/api

# In another terminal, check health
curl http://localhost:3000/health

# Expected response:
# {"success":true,"data":{"status":"healthy","timestamp":"2026-03-14T..."}}
```

**Step 5: Test Core Functionality**

```bash
# Test mock auth endpoint (development only)
curl -X POST http://localhost:3000/auth/cli \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-device","cliVersion":"0.1.0"}'

# Expected: JWT token or error if ENABLE_MOCK_AUTH=false

# Test rate limiting
for i in {1..5}; do
  curl -i http://localhost:3000/health
done

# Expected: X-IpRateLimit-* headers in response
```

### Phase 7 Pre-Launch Checklist

**1. Database Setup ✅**
- [x] Migrations created (4 migrations)
- [x] Schema validated
- [ ] Production database provisioned (Neon Postgres)
- [ ] Connection pooling configured
- [ ] Backup strategy implemented

**2. Environment Configuration ✅**
- [x] All encryption keys generated
- [x] Example .env file updated
- [ ] Production secrets stored securely (e.g., 1Password, AWS Secrets Manager)
- [ ] Environment variables validated on server startup

**3. Testing & Validation**
- [ ] End-to-end provisioning test (Namecheap sandbox)
- [ ] GitHub OAuth Device Flow test (real GitHub App)
- [ ] Cloudflare zone creation test (real API token)
- [ ] DNS wiring validation (all record types)
- [ ] Stripe checkout flow test (test mode)
- [ ] API key creation and authentication test
- [ ] Rate limiting stress test
- [ ] MCP integration test with Claude Code

**4. Security Hardening**
- [ ] Review all `ENABLE_*` flags for production
- [ ] Verify `TRUST_PROXY=true` for production
- [ ] Validate all encryption keys are 256-bit
- [ ] Test rate limit thresholds under load
- [ ] Penetration testing (focus on credential handoff)
- [ ] Security headers configured (CSP, HSTS, X-Frame-Options)

**5. Monitoring & Observability**
- [ ] Error tracking setup (Sentry)
- [ ] Log aggregation (Datadog, Logtail)
- [ ] Uptime monitoring (BetterUptime, Checkly)
- [ ] Metrics dashboard (Prometheus + Grafana)
- [ ] Alerts configured:
  - [ ] High error rates (> 5% in 5 min)
  - [ ] Failed jobs (> 10 in 1 hour)
  - [ ] Rate limit violations (> 100 in 1 hour)
  - [ ] Database connection pool exhaustion
  - [ ] Redis memory > 80%

**6. Documentation**
- [ ] API documentation (all endpoints)
- [ ] Troubleshooting guide updated
- [ ] Environment variable reference
- [ ] MCP integration examples
- [ ] Video walkthrough for first-time users

**7. Deployment**
- [ ] Production deployment to Railway/Fly.io
- [ ] Workers deployed and scaled (min 2 instances each)
- [ ] Redis configured with persistence
- [ ] Database backups automated (daily)
- [ ] SSL certificates configured
- [ ] Domain DNS configured (forj.sh → API)
- [ ] Landing page deployed (Vercel)

**8. Launch Preparation**
- [ ] npm package published (`forj-cli`)
- [ ] CLI demo GIF created
- [ ] Show HN post drafted
- [ ] Twitter/X launch thread prepared
- [ ] 10 beta testers lined up for launch day
- [ ] Support email configured (support@forj.sh)

### Common Agent Tasks for Phase 7

**Generate All Required Keys (One Command)**
```bash
cat > .env.generated <<EOF
JWT_SECRET=$(openssl rand -base64 32)
CLOUDFLARE_ENCRYPTION_KEY=$(openssl rand -base64 32)
GITHUB_ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF

cat .env.generated
```

**Validate Environment Configuration**
```bash
# Create validation script
cat > validate-env.sh <<'EOF'
#!/bin/bash
set -e

echo "Validating environment variables..."

# Check required keys
for var in JWT_SECRET CLOUDFLARE_ENCRYPTION_KEY GITHUB_ENCRYPTION_KEY; do
  if [ -z "${!var}" ]; then
    echo "❌ $var is not set"
    exit 1
  fi

  # Validate base64 format and length
  decoded=$(echo "${!var}" | base64 -d 2>/dev/null | wc -c)
  if [ "$decoded" -ne 32 ]; then
    echo "❌ $var is not a valid 32-byte base64 key (got $decoded bytes)"
    exit 1
  fi

  echo "✅ $var is valid (32 bytes)"
done

echo "All encryption keys validated!"
EOF

chmod +x validate-env.sh
./validate-env.sh
```

**Quick Health Check Script**
```bash
# Create comprehensive health check
cat > health-check.sh <<'EOF'
#!/bin/bash

API_URL="${API_URL:-http://localhost:3000}"

echo "=== Forj API Health Check ==="
echo "API URL: $API_URL"
echo ""

# Check API health
echo "1. API Health..."
curl -s "$API_URL/health" | jq '.'

# Check queue status
echo -e "\n2. Queue Status..."
curl -s "$API_URL/queues" | jq '.'

# Check rate limiting headers
echo -e "\n3. Rate Limiting..."
curl -sI "$API_URL/health" | grep -i "ratelimit"

echo -e "\n✅ Health check complete!"
EOF

chmod +x health-check.sh
./health-check.sh
```

### Next Steps After Documentation Update

1. **Merge all documentation updates** to main branch
2. **Run end-to-end tests** with real services (Namecheap sandbox, GitHub, Cloudflare)
3. **Set up production monitoring** (start with free tiers: Sentry, BetterUptime)
4. **Deploy to staging environment** (Railway free tier)
5. **Conduct load testing** to tune rate limits
6. **Schedule penetration testing** (optional but recommended)
7. **Prepare npm publish** workflow
8. **Launch! 🚀**

## References

- Full specification: `project-docs/forj-spec.md`
- Build plan: `project-docs/build-plan.md`
- Testing guide: `project-docs/testing-guide.md`
- Troubleshooting: `project-docs/troubleshooting.md`
- MCP integration: `docs/MCP_INTEGRATION.md`
- Security review: `SECURITY-REVIEW.md`
