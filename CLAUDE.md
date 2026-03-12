# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**Current Status (March 11, 2026):**
- **Phase:** 5 (GitHub + Cloudflare + DNS Wiring) - ✅ COMPLETE (PRs #42-#53)
- **Next Phase:** 6 (Auth + Credential Security)
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

**Phase 5 Completion Checklist:**
- ✅ Cloudflare API client + types (Stack 1)
- ✅ Cloudflare token verification + encrypted storage (Stack 2)
- ✅ GitHub OAuth Device Flow (Stack 3)
- ✅ GitHub API client + types (Stack 4)
- ✅ GitHub worker — org verification + repo creation (Stack 5)
- ✅ Cloudflare worker — zone creation + NS handoff (Stack 6)
- ✅ DNS wiring worker — MX, SPF, DKIM, DMARC, CNAME (Stack 7)
- ✅ DNS health checker + auto-repair (Stack 8)
- ✅ CLI auth flows — Cloudflare + GitHub (Stack 9)
- ✅ Provisioning orchestrator — parallel execution (Stack 10)
- ✅ End-to-end integration testing (Stack 11)
- ✅ Documentation + security review (Stack 12)

**Security Status:**
- ✅ JWT authentication protects all domain routes
- ✅ IDOR vulnerability fixed (ownership checks)
- ✅ Stripe webhook forgery prevented (signature verification)
- ✅ Price manipulation prevented (server-side validation)
- ✅ Cloudflare/GitHub tokens encrypted at rest (AES-256-GCM)
- ⚠️ Per-user/per-IP rate limiting still needed
- ⚠️ Agent API key auth not yet implemented
- ⚠️ Credential rotation support needed

**Environment Variables Required for Testing:**
```bash
# Minimum for development
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
JWT_SECRET=$(openssl rand -base64 32)

# Enable production Namecheap routes
ENABLE_NAMECHEAP_ROUTES=true
NAMECHEAP_API_USER=...
NAMECHEAP_API_KEY=...
NAMECHEAP_USERNAME=...
NAMECHEAP_CLIENT_IP=...
NAMECHEAP_SANDBOX=true
```

**Key Constraints:**
- ALL Namecheap API calls MUST use `requestQueue.submit()` for rate limiting
- CLI package requires `.js` extensions in imports (ESM requirement)
- NEVER bypass Graphite CLI (`gt`) for branch management
- Routes require `ENABLE_NAMECHEAP_ROUTES=true` to mount production endpoints

### Navigation Guide

Quick links to key sections:
- **[Build Progress](#build-progress)** - Current phase status
- **[Architecture](#architecture-implemented)** - System design
- **[Development Workflow](#development-workflow)** - Graphite stacking guide
- **[Common Commands](#common-commands)** - npm workspace commands

For detailed guides, see:
- Testing: `project-docs/testing-guide.md`
- Troubleshooting: `project-docs/troubleshooting.md`

---

## Project Overview

**Forj** is an infrastructure provisioning CLI tool that creates production-ready project infrastructure with a single command. The value proposition is: `npx forj-cli init my-startup` provisions domain registration (Namecheap), GitHub repos, Cloudflare DNS zone, and automatically wires all DNS records (MX, SPF, DKIM, DMARC) correctly in under 2 minutes.

This project is currently in **active MVP development**. Phase 4 (Integration + Security) is complete and merged (11-stack PR sequence #31-#41, March 10-11, 2026). The system is now **ready for end-to-end testing** with real Namecheap API integration, JWT authentication, Stripe payment flow, and SSE streaming. Next milestone: Phase 5 (GitHub + Cloudflare workers). The complete product specification is in `project-docs/forj-spec.md` (currently v0.2 - updated after API feasibility assessment).

## Branding & Naming

- **Domain**: forj.sh
- **GitHub org**: forj-sh
- **npm package**: forj-cli
- **CLI invocation (cold)**: `npx forj-cli init acme`
- **CLI invocation (global)**: `forj init acme` (after `npm install -g forj-cli`)

## Current Repository Structure

```
forj/ (GitHub: forj-sh/forj)
├── packages/
│   ├── landing/        ✅ Landing page (live at forj.sh, deployed on Vercel)
│   ├── cli/            ✅ CLI client — fully implemented thin client (commander.js + inquirer)
│   ├── api/            ✅ Fastify API server — scaffold + domain routes + Stripe webhooks
│   ├── workers/        ✅ Domain worker — BullMQ job handlers + state machine
│   └── shared/         ✅ Shared types + Namecheap client + rate limiter + priority queue
├── api/                ✅ Vercel serverless functions (waitlist form)
├── lib/                ✅ Shared database utilities
├── project-docs/       ✅ Product specifications
└── CLAUDE.md           ✅ This file
```

## Technical Feasibility: ✅ CONFIRMED

**V1 MVP is 100% technically feasible** with publicly available APIs. All critical blockers from v0.1 have been resolved:

- ✅ **Domain registration**: Namecheap Reseller API ($50 deposit, well-documented)
- ✅ **GitHub repos**: Guided manual org creation (15s), then full automation via OAuth
- ✅ **Cloudflare DNS**: User's own account, full API access for zone/record management
- ✅ **DNS wiring**: Pure API calls to Cloudflare, no blockers
- ✅ **Payment flow**: Stripe as merchant, Namecheap wholesale billing, clean margins

**V2 additions** (Vercel, Railway) also confirmed feasible with official APIs.

## Architecture (Implemented)

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
  - GitHub Worker (guided org creation + repo automation via OAuth)
  - Cloudflare Worker (user OAuth → zone + DNS management)
  - DNS Wiring Worker (runs after all services, auto-configures MX/SPF/DKIM/DMARC)
  - Vercel Worker (V2 - project creation, repo linking, domain setup)
  - Railway Worker (V2 - project creation, repo linking, optional Postgres)
    ↓
State Store (Postgres with JSONB for service states)
    ↓
Payment Processing (Stripe checkout → Namecheap wholesale billing)
```

### Data Model

Projects table stores project state with JSONB `services` column:
```json
{
  "domain":     { "status": "complete", "value": "getacme.com", "meta": {} },
  "github":     { "status": "running",  "value": null, "meta": {} },
  "cloudflare": { "status": "pending",  "value": null, "meta": {} },
  "dns":        { "status": "pending",  "value": null, "meta": {} }
}
```

Credentials table is ephemeral — encrypted payloads delivered once then purged.

### API Contracts (Defined by CLI)

The CLI client defines these endpoints (all expect `{ success, data, error, message }` response envelope):

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/domains/check` (Namecheap) | POST | Domain availability + pricing | ✅ Mounted (requires auth + `ENABLE_NAMECHEAP_ROUTES=true`) |
| `/domains/register` (Namecheap) | POST | Create registration job | ✅ Mounted (requires auth + `ENABLE_NAMECHEAP_ROUTES=true`) |
| `/domains/jobs/:jobId` (Namecheap) | GET | Job status polling | ✅ Mounted (requires auth + ownership check) |
| `/domains/check` (Mock) | POST | Domain availability (mock) | ✅ Mounted (fallback if Namecheap not configured) |
| `/projects/init` | POST | Create project record | ✅ Mounted (returns mock project ID) |
| `/projects/:id/stream` | GET (SSE) | Real-time provisioning events | ✅ Mounted (simulated flow) |
| `/projects/:id/status` | GET | Project + service status | ✅ Mounted (mock data) |
| `/projects/:id/services` | POST | Add service post-init | ✅ Mounted |
| `/projects/:id/dns/health` | GET | DNS record validation | ✅ Mounted (mock) |
| `/projects/:id/dns/fix` | POST | Auto-repair DNS issues | ✅ Mounted (mock) |
| `/auth/cli` | GET | OAuth flow initiation | ✅ Mounted (mock implementation) |
| `/events/stream/:projectId` | GET (SSE) | SSE endpoint for provisioning | ✅ Mounted (real Redis pub/sub streaming) |
| `/webhooks/stripe` | POST | Stripe payment webhooks | ✅ Mounted (requires `STRIPE_WEBHOOK_SECRET`) |
| `/checkout/create-session` | POST | Create Stripe checkout session | ✅ Mounted (requires pricing cache + auth) |

**IMPORTANT - Integration Status (Updated March 11, 2026):**
- ✅ **Production Namecheap routes** are MOUNTED with JWT auth middleware (Stack 4-7)
- ✅ **Stripe webhook routes** are MOUNTED with signature verification (Stack 9)
- ✅ **Stripe checkout routes** are MOUNTED with server-side pricing validation (Stack 11)
- ✅ **Real SSE streaming** via Redis pub/sub is LIVE (Stack 2-3)
- ✅ **Authorization checks** prevent IDOR attacks on job endpoints (Stack 7)
- ⚠️ **Mock routes** still available as fallback when Namecheap credentials not configured

## Tech Stack

**Backend:** Fastify 4, BullMQ + Redis, Neon Postgres (serverless), Pino logging
**CLI:** commander.js, inquirer, chalk, ora, eventsource (SSE)
**Integrations:** Namecheap Reseller API, Stripe Checkout, jose (JWT)
**Build:** tsup (esbuild), TypeScript strict mode, Node.js 18+

## Key Service Integrations (by Phase)

### V1 MVP - Core Infrastructure

**Domain Registration (Namecheap Reseller API)** ✅ IMPLEMENTED
- Forj acts as true reseller: buys wholesale, sells at market rate
- Setup: $50 deposit OR 20+ domains in account
- API endpoints: `namecheap.domains.check` (availability), `namecheap.domains.create` (registration)
- Payment flow: User pays Forj via Stripe → Forj pays Namecheap wholesale → ~15% margin
- Fallback: GoDaddy Reseller API if Namecheap has issues

**Implementation details** (see `packages/shared/src/namecheap/`):
- `client.ts`: 8 API methods (checkDomains, getTldPricing, createDomain, setCustomNameservers, getDomainInfo, renewDomain, listDomains, getBalances)
- `xml-parser.ts`: Custom parser for Namecheap's attribute-based XML format
- `rate-limiter.ts`: Redis-backed sliding window (Lua script, 20 req/min)
- `request-queue.ts`: 3-tier priority queue (CRITICAL > INTERACTIVE > BACKGROUND) with per-user fairness
- `errors.ts`: 50+ error codes mapped to 6 categories with retryability + user-facing messages
- Domain worker (`packages/workers/src/domain-worker.ts`): BullMQ job handlers for CHECK, REGISTER, RENEW, SET_NAMESERVERS, GET_INFO with full state machine
- Pricing cache (`packages/api/src/lib/pricing-cache.ts`): Redis-backed, 1-hour TTL, warmup for common TLDs
- Stripe webhooks (`packages/api/src/routes/stripe-webhooks.ts`): Handlers defined for checkout.session.completed, payment events, refunds (signature verification not yet implemented)

**GitHub Guided Flow** (Semi-Manual)
- GitHub.com does NOT support org creation via API (Enterprise-only feature)
- UX solution: Guided 15-second browser step
  1. CLI detects org needed → opens `github.com/organizations/new`
  2. User creates org manually (15 seconds)
  3. User returns to CLI and confirms org name
  4. CLI verifies org exists via API, then proceeds
  5. Worker automates: repo creation, branch protection, `.github` defaults, GitHub Pages setup
- OAuth scope: `admin:org` for repo management (NOT org creation)
- **The value is in configuration automation, not org creation**

**Cloudflare as DNS Authority** (User's Own Account)
- Namecheap is registrar only — Cloudflare manages all DNS
- User creates Cloudflare API token via guided flow (Cloudflare does not support standard OAuth2 for third-party zone management)
- Forj creates zone → extracts nameserver pair → updates NS on Namecheap via `setCustomNameservers()` → wires DNS records via Cloudflare API
- Provisioning order: domain (Namecheap) → zone (Cloudflare) → NS update (Namecheap) → DNS records (Cloudflare)
- No reseller model — user's account, Forj orchestrates

**DNS Wiring via Cloudflare API** (Highest Value Operation - V1)
Auto-configures records that founders commonly misconfigure (all via Cloudflare API after zone is active):
- MX records for email routing
- SPF: `v=spf1 include:_spf.google.com ~all`
- DKIM for Google Workspace (auto-fetched keys)
- DMARC baseline: `v=DMARC1; p=none; rua=mailto:dmarc@{domain}`
- GitHub Pages CNAME: `{org}.github.io`
- Vercel CNAME (if Vercel provisioned in V2)

### V2 - Deployment Platforms

**Vercel Integration**
- User's own account, OAuth for API access
- Creates project, links to GitHub repo, sets custom domain
- DNS wiring adds Vercel CNAME automatically
- SSL auto-provisions via Let's Encrypt

**Railway Integration**
- User's own account, OAuth for API access
- Creates project, links to GitHub repo
- Optional: Provision Postgres service
- Stores Railway project URL in forj state

### V3 - Enterprise & Recurring Revenue

**Google Workspace Reseller**
- Requires Partner Sales Console + 100+ managed seats + 4+ week approval
- True reseller with ~20% recurring margin on seat fees
- Most important long-term revenue stream
- **Do NOT apply before launch** - Google wants to see business activity first
- Interim solution: Referral deep-link to Google Workspace signup

**AWS Organizations** (Enterprise Only)
- For teams that have outgrown Vercel/Railway (Series A+)
- User creates AWS account, grants cross-account IAM role
- Forj configures via CloudFormation templates
- Not needed for V1 target users (0→1 stage founders)

## CLI Usage

**Interactive mode:**
```bash
npx forj-cli init acme
# Guided prompts for domain selection, service configuration
# Provisions: domain (Namecheap) → GitHub repos → Cloudflare DNS → DNS wiring
# Output: .forj/credentials.json (gitignored)
```

**Non-interactive mode (for AI agents):**
```bash
npx forj-cli init acme \
  --domain getacme.com \
  --services github,cloudflare,domain \
  --github-org getacme \
  --non-interactive \
  --json
# Returns structured JSON with service status
```

**Global install:**
```bash
npm install -g forj-cli
forj init acme    # Simplified invocation
forj status       # Check project status
forj dns check    # Verify DNS configuration
```

## Build Progress

| Phase | Status | Description |
|-------|--------|-------------|
| 1. CLI Client | ✅ Complete | All 6 commands, interactive + non-interactive modes |
| 2. API Server Scaffold | ✅ Complete | Fastify + Postgres + BullMQ + Redis (PRs #12-#18) |
| 3. Namecheap Domain Integration | ✅ Complete | Full API client, rate limiter, priority queue, domain worker (PRs #19-#30) |
| 4. Integration + Security | ✅ Complete | Route mounting, auth middleware, Stripe verification, SSE wiring (PRs #31-#41) |
| 5. GitHub + Cloudflare + DNS Wiring | ✅ Complete | Cloudflare API + zones, GitHub Device Flow + repos, DNS wiring, orchestrator (PRs #42-#53) |
| 6. Auth + Credential Security | 🔲 Next | Agent API keys, per-user rate limiting, credential rotation, MCP definition |
| 7. Ship | 🔲 Planned | npm publish, demo, launch |

**Latest:** Phase 5 complete March 11, 2026 (12-stack PR sequence #42-#53). Full provisioning pipeline now operational: domain registration → GitHub repos → Cloudflare zones → DNS wiring.

**Full build plan:** `project-docs/build-plan.md`

## Testing

Phase 4 (Integration + Security) is complete. For comprehensive testing instructions, see `project-docs/testing-guide.md`.

**Quick verification:**
```bash
# Run integration tests
npm test -w packages/api -- sse-streaming.test.ts

# Start services
npm run dev -w packages/api          # Terminal 1
cd packages/workers && npm run dev   # Terminal 2

# Health check
curl http://localhost:3000/health
```

## Development Workflow

### Git Workflow: Graphite Stacking Method

**IMPORTANT**: All feature development MUST use the Graphite CLI (`gt`) for stacked PRs. Do NOT use raw `git` commands for branch management — use `gt create`, `gt modify`, `gt restack`, and `gt submit`.

#### What is Graphite Stacking?

Graphite stacking is a development workflow where you break large features into small, sequential pull requests that build on top of each other. Each PR (or "stack") is independently reviewable and mergeable. The `gt` CLI handles all the branch/rebase complexity automatically.

#### Why Use Graphite?

- **Incremental review**: Reviewers can approve small, focused changes instead of massive diffs
- **Parallel work**: Other devs can build on your lower stacks while upper stacks are still in review
- **Easier debugging**: Isolate issues to specific stacks
- **Better git history**: Each stack represents a logical unit of work
- **Faster iteration**: Merge lower stacks while refining upper ones
- **Automatic rebasing**: `gt restack` handles cascade rebases when lower stacks change

#### Graphite CLI Commands (Required)

```bash
# ESSENTIAL COMMANDS — use these instead of git branch/checkout/rebase
gt create -m "Stack 1: Description"      # Create new branch on top of current stack
gt modify                                  # Amend current stack (after making changes)
gt restack                                 # Rebase all stacks after lower stack changes
gt submit                                  # Push all stacks + create/update PRs on GitHub
gt log short                               # View your current stack
gt checkout <branch>                       # Switch between stacks
gt trunk                                   # Switch back to main

# USEFUL COMMANDS
gt info                                    # Show current branch info
gt diff                                    # Show changes in current stack
gt bottom / gt top                         # Navigate to bottom/top of stack
gt up / gt down                            # Navigate one stack up/down
gt delete <branch>                         # Remove a stack
gt reorder                                 # Reorder stacks interactively
```

#### Graphite Workflow Steps

**1. Plan your stacks before coding**
Break your feature into logical, sequential units. Each stack should:
- Be independently testable
- Build on the previous stack
- Represent a complete logical unit
- Be small enough to review in < 10 minutes

Example: Namecheap integration in 12 stacks:
- Stack 1: XML parser foundation + types
- Stack 2: Namecheap client core + error handling
- Stack 3: Domain check + pricing methods
- Stack 4: Domain registration + nameserver methods
- Stack 5: Domain info, renewal, balance methods
- Stack 6: Redis-backed rate limiter
- Stack 7: Priority queue
- Stack 8: Queue fairness + SSE event integration
- Stack 9: Domain worker state machine
- Stack 10: Domain worker job handlers
- Stack 11: API routes + pricing cache
- Stack 12: Stripe webhooks + production config

**2. Create stacks with `gt create`**

```bash
# Start from main
gt trunk

# Create Stack 1 — make changes, stage them, then:
gt create -m "Stack 1: XML parser foundation + Namecheap types"

# Create Stack 2 — automatically stacks on top of Stack 1
# ... make changes ...
gt create -m "Stack 2: Namecheap client core + error handling"

# Create Stack 3 — stacks on top of Stack 2
# ... make changes ...
gt create -m "Stack 3: Domain check + pricing methods"

# Continue for all stacks...
```

**3. Submit all PRs at once**

```bash
# Push all stacks and create/update PRs on GitHub
gt submit

# This creates PRs with correct base branches automatically:
# PR #1: Stack 1 → main
# PR #2: Stack 2 → Stack 1
# PR #3: Stack 3 → Stack 2
# etc.
```

**4. When you need to modify a lower stack**

```bash
# Go to the stack you need to change
gt checkout stack-2-namecheap-client

# Make your changes, then:
gt modify                  # Amend the current stack

# Rebase all stacks above it
gt restack                 # Automatically rebases stacks 3-12

# Push updated stacks
gt submit
```

**5. Write clear PR descriptions**

**CRITICAL:** When using `gt submit`, Graphite will prompt for PR descriptions. Always provide a clear, detailed description for each stack following this template:

```markdown
## Summary
[2-3 sentences explaining WHAT this stack does and WHY it's needed]

## Changes
- [Specific change 1]
- [Specific change 2]
- [Specific change 3]

## Stack Context
**Stack X of Y** - Builds on Stack X-1

## Dependencies
- **Requires**: Stack X-1 (PR #N) - [what it provides]
- **Required by**: Stack X+1 (PR #N+1) - [what will build on this]

## Testing
- [ ] Integration tests pass
- [ ] Manual testing completed: [describe what you tested]

## Next Stack
[1 sentence preview of what Stack X+1 will add]
```

**Example for Stack 6 (JWT Auth Middleware):**
```markdown
## Summary
Implements JWT authentication middleware to protect all domain routes. Uses `jose` library for token verification and adds `requireAuth` decorator to Fastify routes. This prevents unauthorized access to Namecheap API operations and job status endpoints.

## Changes
- Added `lib/jwt.ts` with token generation and verification
- Created `requireAuth` middleware in `middleware/auth.ts`
- Applied middleware to all domain routes in `routes/domains-namecheap.ts`
- Added mock `/auth/cli` endpoint for development

## Stack Context
**Stack 6 of 11** - Builds on Stack 4 (Namecheap routes)

## Dependencies
- **Requires**: Stack 4 (PR #34) - Mounted Namecheap routes that need protection
- **Required by**: Stack 7 (PR #36) - Authorization checks that verify ownership

## Testing
- [x] Integration tests pass
- [x] Manual testing: Verified 401 on protected routes without token
- [x] Manual testing: Verified 200 with valid JWT token

## Next Stack
Stack 7 will add ownership verification to prevent IDOR attacks on job endpoints.
```

**Why detailed descriptions matter:**
- Helps reviewers understand context quickly
- Documents decision-making for future reference
- Makes it easier to debug issues later
- Shows AI agents (like Claude Code) the reasoning behind changes

**6. Merging stacks**

Use Graphite's merge queue or merge from GitHub:
1. Merge Stack 1 → main (Graphite auto-retargets Stack 2 to main)
2. Merge Stack 2 → main
3. Continue up the stack

**7. Common mistakes to avoid**

❌ Don't use raw `git` commands — always use `gt create`, `gt modify`, `gt restack`, `gt submit`
❌ Don't make stacks too large (> 500 lines) or too granular (< 50 lines)
❌ Don't skip PR descriptions — they're critical for context and review

### Current Repository State

The landing page, CLI client, API server scaffold, and Namecheap domain integration are all implemented and merged to main. The CLI is a production-ready thin client; the API has domain routes defined (not yet mounted) with full Namecheap API coverage, rate limiting, priority queuing, and Stripe webhook stubs. Next milestone is Phase 4 (integration glue + security middleware). Future feature work should follow the Graphite stacking method outlined above.

## Local Development Setup

### Prerequisites
- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0
- **Redis**: Required for API/workers (rate limiting, BullMQ)
- **PostgreSQL**: Required for API (Neon Postgres in production, local Postgres for dev)

### Environment Setup

**API Server** (`packages/api/.env`):
```bash
# Server
PORT=3000
HOST=localhost
NODE_ENV=development
API_URL=http://localhost:3000

# Database (Neon Postgres or local)
DATABASE_URL=postgresql://user:pass@localhost:5432/forj_dev

# Redis (local or managed)
REDIS_URL=redis://localhost:6379

# Namecheap (sandbox mode for dev)
NAMECHEAP_API_USER=your_username
NAMECHEAP_API_KEY=your_api_key
NAMECHEAP_USERNAME=your_username
NAMECHEAP_CLIENT_IP=your_ip
NAMECHEAP_SANDBOX=true  # Use sandbox API

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# Workers
DOMAIN_WORKER_CONCURRENCY=5

# Features (optional)
ENABLE_BULL_BOARD=false  # Queue monitoring UI
RATE_LIMITING_ENABLED=true
```

**Landing Page** (`packages/landing/.env.local`):
See `packages/landing/.env.local.example` for Turnstile, Resend, and database settings.

### First-Time Setup

```bash
# Install dependencies
npm install

# Run database migrations (API)
npm run db:migrate -w packages/api

# Build all packages
npm run build

# Start development servers
npm run dev  # All packages with dev scripts
```

### Running Individual Services

```bash
# API server (requires Redis + Postgres)
npm run dev -w packages/api

# CLI (in watch mode)
npm run dev -w packages/cli

# Landing page (Vite dev server on :5173)
npm run dev -w packages/landing

# Run domain worker (requires Redis + API server running)
cd packages/workers
npm run dev
```

### Testing the CLI Locally

```bash
# Build CLI first
npm run build -w packages/cli

# Run from dist with Node
node packages/cli/dist/cli.js init test-project

# Or link globally for development
cd packages/cli
npm link
forj init test-project  # Now available globally
```

## Common Commands

### Monorepo Commands (from root)

```bash
# Development
npm run dev                      # Run dev servers for all packages
npm run dev -w packages/landing  # Run landing page dev server only

# Build
npm run build                    # Build all packages
npm run build -w packages/landing # Build landing page only

# Testing
npm test                         # Run tests for all packages

# Utilities
npm run clean                    # Remove all node_modules and dist folders
```

### Landing Page (`packages/landing`)

**Stack:** Vite + TypeScript, deployed on Vercel
**Database:** Neon PostgreSQL (waitlist storage)
**Spam protection:** Cloudflare Turnstile + rate limiting

```bash
npm run dev -w packages/landing        # Start dev server (:5173)
npm run build -w packages/landing      # Build for production
```

**Important:** Due to Vercel constraints, API routes live at `/api/` (root) and shared utils at `/lib/` (root). Frontend code is in `packages/landing/src/`. See `packages/landing/.env.local.example` for env vars.

### Package Architecture (Implemented)

```
/packages
  /cli          - CLI client (commander.js + inquirer) — ✅ complete
  /api          - Fastify API server — ✅ scaffold + domain routes + Stripe webhooks
  /workers      - BullMQ worker implementations — ✅ domain worker complete
  /shared       - Shared types + Namecheap client + rate limiter + queue — ✅ complete
```

**Key dependencies by package:**

`@forj/shared`: fast-xml-parser, libphonenumber-js, ioredis (peer)
`@forj/api`: fastify, bullmq, ioredis, pg, @neondatabase/serverless, pino
`@forj/workers`: bullmq, ioredis, @forj/shared
`@forj/cli`: commander, inquirer, chalk, ora, eventsource

**Commands:**
```bash
# Development
npm run dev                      # Run dev servers for all packages
npm run dev -w packages/cli      # Run CLI in development (watch mode via tsup)
npm run dev -w packages/api      # Start Fastify API server

# Testing
npm test                         # Run all tests
npm test -w packages/shared      # Run shared package tests (Namecheap client, rate limiter, queue, state machine)
npm run test:watch -w packages/shared  # Watch mode for tests

# Build
npm run build                    # Build all packages
npm run build -w packages/cli    # Build CLI (outputs to dist/cli.js with shebang)

# Database
npm run db:migrate -w packages/api     # Run Postgres migrations
npm run db:migrate:create -w packages/api # Create new migration

# Type Checking
npm run type-check -w packages/cli     # TypeScript validation for CLI
npm run type-check -w packages/landing # TypeScript validation for landing
```

### Key Architectural Patterns

**Import Conventions:**
- **CLI package uses .js extensions** (ESM requirement): `import { api } from '../lib/api-client.js'`
- **Other packages omit extensions**: `import { NamecheapClient } from '@forj/shared'`
- **All async code uses async/await** (no raw Promises or .catch())

**Error Handling:**
- **API responses**: Always return `{ success: boolean, data?: any, error?: string }`
- **CLI errors**: Wrapped with `withErrorHandling()` → log + exit code 1
- **Worker errors**: Throw for BullMQ retry mechanism
- **Namecheap errors**: Categorized into 6 types (AUTH, INPUT, AVAILABILITY, PAYMENT, SYSTEM, NETWORK) with retryability flags

**State Management:**
- **Project services stored as JSONB** in Postgres `projects` table
- **State transitions validated** by `isValidStateTransition()` before worker updates
- **Domain worker state machine**: PENDING → QUEUED → CHECKING → AVAILABLE/UNAVAILABLE → REGISTERING → CONFIGURING → COMPLETE/FAILED
- **ALL Namecheap API calls MUST go through `requestQueue.submit()`** to ensure rate limiting

**TypeScript Patterns:**
- **Strict mode enabled** across all packages
- **Discriminated unions** for job types: `CheckDomainJobData | RegisterDomainJobData | ...`
- **Export types with `export type`**, functions/classes with `export`
- **Generic constraints** in API client: `apiRequest<T = unknown>()`

**Testing Patterns:**
- **Jest with ts-jest** + ESM support
- **Mock strategy**: `global.fetch` for HTTP, `jest.fn()` for Redis
- **Type-safe mocks**: `jest.Mocked<Redis>`
- **Test files**: Adjacent to source in `__tests__/` directories

## Security Considerations

1. **Never persist credentials post-handoff** — Encrypt with AES-256-GCM, deliver once, purge immediately
2. **Audit all OAuth token access** — Log every read/use of GitHub/Cloudflare tokens
3. **Validate all external API responses** — Never trust GitHub/Cloudflare/Namecheap API data without schema validation
4. **Namecheap API keys** — Store encrypted at rest, rotate regularly, use separate keys per environment
5. **Rate limiting** — ✅ Redis-backed sliding window rate limiter implemented for Namecheap API (20 req/min). ⚠️ Per-user/per-IP API rate limiting still needed on Fastify routes.
6. **Stripe webhook verification** — ✅ **FIXED (Stack 9).** Webhook signature verification implemented using `stripe.webhooks.constructEvent()` with raw body. All webhook events are now verified before processing.
7. **Authorization (IDOR)** — ✅ **FIXED (Stack 7).** `/domains/jobs/:jobId` now has ownership checks via `verifyProjectOwnership()`. Users can only access their own job data.
8. **Authentication middleware** — ✅ **FIXED (Stack 6).** JWT verification middleware (`requireAuth`) is applied to all protected domain routes. Uses `jose` library for token verification.
9. **Server-side pricing validation** — ✅ **FIXED (Stack 11).** All Stripe checkout sessions validate pricing server-side using PricingCache to prevent price manipulation attacks.
10. **Penetration test before public launch** — Credential handoff flow is primary attack surface
11. **Error sanitization** — ✅ Namecheap API keys are sanitized in error messages to prevent credential leakage in logs

**Phase 4 Security Summary (March 2026):**
- ✅ All critical security gaps identified in Phase 3 have been addressed
- ✅ JWT authentication protects all financial operations
- ✅ IDOR vulnerabilities patched with ownership verification
- ✅ Stripe webhooks cannot be forged (signature verification)
- ✅ Price manipulation attacks prevented (server-side validation)
- ⚠️ Additional rate limiting recommended for production (per-user/per-IP)

## Target Users

1. **Vibe-coders / Solo devs** — Non-traditional devs using AI assistance, need fast setup
2. **Early-stage founders** — Technical co-founders at 0→1 stage, want correct defaults
3. **AI coding agents** — Cursor, Claude Code, Windsurf completing project scaffolding programmatically
4. **Serial builders** — Devs starting many projects, agencies, freelancers
5. **Accelerator cohorts** — YC/Techstars batches (white-label opportunity)

## Monetization (Hybrid Model)

### Payment Flow
Forj is merchant of record for billable services. User pays Forj once via Stripe, Forj pays providers at wholesale.

- **Domain registration**: Forj pays Namecheap wholesale (~$8-10) → charges user market rate (~$12-15) → ~15% margin
- **Domain renewals**: Stripe annual subscription → auto-renews via Namecheap API
- **Forj service fee**: Charged at checkout alongside domain (single Stripe transaction)
- **Refund policy**: Full refund via Stripe if provisioning fails and cannot be retried

### Tiers

| Tier | Price | Includes |
|------|-------|----------|
| **Free** | $0 | 1 project · Domain + GitHub config + Cloudflare + DNS wiring |
| **Pro** | $49 one-time or $99/yr | Unlimited projects · Vercel + Railway integrations · DNS monitoring · status history |
| **Agent** | $199/yr | API key · non-interactive mode · JSON output · webhooks · priority provisioning |
| **Cohort** | Custom per batch | White-label CLI · bulk provisioning · custom defaults · dedicated support |

### Revenue Streams

**Primary (V1):**
- Domain reseller margin: ~15% on registration + renewals (compounds across customer portfolio)
- Service fees: $49-199 per tier

**Secondary (V2+):**
- Vercel/Railway affiliate fees (one-time per activated account)
- Stripe affiliate (one-time per activated account)

**Future (V3):**
- Google Workspace reseller margin: ~20% recurring on seat fees (highest LTV, but requires 100+ managed seats + 4+ week approval)
- AWS partner program (enterprise tier only)

**Note**: Do NOT apply for Google Workspace reseller before launch. Google wants to see business activity (100+ customers) before approval is likely.

## Technical Feasibility

✅ **V1 MVP is 100% buildable** with publicly available APIs:
- Namecheap Reseller API (domain registration)
- GitHub REST API (repo automation, org creation is guided manual)
- Cloudflare API (DNS zone management via user's account)
- Stripe Checkout (payment processing)

See `project-docs/forj-spec.md` for complete feasibility assessment and v0.1 → v0.2 changes.

## Important File Locations

### Core Implementation Files

**CLI** (`packages/cli/src/`):
- `cli.ts` - Entry point, command registration
- `commands/init.ts` - Main initialization flow (interactive + non-interactive)
- `lib/api-client.ts` - HTTP client for API communication
- `lib/sse-client.ts` - Server-Sent Events client for real-time updates
- `lib/validators.ts` - Input validation (email, domain, project name, GitHub org)
- `lib/prompts.ts` - Inquirer prompt builders

**API Server** (`packages/api/src/`):
- `server.ts` - Fastify server setup, currently mounted routes
- `routes/domains-namecheap.ts` - Production domain routes (NOT mounted yet)
- `routes/stripe-webhooks.ts` - Stripe webhook handlers (NOT mounted yet)
- `lib/pricing-cache.ts` - Redis-backed TLD pricing cache
- `lib/database.ts` - Neon Postgres connection
- `lib/redis.ts` - ioredis connection pooling
- `lib/queues.ts` - BullMQ queue initialization

**Shared Library** (`packages/shared/src/`):
- `namecheap/client.ts` - Namecheap API client (8 methods)
- `namecheap/xml-parser.ts` - Custom XML parser for Namecheap responses
- `namecheap/rate-limiter.ts` - Redis-backed sliding window rate limiter
- `namecheap/request-queue.ts` - 3-tier priority queue with fairness
- `namecheap/errors.ts` - Error categorization (50+ error codes)
- `domain-worker.ts` - State machine types and transitions
- `index.ts` - Central export hub for all types

**Workers** (`packages/workers/src/`):
- `domain-worker.ts` - BullMQ worker for domain operations (CHECK, REGISTER, RENEW, SET_NAMESERVERS, GET_INFO)

**Database**:
- `packages/api/migrations/1741570800000_init-projects-table.cjs` - Projects table schema

### Configuration Files
- `tsconfig.json` (root) - Base TypeScript configuration
- `packages/*/tsconfig.json` - Package-specific TypeScript configs
- `packages/*/tsup.config.ts` - Build configuration (CLI, API, workers, shared)
- `packages/landing/vite.config.ts` - Vite configuration for landing page
- `jest.config.ts` (shared, workers) - Jest test configuration
- `vercel.json` (root) - Vercel deployment config for landing page

## Troubleshooting

**Common issues:**
- **Redis connection errors:** Verify `redis-cli ping` returns `PONG`, check `REDIS_URL`
- **Module not found in CLI:** Use `.js` extensions in imports (ESM requirement)
- **Rate limit exceeded:** Namecheap sandbox has 20 req/min, clear Redis: `redis-cli FLUSHDB`
- **Worker not processing:** Check Redis connection, verify queue name matches

For detailed troubleshooting, see `project-docs/troubleshooting.md`.

## References

- Full specification: `project-docs/forj-spec.md` (v0.2 - March 2026)
- Namecheap integration spec: `project-docs/namecheap-integration-spec.md`
- Build plan with phases: `project-docs/build-plan.md`
