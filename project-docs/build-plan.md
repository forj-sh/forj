# Forj Build Plan

Last updated: 2026-03-13 (Phase 5 in progress - Layer 3 tested)

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

### Phase 4: Integration + Security ✅ COMPLETE (Stacks 1-11, PRs #31-#41)

- Redis pub/sub infrastructure for worker event emission (Stack 1)
- Worker event emission via Redis pub/sub (Stack 2)
- Real SSE streaming from Redis worker events (Stack 3)
- Mount Namecheap domain routes in server (Stack 4)
- End-to-end integration test for Redis pub/sub streaming (Stack 5)
- JWT authentication middleware with HS256 (Stack 6)
- Authorization checks — IDOR vulnerability fixed with ownership checks (Stack 7)
- Stripe SDK installed + client wrapper (Stack 8)
- Stripe webhook signature verification via `stripe.webhooks.constructEvent()` (Stack 9)
- Stripe checkout routes + payment flow integration (Stack 10)
- Server-side pricing validation prevents price manipulation (Stack 11)
- `ENABLE_NAMECHEAP_ROUTES=true` flag controls production vs mock route mounting
- Verified with live Namecheap sandbox API calls

### Phase 5: GitHub + Cloudflare + DNS Wiring ⚠️ IN PROGRESS (Layer 2 Complete, Layer 3 Tested)

**Architecture: Cloudflare as DNS authority.** Namecheap is the registrar only. After domain registration, nameservers are updated to point to Cloudflare. All DNS record management (MX, SPF, DKIM, DMARC, CNAME) happens via Cloudflare's API.

**Auth approach:**
- **GitHub**: OAuth Device Flow (RFC 8628) — user gets a one-time code, enters it at `github.com/login/device`, approves the Forj GitHub App. CLI polls until token received. Same pattern as `gh auth login`. Requires creating a GitHub OAuth App with `admin:org` and `repo` scopes.
- **Cloudflare**: Guided API token creation — CLI opens Cloudflare dashboard with pre-selected permissions (`Zone:Edit`, `DNS:Edit`), user creates token, pastes back into CLI. Forj verifies token by calling `/zones`. Cloudflare does not support standard OAuth2 for third-party zone management.

**Provisioning flow (orchestration order):**
```
1. Domain registered via Namecheap          ← already working (Phase 3-4)
2. GitHub org verified + repos created      ← can run in parallel with step 3
3. Cloudflare zone created                  ← returns nameserver pair
4. Nameservers updated on Namecheap         ← uses setCustomNameservers (already implemented)
5. DNS records wired via Cloudflare API     ← MX, SPF, DKIM, DMARC, CNAME
```
Steps 2 and 3 are independent and can run in parallel. Step 4 depends on step 3 (needs Cloudflare NS). Step 5 depends on step 3 (needs zone ID).

**📊 Progress Summary:** 6/12 stacks complete (50%), Layer 3 worker pipeline tested and working

**Next Steps:**
1. Instantiate GitHub, Cloudflare, and DNS workers in `start-workers.ts`
2. Fix user ID schema mismatch (JWT VARCHAR → projects.user_id UUID)
3. Wire up full orchestrator in `/provision` endpoint
4. End-to-end test with real GitHub repo + Cloudflare zone creation
5. Update CLI `init` command for Cloudflare + GitHub auth flows

---

**Implementation Status (March 13, 2026):**

**✅ COMPLETED:**
- **Layer 1 (Integration Tests):** All unit tests passing (67/67 tests across 5 suites)
- **Layer 2 (Auth Flows):**
  - ✅ Cloudflare token verification working (accountId: `026792bce13130a079e92f03df760b10`)
  - ✅ GitHub Device Flow complete (user: `pcdkd`, token stored encrypted)
  - ✅ Both tokens stored with AES-256-GCM encryption in `users` table
- **Layer 3 (Worker Pipeline):**
  - ✅ Domain worker running and processing jobs via BullMQ
  - ✅ SSE streaming working (Redis pub/sub → SSE endpoint)
  - ✅ Namecheap API integration verified (sandbox mode)
  - ✅ Worker event publisher configured and emitting events
  - ✅ Job retry logic working (3 attempts with exponential backoff)
  - ✅ `/provision` routes mounted but orchestrator not yet fully wired

**⚠️ KNOWN ISSUES:**
- **User ID schema mismatch:** JWT generates VARCHAR user IDs (e.g., `mock-user-mmo5tmx8nj6marfj9nc`) but `projects` table expects UUID. Authorization check temporarily bypassed for testing.
- **Namecheap sandbox limitations:** Most domains return as "unavailable" in sandbox mode even when actually available. This is expected sandbox behavior and not a bug.
- **Missing workers:** GitHub, Cloudflare, and DNS workers are scaffolded but not instantiated in `start-workers.ts`
- **Provisioning orchestrator:** `/provision` endpoint exists but full orchestration (domain → github ∥ cloudflare → ns → dns) not yet complete

