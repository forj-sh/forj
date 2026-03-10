# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Forj** is an infrastructure provisioning CLI tool that creates production-ready project infrastructure with a single command. The value proposition is: `npx forj-cli init my-startup` provisions domain registration (Namecheap), GitHub repos, Cloudflare DNS zone, and automatically wires all DNS records (MX, SPF, DKIM, DMARC) correctly in under 2 minutes.

This project is currently in **active MVP development**. The landing page with waitlist is live and deployed. The CLI client is fully implemented. The API server scaffold and Namecheap domain integration (including rate limiting, priority queuing, and Stripe webhook stubs) are complete and merged. Next milestone: integration glue (route mounting, auth middleware, Stripe signature verification) then GitHub + Cloudflare workers. The complete product specification is in `project-docs/forj-spec.md` (currently v0.2 - updated after API feasibility assessment).

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
| `/domains/check` (Namecheap) | POST | Domain availability + pricing | ⚠️ Defined in `routes/domains-namecheap.ts`, NOT mounted in `server.ts` |
| `/domains/register` (Namecheap) | POST | Create registration job | ⚠️ Defined in `routes/domains-namecheap.ts`, NOT mounted in `server.ts` |
| `/domains/jobs/:jobId` (Namecheap) | GET | Job status polling | ⚠️ Defined in `routes/domains-namecheap.ts`, NOT mounted in `server.ts` |
| `/domains/check` (Mock) | POST | Domain availability (mock) | ✅ Mounted in `server.ts` (temporary) |
| `/projects/init` | POST | Create project record | ✅ Mounted (returns mock project ID) |
| `/projects/:id/stream` | GET (SSE) | Real-time provisioning events | ✅ Mounted (simulated flow) |
| `/projects/:id/status` | GET | Project + service status | ✅ Mounted (mock data) |
| `/projects/:id/services` | POST | Add service post-init | ✅ Mounted |
| `/projects/:id/dns/health` | GET | DNS record validation | ✅ Mounted (mock) |
| `/projects/:id/dns/fix` | POST | Auto-repair DNS issues | ✅ Mounted (mock) |
| `/auth/cli` | GET | OAuth flow initiation | ✅ Mounted (mock implementation) |
| `/events/stream/:projectId` | GET (SSE) | SSE endpoint for provisioning | ✅ Mounted |
| `/webhooks/stripe` | POST | Stripe payment webhooks | ⚠️ Defined in `routes/stripe-webhooks.ts`, NOT mounted in `server.ts` |

**IMPORTANT - Integration Status:**
- **Mock routes** in `server.ts` are MOUNTED and working (used for CLI development)
- **Production routes** in `routes/domains-namecheap.ts` and `routes/stripe-webhooks.ts` are DEFINED but NOT MOUNTED
- **Phase 4 task**: Remove mock routes, mount production routes with auth middleware

## Tech Stack

| Layer | Technology | Status | Why |
|-------|-----------|--------|-----|
| Runtime | Node.js 18+ TypeScript | ✅ | Native fit for API integrations, strong typing |
| API Framework | Fastify 4 | ✅ | Fast, schema-native, good SSE support |
| Queue | BullMQ 5 + Redis (ioredis) | ✅ | Reliable job processing, retry semantics |
| Database | Neon Postgres (serverless) | ✅ | JSONB for flexible state, WebSocket connections |
| CLI | commander.js 12 + inquirer 9 | ✅ | Interactive CLI standard |
| CLI Build | tsup 8 (esbuild) | ✅ | ESM output with shebang, Node 18+ target |
| CLI UX | chalk 5 + ora 8 | ✅ | Styled output + spinners for streaming progress |
| SSE Client | eventsource 2 | ✅ | Real-time provisioning updates in CLI |
| XML Parsing | fast-xml-parser | ✅ | Namecheap's attribute-based XML responses |
| Phone Validation | libphonenumber-js | ✅ | Contact info formatting for domain registration |
| Logging | Pino 8 | ✅ | Structured logging with pretty-printing in dev |
| Auth | jose (JWT) + Node crypto AES-256-GCM | 🔲 | Token encryption, short-lived sessions |
| Deployment | Railway or Render | 🔲 | Low ops, managed Postgres + Redis |
| Domain API | Namecheap Reseller API | ✅ | 8 methods implemented, rate limited, priority queued |
| Payments | Stripe Checkout | ⚠️ | Webhook handlers defined, signature verification pending |
| DNS Validation | dns.resolve() + dnspropagation.net API | 🔲 | Post-provision record verification |

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

