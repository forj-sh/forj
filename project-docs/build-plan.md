# Forj Build Plan

Last updated: 2026-03-10

## V1 — MVP (Core Infrastructure)

### Phase 1: CLI Client ✅ COMPLETE

- All 6 commands implemented: `init`, `status`, `add`, `dns` (check/fix), `login`, `logout`
- Interactive mode with guided GitHub org step + SSE stream rendering
- Non-interactive mode: `--non-interactive`, `--json`, `--github-org` flags for AI agents
- API client (`lib/api-client.ts`) with Bearer token auth
- SSE client (`lib/sse-client.ts`) for real-time provisioning progress
- Config management (`~/.forj/config.json`), project state (`.forj/config.json`)
- Credential handoff: `.forj/credentials.json` generation + `.gitignore` injection
- Build: tsup (ESM, Node 18+), bin entry `forj` → `dist/cli.js`

### Phase 2: API Server Scaffold ✅ COMPLETE (Stacks 1-7, PRs #12-#18)

- Fastify server with TypeScript + Pino structured logging
- Neon Postgres (serverless) with connection pooling
- BullMQ + Redis job queue infrastructure (5 queues: DOMAIN_CHECK, PROJECT_INIT, SERVICE_PROVISION, DNS_CHECK, DNS_FIX)
- SSE streaming endpoint for real-time CLI updates
- Project management routes (CRUD + status)
- Mock auth + domain routes (replaced by real implementation in Phase 3)
- Shared types foundation (`@forj/shared`)

### Phase 3: Namecheap Domain Integration ✅ COMPLETE (Stacks 1-12, PRs #19-#30)

- Full Namecheap API client: `checkDomains`, `getTldPricing`, `createDomain`, `setCustomNameservers`, `getDomainInfo`, `renewDomain`, `listDomains`, `getBalances`
- Custom XML parser using `fast-xml-parser` for Namecheap's attribute-based responses
- Redis-backed sliding window rate limiter (Lua script, atomic operations, 20 req/min limit)
- 3-tier priority queue with fairness: CRITICAL (registrations) > INTERACTIVE (availability checks) > BACKGROUND (pricing/monitoring)
- Error categorization: 50+ Namecheap error codes mapped to 6 categories (AUTH, VALIDATION, PAYMENT, AVAILABILITY, PROVIDER, UNKNOWN) with retryability flags and user-facing messages
- Domain worker state machine: PENDING → QUEUED → CHECKING → AVAILABLE → REGISTERING → CONFIGURING → COMPLETE (with FAILED → RETRYING branches)
- BullMQ job handlers for 5 operation types: CHECK, REGISTER, RENEW, SET_NAMESERVERS, GET_INFO
- Contact info flattening + phone number formatting via `libphonenumber-js`
- Pricing cache with Redis-backed 1-hour TTL + warmup for common TLDs
- Stripe webhook routes (checkout.session.completed, payment_intent.succeeded/failed, charge.refunded)
- Stripe pricing calculation (wholesale + ICANN fee + service fee)
- Unit tests for state machine, XML parser, rate limiter, queue, error categorization

### Phase 4: Integration + Security 🔲 NOT STARTED

**Recommended approach: do "Phase 4 lite" first to get one vertical slice working end-to-end (CLI → API → domain worker → SSE → CLI), then build remaining workers on a proven foundation.**

Phase 4 lite (do first):
- Register domain routes in `server.ts` (routes are defined but not mounted)
- Basic auth middleware (API key validation — full OAuth can wait for Phase 5)
- Redis pub/sub for worker → SSE event streaming (worker currently logs to console)
- End-to-end test: `forj init` → domain check → mock payment → registration → SSE progress

Full Phase 4 (before production):
- JWT authentication middleware
- Authorization checks on domain routes (prevent IDOR on `/domains/jobs/:jobId`)
- Stripe webhook signature verification (currently parses body without verifying — **critical security gap**)
- Install `stripe` npm package (not yet in dependencies)
- Payment verification flow: Stripe checkout → verify payment → trigger registration

### Phase 5: GitHub + Cloudflare Workers 🔲 NOT STARTED

