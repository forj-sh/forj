# Forj Build Plan

Last updated: 2026-03-13 (Phase 6 complete - all stacks merged)

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

### Phase 5: GitHub + Cloudflare + DNS Wiring ✅ COMPLETE (Stacks 1-9, PRs #42-#53 + #54-#62)

**Architecture: Cloudflare as DNS authority.** Namecheap is the registrar only. After domain registration, nameservers are updated to point to Cloudflare. All DNS record management (MX, SPF, DKIM, DMARC, CNAME) happens via Cloudflare's API.

**Auth approach:**
- **GitHub**: OAuth Device Flow (RFC 8628) — user gets a one-time code, enters it at `github.com/login/device`, approves the Forj GitHub App. CLI polls until token received. Same pattern as `gh auth login`.
- **Cloudflare**: Guided API token creation — CLI opens Cloudflare dashboard with pre-selected permissions (`Zone:Edit`, `DNS:Edit`), user creates token, pastes back into CLI. Forj verifies token by calling `/zones`.

**Provisioning flow (orchestration order):**
```
1. Domain registered via Namecheap          ← Phase 3-4
2. GitHub org verified + repos created      ← Parallel with step 3
3. Cloudflare zone created                  ← Returns nameserver pair
4. Nameservers updated on Namecheap         ← Uses setCustomNameservers
5. DNS records wired via Cloudflare API     ← MX, SPF, DKIM, DMARC, CNAME
```

**Implementation (9 stacks, March 12-13, 2026):**