**🔲 OUTSTANDING WORK:**

**Stack plan (estimated 10-12 stacks):**

**Stack 1: Cloudflare API client + types** ✅ DONE (implemented)
- Cloudflare REST API v4 client (`packages/shared/src/cloudflare/client.ts`)
- Methods: `createZone`, `listZones`, `getZoneDetails`, `createDNSRecord`, `listDNSRecords`, `updateDNSRecord`, `deleteDNSRecord`
- Types: `CloudflareZone`, `DNSRecord`, `CloudflareConfig`, `CloudflareError`
- Error handling + retryability categorization (like Namecheap errors)
- Auth via API token in `Authorization: Bearer <token>` header

**Stack 2: Cloudflare token verification + storage** ✅ DONE (tested March 13)
- `verifyToken()` — calls `/user/tokens/verify` to validate user's API token
- `getAccountZones()` — fetch zones accessible with the token
- Encrypted token storage in database (per-user, AES-256-GCM)
- API route: `POST /auth/cloudflare` — accepts token, verifies, stores
- **Verified working:** accountId `026792bce13130a079e92f03df760b10` stored successfully

**Stack 3: Cloudflare zone creation + nameserver handoff** 🔲 TODO
- Cloudflare worker exists but NOT instantiated in `start-workers.ts`
- Needs: `CloudflareWorker` config in startup script (similar to DomainWorker)
- Extracts nameserver pair from zone creation response
- Calls existing Namecheap `setCustomNameservers()` to update NS records
- State machine integration: `cloudflare` service status tracking in project JSONB
- BullMQ job: `CLOUDFLARE_CREATE_ZONE` with retry semantics

**Stack 4: GitHub OAuth Device Flow** ✅ DONE (tested March 13)
- Implemented RFC 8628 Device Authorization Grant
- API routes: `POST /auth/github/device` (initiate), `POST /auth/github/poll` (poll for token)
- CLI integration: display user code + verification URL, poll until authorized
- Store GitHub OAuth token encrypted per-user
- **Verified working:** User `pcdkd` authorized, token stored encrypted

**Stack 5: GitHub API client + types** ✅ DONE (implemented)
- GitHub REST API client (`packages/shared/src/github/client.ts`) using fetch
- Methods: `verifyOrg`, `createRepo`, `setBranchProtection`, `createDefaultFiles`, `configurePages`
- Types: `GitHubOrg`, `GitHubRepo`, `GitHubConfig`
- Auth via OAuth token in `Authorization: Bearer <token>` header

**Stack 6: GitHub worker — org verification + repo creation** 🔲 TODO
- GitHub worker exists but NOT instantiated in `start-workers.ts`
- Needs: `GitHubWorker` config in startup script
- BullMQ job: `GITHUB_CREATE_REPOS` with state machine integration
- State machine: `github` service status tracking in project JSONB

**Stack 7: DNS wiring worker — record creation** 🔲 TODO
- DNS worker exists but NOT instantiated in `start-workers.ts`
- Needs: `DNSWorker` config in startup script
- Records: MX, SPF, DKIM, DMARC, CNAME via Cloudflare API
- BullMQ job: `DNS_WIRE_RECORDS` — depends on Cloudflare zone being active

**Stack 8: DNS health checker + auto-repair** 🔲 TODO
- `dns.resolve()` validation for each record type
- API routes: `GET /projects/:id/dns/health`, `POST /projects/:id/dns/fix`
- Powers existing CLI commands `forj dns check` and `forj dns fix`

**Stack 9: Guided Cloudflare token flow in CLI** 🔲 TODO
- CLI `login` command updated: prompts for Cloudflare token creation
- Opens browser to Cloudflare dashboard with pre-selected permission template

**Stack 10: Provisioning orchestrator — parallel execution** 🔲 TODO
- Orchestrator exists (`packages/api/src/lib/orchestrator.ts`) but not fully wired
- `/provision` endpoint mounted but needs worker coordination
- Dependency graph: domain → (github ∥ cloudflare) → nameserver update → DNS wiring
- SSE events emitted at each stage for CLI streaming

**Stack 11: CLI integration + end-to-end testing** 🔲 TODO
- CLI `init` command updated for Cloudflare + GitHub auth steps
- Non-interactive mode: `--cloudflare-token` and `--github-token` flags for agents
- Integration tests: full provisioning flow with mock APIs