- GitHub worker: verify org exists via API → repo creation + branch protection + `.github` defaults
- GitHub OAuth flow (`admin:org` scope) — wired through `/auth/cli` endpoint
- Cloudflare worker: user OAuth → zone creation + DNS record management
- Cloudflare OAuth flow for zone management access

Note: GitHub OAuth is needed for both user authentication and the GitHub worker, so auth gets built alongside this phase rather than as a separate step.

### Phase 6: DNS Wiring Worker 🔲 NOT STARTED

- Auto-configure MX, SPF, DKIM, DMARC, CNAME after all services complete
- DNS health checker: validate records via `dns.resolve()`
- Powers `forj dns check` and `forj dns fix` CLI commands
- Depends on: Cloudflare worker (needs a zone to write records into)

### Phase 7: Auth + Credential Security 🔲 NOT STARTED

- API key generation for agent tier (long-lived, scoped: `agent:provision`, `agent:read`)
- AES-256-GCM credential encryption on server
- One-time credential delivery + server-side purge
- MCP tool definition for agent discoverability

### Phase 8: Ship

- Landing page + CLI demo GIF
- `npm publish forj-cli` to registry
- Show HN post + dev Twitter launch
- End-to-end testing: `forj init` → domain check → provisioning → credentials
- 50 projects provisioned target

---

## V2 — Deployment Platforms (Post-Validation)

- Vercel worker: create project, link repo, set custom domain
- Railway worker: create project, link repo, optional Postgres
- DNS wiring updates: auto-add Vercel/Railway CNAMEs
- `forj add vercel` / `forj add railway` commands

## V3 — Enterprise & Recurring Revenue (Post-Scale)

- Google Workspace reseller application (start at launch, not before)
- Google Workspace worker: provision org, users, billing via Reseller API
- AWS enterprise tier: cross-account IAM for teams that outgrew Vercel/Railway

---

## Environment Variables Required

### Namecheap Reseller API

| Variable | Description | Required for |
|----------|-------------|--------------|
| `NAMECHEAP_API_USER` | Namecheap username | All environments |
| `NAMECHEAP_API_KEY` | API key (Profile → Tools → API Access) | All environments |
| `NAMECHEAP_CLIENT_IP` | Whitelisted server IP | Production |
| `NAMECHEAP_SANDBOX` | Set `true` for sandbox.namecheap.com | Development |

Reseller activation: $50 deposit OR 20+ domains. Sandbox account is free at sandbox.namecheap.com.

### Stripe

| Variable | Description | Required for |
|----------|-------------|--------------|
| `STRIPE_SECRET_KEY` | Stripe dashboard secret key | All environments |
| `STRIPE_WEBHOOK_SECRET` | Generated when creating webhook endpoint | Production |
| `STRIPE_PUBLISHABLE_KEY` | Client-side checkout session creation | All environments |

### Infrastructure

| Variable | Description | Required for |
|----------|-------------|--------------|
| `REDIS_URL` | Redis connection string | All environments |
| `DATABASE_URL` | Neon Postgres connection string | All environments |

### Future (Phases 5+)

| Variable | Description | Phase |
|----------|-------------|-------|
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID | Phase 5 |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app secret | Phase 5 |
| `CLOUDFLARE_CLIENT_ID` | Cloudflare OAuth app client ID | Phase 5 |
| `CLOUDFLARE_CLIENT_SECRET` | Cloudflare OAuth app secret | Phase 5 |

---

## Security Gaps (Must Fix Before Production)

| Gap | Severity | Location | Fix |
|-----|----------|----------|-----|
| Stripe webhook signature verification | CRITICAL | `packages/api/src/routes/stripe-webhooks.ts` | Implement `stripe.webhooks.constructEvent()` with raw body |
| IDOR on `/domains/jobs/:jobId` | CRITICAL | `packages/api/src/routes/domains-namecheap.ts` | Add `WHERE user_id = request.user.id` ownership check |
| Missing auth middleware on domain routes | CRITICAL | `packages/api/src/routes/domains-namecheap.ts` | Add JWT/API key verification to all domain routes |

See `project-docs/forj-spec.md` Section 8 for original milestone checklists.
