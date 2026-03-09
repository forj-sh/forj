# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Forj** is an infrastructure provisioning CLI tool that creates production-ready project infrastructure with a single command. The value proposition is: `npx forj init my-startup` provisions domain registration (Namecheap), GitHub repos, Cloudflare DNS zone, and automatically wires all DNS records (MX, SPF, DKIM, DMARC) correctly in under 2 minutes.

This project is currently in the **specification phase** with no code implementation yet. The complete product specification is in `project-docs/forj-spec.md` (currently v0.2 - updated after API feasibility assessment).

## Technical Feasibility: ✅ CONFIRMED

**V1 MVP is 100% technically feasible** with publicly available APIs. All critical blockers from v0.1 have been resolved:

- ✅ **Domain registration**: Namecheap Reseller API ($50 deposit, well-documented)
- ✅ **GitHub repos**: Guided manual org creation (15s), then full automation via OAuth
- ✅ **Cloudflare DNS**: User's own account, full API access for zone/record management
- ✅ **DNS wiring**: Pure API calls to Cloudflare, no blockers
- ✅ **Payment flow**: Stripe as merchant, Namecheap wholesale billing, clean margins

**V2 additions** (Vercel, Railway) also confirmed feasible with official APIs.

## Architecture (Planned)

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

## Planned Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js + TypeScript | Native fit for API integrations, strong typing |
| API Framework | Fastify | Fast, schema-native, good SSE support |
| Queue | BullMQ + Redis | Reliable job processing, retry semantics |
| Database | Postgres | JSONB for flexible state, battle-tested |
| CLI | commander.js + inquirer | Interactive CLI standard |
| Auth | jose (JWT) + Node crypto AES-256-GCM | Token encryption, short-lived sessions |
| Deployment | Railway or Render | Low ops, managed Postgres + Redis |
| Domain API | Namecheap Reseller API | Established reseller program, $50 deposit, competitive wholesale pricing |
| Payments | Stripe Checkout | Single transaction for domain + service fee |
| DNS Validation | dns.resolve() + dnspropagation.net API | Post-provision record verification |

## Key Service Integrations (by Phase)

### V1 MVP - Core Infrastructure

**Domain Registration (Namecheap Reseller API)**
- Forj acts as true reseller: buys wholesale, sells at market rate
- Setup: $50 deposit OR 20+ domains in account
- API endpoints: `namecheap.domains.check` (availability), `namecheap.domains.create` (registration)
- Payment flow: User pays Forj via Stripe → Forj pays Namecheap wholesale → ~15% margin
- Fallback: GoDaddy Reseller API if Namecheap has issues

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
$ npx forj init acme

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
npx forj init acme \
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

## Build Plan (4 Week MVP → V2 → V3)

### V1 - 4 Week MVP (Core Infrastructure)

**Week 1:** Core API + Workers
- Fastify API + Postgres + BullMQ + Redis scaffold
- Auth: GitHub OAuth + Cloudflare OAuth + token encryption
- Domain worker: Namecheap Reseller API (availability check + registration)
- GitHub worker: guided org confirmation → repo creation + branch protection
- Cloudflare worker: zone creation via user OAuth
- State machine: Postgres JSONB-backed service status tracking
- SSE event emitter for real-time provisioning updates

**Week 2:** DNS Wiring + CLI
- DNS wiring worker: auto-configure MX, SPF, DKIM, DMARC, CNAME after services complete
- DNS health checker: validate records via `dns.resolve()`
- CLI client: interactive mode with guided GitHub org step + SSE stream rendering
- Credential handoff: encrypt → display once → purge
- `.forj/credentials.json` generation + `.gitignore` injection
- `forj status` command

**Week 3:** Agent Mode + Polish
- `--non-interactive` flag: skip prompts, use flag values
- `--json` flag: structured output for AI agents
- `--github-org` flag: skip guided step for existing orgs
- Error handling: partial failure recovery, per-worker retry with exponential backoff
- `forj add <service>` command for post-init provisioning
- `forj dns check` / `forj dns fix` commands
- API key auth + rate limiting
- Stripe checkout: domain fee + service fee in single transaction

**Week 4:** Ship
- Landing page + CLI demo GIF
- `npm publish` to registry
- Show HN post + dev Twitter launch
- 50 projects provisioned target

### V2 - Deployment Platforms (Post-Validation)
- Vercel worker: create project, link repo, set custom domain
- Railway worker: create project, link repo, optional Postgres
- DNS wiring updates: auto-add Vercel/Railway CNAMEs
- `forj add vercel` / `forj add railway` commands

### V3 - Enterprise & Recurring Revenue (Post-Scale)
- Google Workspace reseller application (start at launch, not before)
- Google Workspace worker: provision org, users, billing via Reseller API
- AWS enterprise tier: cross-account IAM for teams that outgrew Vercel/Railway

See `project-docs/forj-spec.md` Section 8 for detailed milestone checklists.

## Development Workflow

### Git Workflow: Graphite Stacking Method