**Cloudflare DNS** (User's Own Account)
- User creates free Cloudflare account (or uses existing)
- User grants OAuth access for zone management
- Worker creates zone + auto-configures DNS records
- No reseller model - user's account, Forj just orchestrates

**DNS Wiring** (Highest Value Operation - V1)
Auto-configures records that founders commonly misconfigure:
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

## CLI Modes

### Interactive Mode (Human Developers)
```bash
$ npx forj-cli init acme

✦ forj — project infrastructure provisioning

? Company / project name: Acme Inc
? Desired domain: (checking availability...)
  ✓ acme.io         — $9.95/yr
  ✓ getacme.com     — $12.95/yr
  ✗ acme.com        — taken
? Select domain: getacme.com

? Services to provision:
  ✓ Domain registration   (Namecheap reseller)
  ✓ GitHub org + repos    (github.com/getacme)
  ✓ Cloudflare zone + DNS wiring
  ✓ Vercel project        (linked to GitHub)

! GitHub org must be created manually — takes 15 seconds.
  Opening github.com/organizations/new ...
? GitHub org name (confirm when created): getacme
  ✓ GitHub org confirmed

Provisioning...
  ✓ Domain registered          getacme.com
  ✓ GitHub repos created       github.com/getacme/app
  ✓ Cloudflare zone active     getacme.com
  ✓ DNS wired                  MX · SPF · DKIM · CNAME
  ✓ Vercel project linked      getacme.vercel.app

Credentials → .forj/credentials.json (gitignored ✓)

Setup complete in 2m 14s
Run `forj status` to see your stack.
```

### Non-Interactive Mode (AI Coding Agents)
```bash
npx forj-cli init acme \
  --domain getacme.com \
  --services github,cloudflare,domain \
  --github-org getacme \
  --non-interactive \
  --json

# Returns structured JSON
{
  "status": "complete",
  "project": "acme",
  "duration_ms": 134200,
  "services": {
    "domain":     { "status": "ok", "value": "getacme.com" },
    "github":     { "status": "ok", "value": "github.com/getacme" },
    "cloudflare": { "status": "ok", "zone_id": "abc123" },
    "dns":        { "status": "ok", "records": ["MX", "SPF", "DKIM", "CNAME"] }
  },
  "credentials_path": ".forj/credentials.json"
}
```

**Note for agents**: `--github-org` flag assumes org already exists. For new orgs, interactive mode required.

**After global install:**
```bash
npm install -g forj-cli
forj init acme              # Simplified invocation
forj status                 # Check project status
forj add vercel             # Add services post-init
forj dns check              # Verify DNS configuration
```

## Build Progress

| Phase | Status | Description |
|-------|--------|-------------|
| 1. CLI Client | ✅ Complete | All 6 commands, interactive + non-interactive modes |
| 2. API Server Scaffold | ✅ Complete | Fastify + Postgres + BullMQ + Redis (PRs #12-#18) |
| 3. Namecheap Domain Integration | ✅ Complete | Full API client, rate limiter, priority queue, domain worker (PRs #19-#30) |
| 4. Integration + Security | 🔲 Next | Route mounting, auth middleware, Stripe verification, SSE wiring |
| 5. GitHub + Cloudflare Workers | 🔲 Planned | GitHub OAuth + repos, Cloudflare OAuth + zones |
| 6. DNS Wiring Worker | 🔲 Planned | MX, SPF, DKIM, DMARC auto-configuration |
| 7. Auth + Credential Security | 🔲 Planned | Agent API keys, credential encryption, MCP definition |
| 8. Ship | 🔲 Planned | npm publish, demo, launch |

**Full build plan with details, environment variables, and security gaps:** `project-docs/build-plan.md`

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

**5. PR template for stacks**

Each PR should include:
```markdown
## Summary
Brief description of changes in this stack

## Stack Position
**Stack X of Y** - Builds on Stack X-1

## Dependencies
- **Requires**: Stack X-1 (PR #N)
- **Required by**: Stack X+1 (PR #N+1)

## Next Stack
Brief preview of what Stack X+1 will add
```

**6. Merging stacks**

Use Graphite's merge queue or merge from GitHub:
1. Merge Stack 1 → main (Graphite auto-retargets Stack 2 to main)
2. Merge Stack 2 → main
3. Continue up the stack

**7. What NOT to do**

❌ **Don't use `git checkout -b` for stacked branches** — use `gt create`
❌ **Don't manually rebase stacks** — use `gt restack`
❌ **Don't use `gh pr create` with manual base branches** — use `gt submit`
❌ **Don't commit everything to main first, then create PRs** (defeats the purpose)
❌ **Don't make stacks too large** (> 500 lines of changes)
❌ **Don't make stacks too granular** (< 50 lines, unless critical)
❌ **Don't create stacks with unclear dependencies**

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

```bash
# Development
npm run dev -w packages/landing        # Start Vite dev server (http://localhost:5173)
npm run build -w packages/landing      # Build for production (outputs to dist/)
npm run preview -w packages/landing    # Preview production build locally
npm run type-check -w packages/landing # Run TypeScript type checking
npm run db:migrate -w packages/landing # Run database migrations

# Deployment (handled automatically by Vercel on push to main)
```

### Landing Page Architecture

The landing page is a **Vite + TypeScript** application with the following structure:

```
packages/landing/
├── src/
│   ├── components/     # UI components (header, hero, waitlist form, etc.)
│   ├── services/       # API integrations (waitlist submission)
│   ├── styles/         # CSS modules
│   ├── utils/          # Utilities (validation, observers)
│   ├── lib/            # Shared libraries (Turnstile integration)
│   └── main.ts         # Entry point
├── api/                # Vercel serverless functions (waitlist form handler)
├── public/             # Static assets (images, fonts)
└── scripts/            # Database migration scripts
```

**Key components:**
- **Waitlist form** (`src/components/waitlist-form.ts`): Email capture with client-side validation
- **Turnstile integration** (`src/lib/turnstile.ts`): Cloudflare CAPTCHA for spam protection
- **API handler** (`/api/submit-form.ts`): Vercel serverless function for form submissions
- **Database utilities** (`/lib/database.ts`): Neon PostgreSQL helpers for storing signups

**Tech stack:**
- **Build**: Vite 5 + TypeScript
- **Database**: Neon PostgreSQL (serverless, managed)
- **Email**: Resend (notification emails to admin)
- **Spam protection**: Cloudflare Turnstile + rate limiting + disposable email blocking
- **Deployment**: Vercel (auto-deploys on push to main)

**Environment variables** (see `packages/landing/.env.local.example`):
- `VITE_TURNSTILE_SITEKEY`: Public Cloudflare Turnstile site key (optional for dev)
- `TURNSTILE_SECRET_KEY`: Secret Turnstile key for server-side verification (optional for dev)
- `RESEND_API_KEY`: Resend API key for email notifications (optional for dev)
- `DATABASE_URL`: Neon PostgreSQL connection string (required for production)

**Important: Root-level `/api` and `/lib` directories**

Due to Vercel deployment constraints, the landing page has two directories at the monorepo root:
- `/api/submit-form.ts`: Vercel serverless function for waitlist form submission
- `/lib/database.ts`: Shared database utilities used by the API function

These are logically part of the landing page but must live at the root because Vercel expects API routes at `/api` when deploying. The `vercel.json` at the root configures the deployment to treat `packages/landing` as the build directory while keeping API routes accessible.

**When working on the landing page**, remember that:
- Frontend code lives in `packages/landing/src/`
- API code lives in `/api/` (root level)
- Shared utilities live in `/lib/` (root level)
- All three work together as a single deployed application on Vercel

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
5. **Rate limiting** — ✅ Redis-backed sliding window rate limiter implemented for Namecheap API (20 req/min). Per-user/per-IP API rate limiting still needed on Fastify routes.
6. **Stripe webhook verification** — ⚠️ **CRITICAL: Not yet implemented.** Current webhook handler parses body without signature verification. Must implement `stripe.webhooks.constructEvent()` with raw body before production. Without this, anyone can forge webhooks and trigger registrations without payment.
7. **Authorization (IDOR)** — ⚠️ **CRITICAL: `/domains/jobs/:jobId` has no ownership check.** Job IDs are enumerable; attacker could iterate and access other users' domain job data. Must verify `request.user.id` owns the job before returning data.
8. **Authentication middleware** — ⚠️ Domain routes have TODO comments noting auth is missing. JWT verification must be added to all domain routes before production.
9. **Penetration test before public launch** — Credential handoff flow is primary attack surface
10. **Error sanitization** — ✅ Namecheap API keys are sanitized in error messages to prevent credential leakage in logs

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

## Pre-Build Validation (IMPORTANT)

Before implementing, validate demand:
1. **Developer demand:** Post landing page, get 200 waitlist signups
2. **Willingness to pay:** Scrape Delaware incorporation filings, cold email 50 technical founders, get 5+ genuine responses

**Two weeks of validation before two weeks of build.**

## Key Changes from v0.1 → v0.2 (Post-Feasibility Assessment)

The spec was revised after comprehensive API research revealed blockers in the original plan. Here's what changed:

### What Changed ✏️

| Component | v0.1 (Original) | v0.2 (Current) | Reason |
|-----------|-----------------|----------------|---------|
| **Domain registration** | Cloudflare Registrar | Namecheap Reseller API | Cloudflare has no reseller program/API |
| **GitHub org creation** | Fully automated via API | Guided manual step (15s) | GitHub.com doesn't support org creation via API |
| **Deployment platform** | AWS (V1) | Vercel + Railway (V2) | V1 users are 0→1 founders, not AWS scale |
| **Google Workspace** | V2 | V3 | Requires 100+ seats + 4+ week approval |
| **Payment model** | Unclear | Hybrid: reseller for domains, BYOA for GitHub/CF | Clarified based on API capabilities |

### What Stayed the Same ✓

- **DNS wiring** remains the highest-value operation (fully feasible)
- **CLI architecture** (thin client + server-side workers + SSE streaming)
- **State machine design** (Postgres JSONB + BullMQ workers)
- **Target users** (vibe-coders, founders, AI agents, serial builders)
- **Core value prop** ("opinionated correctness" for startup infrastructure)

### Technical Feasibility Confirmed ✅

**V1 MVP (4 weeks) is 100% buildable** with no blockers:
- ✅ Namecheap Reseller API is proven, documented, $50 barrier to entry
- ✅ GitHub guided flow is acceptable UX (15s browser step)
- ✅ Cloudflare DNS API fully accessible via user OAuth
- ✅ DNS wiring is pure API calls (no external dependencies)
- ✅ Stripe payment flow is standard SaaS integration

**V2 (Vercel/Railway) is confirmed feasible** via official APIs.

**V3 (Google Workspace/AWS) is aspirational** but not required for product validation.

### Why This Matters

The v0.2 spec represents a **shippable MVP**. Every service integration has a confirmed, publicly accessible API. No partnerships, no enterprise contracts, no waiting for approvals. This can be built and launched in 4 weeks.

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

### Common Issues

**"Module not found" errors in CLI:**
- Ensure you're using `.js` extensions in imports: `import { foo } from './bar.js'`
- CLI uses NodeNext module resolution which requires explicit extensions

**Redis connection errors:**
- Check Redis is running: `redis-cli ping` (should return `PONG`)
- Verify `REDIS_URL` in `.env` matches your Redis setup
- Default: `redis://localhost:6379`

**Database migration errors:**
- Ensure PostgreSQL is running and accessible
- Check `DATABASE_URL` format: `postgresql://user:pass@host:port/database`
- Run migrations: `npm run db:migrate -w packages/api`

**"Rate limit exceeded" during development:**
- Namecheap sandbox API has 20 req/min limit
- Rate limiter is Redis-backed, persists across restarts
- Clear Redis: `redis-cli FLUSHDB` (use cautiously)

**BullMQ worker not processing jobs:**
- Ensure Redis is running and connected
- Check worker logs for errors
- Verify queue name matches: `domainQueue` (defined in `packages/api/src/lib/queues.ts`)

**CLI can't connect to API:**
- Verify API server is running: `npm run dev -w packages/api`
- Check API_URL matches CLI configuration (default: `http://localhost:3000`)
- Test health endpoint: `curl http://localhost:3000/health`

### Debug Mode

**Enable verbose logging in CLI:**
```bash
# CLI has logger with different levels
# Logs are output to console with chalk formatting
FORJ_DEV=1 node packages/cli/dist/cli.js init test
```

**Enable Pino pretty-printing in API:**
```bash
# Already enabled in development mode
NODE_ENV=development npm run dev -w packages/api
```

**Access Bull Board (queue monitoring):**
```bash
# Set in .env
ENABLE_BULL_BOARD=true

# Access at http://localhost:3000/queues
# WARNING: No authentication - only use in local dev
```

## References

- Full specification: `project-docs/forj-spec.md` (v0.2 - March 2026)
- Namecheap integration spec: `project-docs/namecheap-integration-spec.md`
- Build plan with phases: `project-docs/build-plan.md`