**Stack 12: Documentation + credential management cleanup** 🔲 TODO
- Update CLAUDE.md with Phase 5 completion
- Update `.env.example` with new variables
- Credential rotation documentation
- **Fix user ID schema mismatch** (JWT VARCHAR vs projects.user_id UUID)

### Phase 6: Auth + Credential Security 🔲 PLANNED

- API key generation for agent tier (long-lived, scoped: `agent:provision`, `agent:read`)
- MCP tool definition for agent discoverability
- Per-user/per-IP rate limiting on API routes
- Credential rotation support

### Phase 7: Ship

- Landing page update + CLI demo GIF
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

### Core (Phases 1-4) ✅

| Variable | Description | Required for |
|----------|-------------|--------------|
| `DATABASE_URL` | Neon Postgres connection string | All environments |
| `REDIS_URL` | Redis connection string | All environments |
| `JWT_SECRET` | Secret for JWT signing (HS256) | All environments |
| `NAMECHEAP_API_USER` | Namecheap username | All environments |
| `NAMECHEAP_API_KEY` | API key (Profile → Tools → API Access) | All environments |
| `NAMECHEAP_USERNAME` | Namecheap username (may differ from API user) | All environments |
| `NAMECHEAP_CLIENT_IP` | Whitelisted IP (must match Namecheap dashboard) | All environments |
| `NAMECHEAP_SANDBOX` | Set `true` for sandbox.namecheap.com | Development |
| `ENABLE_NAMECHEAP_ROUTES` | Set `true` to mount production Namecheap routes | All environments |
| `STRIPE_SECRET_KEY` | Stripe dashboard secret key | All environments |
| `STRIPE_WEBHOOK_SECRET` | Generated when creating webhook endpoint | Production |
| `STRIPE_PUBLISHABLE_KEY` | Client-side checkout session creation | All environments |

### Phase 5 (New)

| Variable | Description | How to get |
|----------|-------------|------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | Create OAuth App at github.com/organizations/forj-sh/settings/applications |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App secret | Same as above |
| `CLOUDFLARE_ENCRYPTION_KEY` | Key for encrypting stored Cloudflare API tokens | `openssl rand -base64 32` |

Note: No Cloudflare OAuth client ID/secret needed — users provide their own API token via guided creation flow.

---

## Security Status

### Fixed (Phase 4) ✅

| Item | Status |
|------|--------|
| JWT authentication on all domain routes | ✅ Fixed (Stack 6) |
| IDOR on `/domains/jobs/:jobId` | ✅ Fixed (Stack 7) |
| Stripe webhook signature verification | ✅ Fixed (Stack 9) |
| Server-side pricing validation | ✅ Fixed (Stack 11) |

### Remaining

| Gap | Severity | Phase |
|-----|----------|-------|
| Per-user/per-IP rate limiting on API routes | MEDIUM | Phase 6 |
| Credential encryption at rest (Cloudflare/GitHub tokens) | ✅ Fixed | Phase 5 (Stack 2) |
| Credential rotation support | MEDIUM | Phase 6 |

---

## Key Architecture Decisions

### Cloudflare as DNS Authority (Phase 5)

**Decision:** Namecheap is registrar only. Cloudflare manages all DNS.

**Rationale:**
- Cloudflare provides proxy/CDN, DDoS protection, fast propagation, and a clean API
- Namecheap's DNS management is basic by comparison
- Single API for all record management (MX, SPF, DKIM, DMARC, CNAME)
- Industry standard setup for production infrastructure

**Flow:** Register domain (Namecheap) → Create zone (Cloudflare) → Update nameservers (Namecheap → Cloudflare NS) → Wire DNS records (Cloudflare API)

### Cloudflare Auth: Guided Token vs OAuth (Phase 5)

**Decision:** Guided API token creation (not OAuth).

**Rationale:**
- Cloudflare does not support standard OAuth2 for third-party zone management
- Guided token creation is the pattern used by Vercel, Netlify, and other tools that integrate with Cloudflare
- Lower implementation complexity than building a custom OAuth intermediary via Cloudflare Workers
- User retains full control — can revoke token anytime from Cloudflare dashboard

### GitHub Auth: Device Flow (Phase 5)

**Decision:** OAuth Device Flow (RFC 8628).

**Rationale:**
- Designed for CLI tools (no local web server needed)
- Works in headless/remote environments (SSH sessions, cloud IDEs)
- Same pattern as `gh auth login` — familiar to developers
- One-time code displayed in terminal, user approves in browser

See `project-docs/forj-spec.md` for original product specification.
