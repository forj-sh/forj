# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**Current Status (March 13, 2026):**
- **Phase:** 6 (Auth + Credential Security) - ✅ COMPLETE (PRs #63-#72)
- **Next Phase:** 7 (Ship)
- **Branch:** main (all Graphite stacks merged)
- **Architecture:** Cloudflare as DNS authority. Namecheap is registrar only.

### Essential Commands
```bash
# Development
npm run dev -w packages/api          # Start API server (localhost:3000)
npm run dev -w packages/cli          # CLI watch mode
cd packages/workers && npm run dev   # Start domain worker

# Testing
npm test -w packages/api -- sse-streaming.test.ts  # Integration test
curl http://localhost:3000/health                   # API health check

# Graphite workflow
gt create -m "Stack N: Description"  # Create new stack
gt modify                             # Amend current stack
gt restack                            # Rebase all stacks
gt submit                             # Push + create PRs
```

### Critical Information

**Phase 6 Completion Checklist:**
- ✅ API key data model + generation service (Stack 1)
- ✅ API key authentication middleware (Stack 2)
- ✅ API key management routes (Stack 3)
- ✅ Auth middleware on /provision route (Stack 4)
- ✅ Per-user rate limiting infrastructure (Stack 5)
- ✅ Per-IP rate limiting infrastructure (Stack 6)
- ✅ Rate limiting applied to all routes (Stack 7)
- ✅ API key rotation endpoint (Stack 8)
- ✅ Credential rotation for OAuth tokens (Stack 9)
- ✅ MCP tool definition + integration docs (Stack 10)

**Security Status:**
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

```
forj/ (GitHub: forj-sh/forj)
├── packages/
│   ├── landing/        ✅ Landing page (live at forj.sh, deployed on Vercel)
│   ├── cli/            ✅ CLI client (commander.js + inquirer + SSE)
│   ├── api/            ✅ Fastify API server (routes, auth, Stripe, orchestrator)
│   ├── workers/        ✅ BullMQ workers (domain, GitHub, Cloudflare, DNS)
│   └── shared/         ✅ Shared types + API clients (Namecheap, Cloudflare, GitHub)
├── api/                ✅ Vercel serverless functions (waitlist form)
├── lib/                ✅ Shared database utilities
├── project-docs/       ✅ Product specifications + build plan
└── CLAUDE.md           ✅ This file
```

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

# Start services for manual testing
npm run dev -w packages/api          # Terminal 1
cd packages/workers && npm run dev   # Terminal 2

# Health check
curl http://localhost:3000/health
```

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

## References

- Full specification: `project-docs/forj-spec.md`
- Build plan: `project-docs/build-plan.md`
- Testing guide: `project-docs/testing-guide.md`
- Troubleshooting: `project-docs/troubleshooting.md`
- MCP integration: `docs/MCP_INTEGRATION.md`