**Stack 1: Fix user ID schema mismatch (PR #54)**
- Migration: projects.user_id UUID → VARCHAR(255)
- Aligns with JWT token generation format
- Unit tests for VARCHAR user ID compatibility

**Stack 2: Cloudflare worker instantiation (PR #55)**
- CloudflareWorker configured in `start-workers.ts`
- Event publisher setup for SSE streaming
- Promise.allSettled shutdown pattern

**Stack 3: Cloudflare zone creation + NS handoff (PR #56)**
- Zone creation via Cloudflare API
- Auto-queue nameserver update jobs
- Idempotent zone handling (existing zones)
- Queue instance optimization (created once, reused)

**Stack 4: DNS worker instantiation (PR #57)**
- DNSWorker configured in `start-workers.ts`
- Factory function for event publishers (reduces duplication)
- Type-safe event publishing

**Stack 5: DNS wiring validation + documentation (PR #58)**
- DNS wiring implementation validation doc
- MX, SPF, DKIM, DMARC, CNAME record support
- Worker state machine documentation

**Stack 6: GitHub worker instantiation (PR #59)**
- GitHubWorker configured in `start-workers.ts`
- Event publisher using factory pattern
- Type-safe event handling

**Stack 7: Provisioning orchestrator updates (PR #60)**
- Added cloudflareAccountId to ProvisioningConfig
- Fixed DNS job data field names (cloudflareApiToken)
- Orchestration validation documentation

**Stack 8: Provision route validation (PR #61)**
- cloudflareAccountId validation in /provision endpoint
- Server-side validation before job queueing

**Stack 9: End-to-end integration test (PR #62)**
- Full provisioning pipeline integration test
- Job queueing verification
- Event publishing validation
- Try/finally cleanup pattern

### Phase 6: Auth + Credential Security + Security Audit Fixes ✅ COMPLETE (Stacks 1-10 + Audit Fixes, PRs #63-#72 + #82-#88)

**Stack 1: API key data model + generation service (PR #63)**
- Database schema for API keys (id, user_id, key_hash, key_hint, scopes, environment)
- API key generation with HMAC-SHA256 hashing
- Scope-based authorization (`agent:provision`, `agent:read`)
- Live vs test environment separation
- Unit tests for key generation and validation

**Stack 2: API key authentication middleware (PR #64)**
- `requireApiKey` middleware with scope validation
- Bearer token extraction and verification
- Integration with existing `requireAuth` JWT middleware
- Scope enforcement on protected routes

**Stack 3: API key management routes (PR #65)**
- POST /api-keys — Create new API key with scopes
- GET /api-keys — List user's API keys
- DELETE /api-keys/:id — Revoke API key
- Response envelopes with proper error handling
- Integration tests for all CRUD operations

**Stack 4: Add auth middleware to /provision route (PR #66)**
- Protected /provision endpoint with `requireApiKey(['agent:provision'])`
- Prevents unauthorized infrastructure provisioning
- Validated with integration tests

**Stack 5: Per-user rate limiting infrastructure (PR #67)**
- Redis-backed sliding window rate limiter (Lua script)
- Per-user limits extracted from JWT/API key
- Configurable limits per route (10-100 req/hour)
- Rate limit headers: `X-UserRateLimit-Limit`, `X-UserRateLimit-Remaining`, `X-UserRateLimit-Reset`
- Unit tests for sliding window algorithm

**Stack 6: Per-IP rate limiting infrastructure (PR #68)**
- Redis-backed IP rate limiter with separate namespace
- Per-IP limits for DDoS protection
- Configurable limits per route (5-60 req/hour)
- Rate limit headers: `X-IpRateLimit-Limit`, `X-IpRateLimit-Remaining`, `X-IpRateLimit-Reset`
- Unit tests for IP-based limiting

**Stack 7: Apply rate limiting to all routes (PR #69)**
- Applied both user + IP rate limiting to all protected routes
- Auth routes: 20/hour (user) + 10/hour (IP)
- Domain routes: 50/hour (user) + 30/hour (IP)
- API key routes: 20/hour (user) + 10/hour (IP)
- Project routes: 30/hour (user) + 50/hour (IP)
- Provision route: 10/hour (user) + 5/hour (IP)
- Header namespacing prevents clobbering

**Stack 8: API key rotation endpoint (PR #70)**
- POST /api-keys/:id/rotate — Atomic key rotation
- Revoke old key + create new key with same scopes
- Environment inference from key_hint
- Custom error classes for type-safe error handling
- Zero-downtime rotation workflow

**Stack 9: Credential rotation for OAuth tokens (PR #71)**
- `reencrypt()` utility for rotating master encryption key
- Support for rotating Cloudflare/GitHub encrypted tokens
- Documentation for rotation workflow
- Unit tests for re-encryption with new keys
- TODOs added for separate encryption keys per service

**Stack 10: MCP tool definition + integration documentation (PR #72)**
- `.mcp.json` with 10 MCP tool definitions
- Tools: provision_infrastructure, check_domain_availability, create_api_key, list_api_keys, rotate_api_key, revoke_api_key, initialize_project, get_project_status, check_dns_health, fix_dns_issues
- Comprehensive `docs/MCP_INTEGRATION.md` guide
- JSON Schema validation for all tool parameters
- Security considerations for credential handling in AI contexts

**Security Audit Fixes (March 13-14, 2026)**

**PR #82 (Stack 1): Remove mock authentication endpoint and add environment flag**
- Added `ENABLE_MOCK_AUTH` environment variable (defaults to `false`)
- Conditional route registration: `/auth/cli` only enabled when `!isProduction && mockAuthEnabled`
- Changed `.env.example` default to `ENABLE_MOCK_AUTH=false` (secure by default)
- Rewrote auth tests using `server.inject()` for hermetic testing
- **Fixes**: CRITICAL-01 - Mock authentication endpoint exposed in production

**PR #83 (Stack 2): Restore domain registration authorization and payment verification**
- Created `ProjectWithPayment` type with camelCase properties
- Combined 2 database queries into 1 (ownership + payment check)
- Unified 403/404 error responses to prevent information leakage
- 50% reduction in database round-trips
- **Fixes**: MEDIUM-01 - Database query redundancy and information leakage

**PR #84 (Stack 3): Add authentication and authorization to SSE stream endpoint**
- Added `requireAuth` middleware to `/events/stream/:projectId`
- Added `verifyProjectOwnership` authorization check
- Comprehensive RELIABILITY TRADE-OFFS documentation section
- Documented fail-open behavior for rate limiter and authorization
- **Fixes**: MEDIUM-02 - Missing SSE stream authentication

**PR #85 (Stack 4): Remove plaintext credentials from job queue**
- Removed `accessToken` from GitHub job data structures
- Removed `apiToken` from Cloudflare job data structures
- Updated orchestrator to not pass credentials in job payloads
- Extracted magic numbers to named constants (`ONE_DAY_IN_SECONDS`, `SEVEN_DAYS_IN_SECONDS`)
- Updated function docstrings to document BREAKING CHANGE
- **Fixes**: MEDIUM-03 - Plaintext credentials in job queue

**PR #86 (Stack 5): Implement atomic API key rotation with database transactions**
- Fixed 5 critical bugs in `rotateApiKey()` implementation:
  1. Wrong method names (`generateApiKey()` → `generateKey()`, `hashApiKey()` → `hashKey()`)
  2. Incorrect `keyHint` calculation (was including prefix)
  3. Double-encoding scopes with `JSON.stringify()`
  4. Return object mismatch with `RotateApiKeyResult` interface
  5. Rollback error handling could mask original errors
- All bugs would have caused runtime failures
- **Fixes**: MEDIUM-04 - API key rotation implementation bugs

**PR #87 (Stack 6): Fix IP rate limiting to respect proxy trust configuration**
- Gate `cf-connecting-ip` header trust on `request.ips` (only populated when `trustProxy` enabled)
- Prevents header spoofing when `TRUST_PROXY=false`
- Updated documentation to clarify proxy header trust behavior
- **Fixes**: HIGH-02 - IP spoofing via forged proxy headers

**PR #88 (Stack 7): Implement service-specific encryption keys for credential isolation**
- Added `isValidEncryptionKey()` validation to `getGitHubToken()` for consistency
- Replaced deterministic example keys with obviously invalid placeholders (`REPLACE_ME_openssl_rand_base64_32`)
- Prevents accidental production use of example encryption keys
- **Fixes**: LOW-01 (insecure example keys), LOW-02 (missing validation)

**Audit Summary**:
- Total vulnerabilities fixed: 8 (1 CRITICAL, 2 HIGH, 4 MEDIUM, 2 LOW)
- Lines changed: ~500 across 15 files
- Review method: Automated AI code review (Gemini Code Assist + GitHub Copilot) + manual verification

### Phase 7: Ship

**Monitoring & Observability** ✅ STARTED (March 14, 2026)
- ✅ Sentry error tracking configured (API, Workers, CLI)
- ✅ Privacy-first data scrubbing implemented
- ✅ CLI opt-in telemetry with user consent (`forj telemetry enable`)
- ✅ Debug endpoints for testing (`/debug-sentry`)
- [ ] Sentry alerts configured (high error rates, failed jobs, rate limit violations)
- [ ] Uptime monitoring (BetterUptime, Checkly)
- [ ] Log aggregation (Datadog, Logtail)

**Pre-Launch Validation**
- [ ] End-to-end testing: `forj init` → domain check → provisioning → credentials
- [ ] GitHub OAuth Device Flow test (real GitHub App)
- [ ] Cloudflare zone creation + DNS wiring test
- [ ] API key authentication and rate limiting stress test
- [ ] Penetration testing (focus on credential handoff flow)

**Launch Preparation**
- [ ] Landing page update + CLI demo GIF
- [ ] `npm publish forj-cli` to registry
- [ ] Show HN post + dev Twitter launch
- [ ] 50 projects provisioned target

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

### Fixed (Phases 4-6) ✅

| Item | Status |
|------|--------|
| JWT authentication on all domain routes | ✅ Fixed (Phase 4, Stack 6) |
| IDOR on `/domains/jobs/:jobId` | ✅ Fixed (Phase 4, Stack 7) |
| Stripe webhook signature verification | ✅ Fixed (Phase 4, Stack 9) |
| Server-side pricing validation | ✅ Fixed (Phase 4, Stack 11) |
| Credential encryption at rest (Cloudflare/GitHub tokens) | ✅ Fixed (Phase 5, Stack 2) |
| API key authentication for agent tier | ✅ Fixed (Phase 6, Stacks 1-3) |
| `/provision` route authentication | ✅ Fixed (Phase 6, Stack 4) |
| Per-user rate limiting on API routes | ✅ Fixed (Phase 6, Stacks 5 & 7) |
| Per-IP rate limiting on API routes | ✅ Fixed (Phase 6, Stacks 6 & 7) |
| API key rotation support | ✅ Fixed (Phase 6, Stack 8) |
| Credential rotation support (OAuth tokens) | ✅ Fixed (Phase 6, Stack 9) |
| **Mock authentication endpoint exposed** | ✅ Fixed (Phase 6 Audit, PR #82) |
| **Database query optimization and info leakage** | ✅ Fixed (Phase 6 Audit, PR #83) |
| **SSE stream authentication** | ✅ Fixed (Phase 6 Audit, PR #84) |
| **Plaintext credentials in Redis job queue** | ✅ Fixed (Phase 6 Audit, PR #85) |
| **API key rotation implementation bugs** | ✅ Fixed (Phase 6 Audit, PR #86) |
| **IP spoofing via forged proxy headers** | ✅ Fixed (Phase 6 Audit, PR #87) |
| **Insecure example encryption keys** | ✅ Fixed (Phase 6 Audit, PR #88) |

### Remaining (Pre-Launch)

| Gap | Severity | Phase |
|-----|----------|-------|
| Penetration testing | HIGH | Phase 7 |
| Production monitoring and alerting setup | HIGH | Phase 7 |
| Rate limit tuning based on real usage | MEDIUM | Post-launch |
| Audit logging for sensitive operations | MEDIUM | Post-launch |

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

See `docs/spec.md` for original product specification.