**IMPORTANT**: All feature development MUST follow the Graphite stacking methodology for incremental, reviewable PRs.

#### What is Graphite Stacking?

Graphite stacking is a development workflow where you break large features into small, sequential pull requests that build on top of each other. Each PR (or "stack") is independently reviewable and mergeable.

#### Why Use Graphite?

- **Incremental review**: Reviewers can approve small, focused changes instead of massive diffs
- **Parallel work**: Other devs can build on your lower stacks while upper stacks are still in review
- **Easier debugging**: Isolate issues to specific stacks
- **Better git history**: Each stack represents a logical unit of work
- **Faster iteration**: Merge lower stacks while refining upper ones

#### Graphite Workflow Steps

**1. Plan your stacks before coding**
Break your feature into logical, sequential units. Each stack should:
- Be independently testable
- Build on the previous stack
- Represent a complete logical unit
- Be small enough to review in < 10 minutes

Example: Landing page in 5 stacks:
- Stack 1: Monorepo foundation
- Stack 2: Vite + TypeScript setup
- Stack 3: UI component conversion
- Stack 4: Email waitlist functionality
- Stack 5: Spam protection + deployment

**2. Create branches for each stack**

```bash
# Start from main
git checkout main

# Create Stack 1 branch and make commits
git checkout -b stack-1-feature-name
# ... make changes ...
git add -A && git commit -m "Stack 1: Description"
git push -u origin stack-1-feature-name

# Create Stack 2 branch FROM Stack 1
git checkout -b stack-2-next-feature stack-1-feature-name
# ... make changes ...
git add -A && git commit -m "Stack 2: Description"
git push -u origin stack-2-next-feature

# Continue for all stacks...
```

**3. Create PRs in dependency order**

```bash
# PR #1: Stack 1 → main
gh pr create --base main --head stack-1-feature-name --title "Stack 1: ..." --body "..."

# PR #2: Stack 2 → Stack 1 (depends on PR #1)
gh pr create --base stack-1-feature-name --head stack-2-next-feature --title "Stack 2: ..." --body "..."

# PR #3: Stack 3 → Stack 2 (depends on PR #2)
# etc...
```

**4. PR template for stacks**

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

**5. Merging stacks**

Once a lower stack is approved:
1. Merge Stack 1 → main
2. Update Stack 2's base to main: `gh pr edit <PR#> --base main`
3. Merge Stack 2 → main
4. Continue up the stack

**6. What NOT to do**

❌ **Don't commit everything to main first, then create PRs** (defeats the purpose)
❌ **Don't make stacks too large** (> 500 lines of changes)
❌ **Don't make stacks too granular** (< 50 lines, unless critical)
❌ **Don't create stacks with unclear dependencies**

#### Example: Landing Page Implementation (Correct Way)

```bash
# Stack 1: Monorepo foundation
git checkout -b stack-1-monorepo
# ... create package structure, workspace config ...
git commit -m "Stack 1: Initialize monorepo structure"
git push -u origin stack-1-monorepo
gh pr create --base main --head stack-1-monorepo

# Stack 2: Build on Stack 1
git checkout -b stack-2-vite stack-1-monorepo
# ... add Vite config, TypeScript setup ...
git commit -m "Stack 2: Set up Vite + TypeScript"
git push -u origin stack-2-vite
gh pr create --base stack-1-monorepo --head stack-2-vite

# Continue pattern for remaining stacks...
```

### Current Repository State

The landing page (`packages/landing`) has been implemented and is on main. Future feature work should follow the Graphite stacking method outlined above.

### Project Structure (Expected)
```
/packages
  /cli          - CLI client (commander.js + inquirer)
  /api          - Fastify API server
  /workers      - BullMQ worker implementations
  /shared       - Shared types, utilities
/infrastructure - Deployment configs
```

### Common Commands (Once Implemented)
```bash
# Development
npm run dev          # Start API server + workers in watch mode
npm run dev:cli      # Run CLI in development

# Testing
npm test             # Run all tests
npm test -- <file>   # Run specific test file

# Database
npm run db:migrate   # Run Postgres migrations
npm run db:seed      # Seed development data

# Build & Deploy
npm run build        # Compile TypeScript for all packages
npm run deploy       # Deploy to Railway/Render
```

## Security Considerations

1. **Never persist credentials post-handoff** — Encrypt with AES-256-GCM, deliver once, purge immediately
2. **Audit all OAuth token access** — Log every read/use of GitHub/Cloudflare tokens
3. **Validate all external API responses** — Never trust GitHub/Cloudflare/Namecheap API data without schema validation
4. **Namecheap API keys** — Store encrypted at rest, rotate regularly, use separate keys per environment
5. **Rate limiting** — Implement per-user and per-IP rate limits from day one
6. **Stripe webhook verification** — Always verify webhook signatures to prevent payment manipulation
7. **Penetration test before public launch** — Credential handoff flow is primary attack surface

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

## References

- Full specification: `project-docs/forj-spec.md` (v0.2 - March 2026)
- No existing codebase — start from scratch following tech stack above
- No git repository initialized yet
