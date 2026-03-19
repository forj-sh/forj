# Forj — Product Specification
**Infra Provisioning CLI: One command. Production-ready project infrastructure.**

> v0.2 — Updated after API feasibility assessment | March 2026

---

## Table of Contents

1. [Name Candidates](#1-name-candidates)
2. [Problem Statement](#2-problem-statement)
3. [Target User](#3-target-user)
4. [CLI Experience](#4-cli-experience)
5. [System Architecture](#5-system-architecture)
6. [Service Integrations](#6-service-integrations)
7. [API Specification](#7-api-specification)
8. [Build Plan — MVP](#8-build-plan--mvp)
9. [Tech Stack](#9-tech-stack)
10. [Pricing & Monetization](#10-pricing--monetization)
11. [Risks & Mitigations](#11-risks--mitigations)
12. [Pre-Build Validation](#12-pre-build-validation)

---

## 1. Name Candidates

Goal: short, dev-native, memorable in terminal context. Should feel at home next to greptile, graphite, turso, fly.

### Tier 1 — Strongest

| Name | npx | Angle | Vibe |
|---|---|---|---|
| **Forj** | `npx forj` | Forge + project — creation energy, one syllable | Strong, industrial, dev-native |
| Stackr | `npx stackr` | Your stack, provisioned | Modern, SaaS-y, clear |
| Spinup | `npx spinup` | Literal, imperative, does what it says | Functional, direct, CLI-natural |
| Launchkit | `npx launchkit` | Formation-adjacent, clear value | Startup-y, friendly, slightly long |

### Tier 2 — Worth Considering

| Name | npx | Note |
|---|---|---|
| Scaff | `npx scaff` | Scaffolding — established dev metaphor, extremely short |
| Plinth | `npx plinth` | Foundation/base — obscure but memorable, great aesthetics |
| Originate | `npx originate` | Clean verb, formation-native — but long for CLI |
| Runway | `npx runway` | Strong startup connotation — conflicts with Runway AI |

> **Recommendation: Forj.** One syllable, memorable, domain likely available, forge metaphor is perfect for infrastructure creation. `npx forj init my-startup` reads cleanly.

---

## 2. Problem Statement

Every new startup or serious side project goes through the same 2–3 day infrastructure setup ritual that has nothing to do with building the actual product.

The checklist is always identical:
- Register a domain
- Create a GitHub org and initial repos
- Set up Cloudflare account and DNS zone
- Configure Google Workspace
- Wire DNS records — MX, SPF, DKIM, CNAME — across services
- Connect a deployment platform (Vercel, Railway) to the repo

None of these steps are hard individually. The problem is threefold:

**Repetition** — Every founder, every project, does this work from scratch. There is no reusable layer.

**Under-informed decisions** — Founders choose org names, domain structures, and deployment configurations at the worst possible moment — under excitement, with no guidance on what "good" looks like. Wrong decisions are painful to undo.

**Unwired configuration** — Each service is provisioned in isolation. DNS records connecting them are almost always wrong or incomplete — especially email auth (SPF, DKIM, DMARC) which silently causes deliverability problems for months.

> **The unlock is not just speed. It is opinionated correctness.** `forj init` gives founders the infrastructure a strong senior engineer would build — and most early-stage teams don't have that person on day one.

---

## 3. Target User

| Segment | Who | Why They Pay |
|---|---|---|
| Vibe-coders / Solo devs | Non-traditional devs spinning up projects fast, often with AI assistance | Skip setup entirely, get to building |
| Early-stage founders | Technical co-founders at 0→1 stage post-incorporation | Correct defaults, no-regrets infrastructure |
| AI coding agents | Cursor, Claude Code, Windsurf completing project scaffolding | Programmatic, non-interactive, JSON output |
| Serial builders | Devs who start many projects, agencies, freelancers | One-line repeatable setup per project |
| Accelerator cohorts | YC, Techstars, On Deck batches (via white-label) | Uniform baseline for all companies in batch |

---

## 4. CLI Experience

### 4.1 Interactive Mode

Primary mode for human developers. Guided, opinionated, fast.

```bash
$ npx forj init acme

  ✦ forj — project infrastructure provisioning

  ? Company / project name:  Acme Inc
  ? Desired domain:  (checking availability...)
    ✓ acme.io          — $9.95/yr
    ✓ getacme.com      — $12.95/yr
    ✗ acme.com         — taken
  ? Select domain:  getacme.com

  ? Services to provision:
    ✓ Domain registration   (Namecheap reseller)
    ✓ GitHub org + repos    (github.com/getacme)
    ✓ Cloudflare zone + DNS wiring
    ✓ Vercel project        (linked to GitHub)
    ○ Google Workspace      (apply at forj.dev/reseller)

  ! GitHub org must be created manually — takes 15 seconds.
    Opening github.com/organizations/new ...
    ? GitHub org name (confirm when created):  getacme
    ✓ GitHub org confirmed

  Provisioning...
    ✓  Domain registered          getacme.com
    ✓  GitHub repos created       github.com/getacme/app
    ✓  Cloudflare zone active     getacme.com
    ✓  DNS wired                  MX · SPF · DKIM · CNAME
    ✓  Vercel project linked      getacme.vercel.app

  Credentials → .forj/credentials.json  (gitignored ✓)

  Setup complete in 2m 14s
  Run `forj status` to see your stack.
```

### 4.2 Non-Interactive Mode (Agent-Ready)

Fully scriptable. Designed to be called by AI coding agents as a tool. All flags override interactive prompts.

```bash
$ npx forj init acme \
    --domain getacme.com \
    --services github,cloudflare,domain \
    --github-org getacme \
    --non-interactive \
    --json
```

JSON response shape:

```json
{
  "status": "complete",
  "project": "acme",
  "duration_ms": 112340,
  "services": {
    "domain":     { "status": "ok", "value": "getacme.com" },
    "github":     { "status": "ok", "value": "github.com/getacme" },
    "cloudflare": { "status": "ok", "zone_id": "abc123" },
    "dns":        { "status": "ok", "records": ["MX", "SPF", "DKIM", "CNAME"] }
  },
  "credentials_path": ".forj/credentials.json"
}
```

### 4.3 Status Command

```bash
$ forj status

  acme / getacme.com
  ─────────────────────────────────────
  Domain       ✓  getacme.com  (renews 2027-03-01)
  GitHub       ✓  github.com/getacme  (3 repos)
  Cloudflare   ✓  Zone active · 6 DNS records
  DNS health   ✓  SPF · DKIM · MX all valid
  Vercel       ✓  getacme.vercel.app  (linked to main)
  Google WS    –  Not provisioned
  Railway      –  Not provisioned
```

### 4.4 Additional Commands

```bash
forj add google-workspace   # add a service post-init
forj add vercel             # link Vercel project
forj add railway            # create Railway project
forj dns check              # validate DNS record health
forj dns fix                # attempt auto-repair of broken records
```

---

## 5. System Architecture

### 5.1 Design Principles

- **CLI is a thin client** — all orchestration is server-side. CLI authenticates, sends config, streams events back. Iterate on provisioning logic without CLI releases.
- **Idempotent workers** — each service worker can be re-run safely. Partial failures never corrupt state.
- **State machine per project** — each service has independent state: `pending → running → complete | failed`.
- **Credentials are ephemeral** — created, delivered once, purged from server. Never persisted post-handoff.
- **DNS wiring is a first-class operation** — not an afterthought bolted onto each service worker.

### 5.2 Component Map

```
┌─────────────────────────────────────────────────────┐
│                    CLI Client                        │
│   npx forj init  →  auth token  →  stream events   │
└──────────────────────────┬──────────────────────────┘
                           │ HTTPS + SSE
┌──────────────────────────▼──────────────────────────┐
│                   API Server                         │
│  POST /projects         →  create job               │
│  GET  /projects/:id/stream  →  SSE event stream     │
│  GET  /projects/:id/status  →  current state        │
└──────┬──────────────────────────┬────────────────────┘
       │                          │
┌──────▼──────┐         ┌─────────▼──────────┐
│  Job Queue  │         │   State Store       │
│  (BullMQ    │         │   (Postgres)        │
│   + Redis)  │         │   projects table    │
└──────┬──────┘         │   services JSONB    │
       │                └─────────────────────┘
       │  workers
┌──────┴────────────────────────────────────────┐
│              Worker Pool                       │
│                                                │
│  ┌──────────────┐  ┌──────────┐  ┌──────────┐ │
│  │Domain Worker │  │ GitHub   │  │Cloudflare│ │
│  │(CF Registrar)│  │ Worker   │  │ Worker   │ │
│  └──────┬───────┘  └────┬─────┘  └────┬─────┘ │
│         └───────────────┴─────────────┘        │
│                         │                      │
│               ┌─────────▼────────┐             │
│               │  DNS Wiring      │             │
│               │  Worker          │             │
│               │  (runs after     │             │
│               │  all services)   │             │
│               └─────────┬────────┘             │
└─────────────────────────┼──────────────────────┘
                           │
              ┌────────────▼───────────┐
              │  Credential Handoff    │
              │  encrypt → deliver     │
              │  → purge from DB       │
              └────────────────────────┘
```

### 5.3 Data Model

```sql
-- Projects table
CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  name          TEXT NOT NULL,
  domain        TEXT,
  status        TEXT CHECK (status IN ('pending','running','complete','failed')),
  services      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- services JSONB shape per project:
-- {
--   "domain":     { "status": "complete", "value": "getacme.com", "meta": {} },
--   "github":     { "status": "running",  "value": null, "meta": {} },
--   "cloudflare": { "status": "pending",  "value": null, "meta": {} },
--   "dns":        { "status": "pending",  "value": null, "meta": {} }
-- }

-- Credentials table — ephemeral
CREATE TABLE credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id),
  payload_enc   TEXT NOT NULL,  -- AES-256 encrypted, key never stored server-side
  delivered_at  TIMESTAMPTZ,
  purged_at     TIMESTAMPTZ
);
```

---

## 6. Service Integrations

### 6.1 API Feasibility — Confirmed

| Service | Model | Mechanism | Phase |
|---|---|---|---|
| Domain (Namecheap Reseller) | forj buys wholesale, resells | Namecheap Reseller API — $50 deposit, no domain minimum | V1 |
| GitHub repos + config | User's own org, forj configures | User creates org manually (15s), forj takes over via OAuth | V1 |
| Cloudflare Zone + DNS | User's own account, forj configures | User OAuth → zone create + record management | V1 |
| DNS Wiring Layer | Internal operation | Reads provisioned services, writes correct records to CF zone | V1 |
| Vercel | User's own account, forj configures | Vercel API — create project, link GitHub repo, set domain | V2 |
| Railway | User's own account, forj configures | Railway API — create project, link repo, provision services | V2 |
| Google Workspace | True reseller — high barrier | Google Reseller API — requires 100+ seats + certifications + 4+ week review | V3 |
| AWS | Explicitly out of scope | Most V1 users deploy on Vercel/Railway. AWS is a Series A problem. | V3 |

> **Note on AWS:** The default stack for a startup launching today is Vercel + Railway, not AWS. AWS introduces unnecessary complexity at 0→1. Forj targets founders who are building, not operating infrastructure. AWS can be added as an enterprise/growth tier once the core product is validated.

### 6.2 GitHub Guided Flow

GitHub org creation is not available via API on github.com. The UX solution is a guided pause — not a blocker.

```
1. CLI detects GitHub org needed
2. Opens browser to:  github.com/organizations/new
3. Shows in terminal:  "Create your org, then return here"
4. User creates org (15 seconds in browser)
5. CLI prompts:  "? GitHub org name (confirm when created):"
6. User types org name → CLI verifies org exists via API
7. Worker fires: creates repos, sets branch protection, configures .github
8. Provisioning continues
```

The configuration forj handles after org creation is where the value is — repo structure, branch protection, default settings, GitHub Pages CNAME. None of that is possible without forj.

### 6.3 Domain Registration — Namecheap Reseller API

Replaces original Cloudflare Registrar spec (Cloudflare has no reseller program).

- **Setup:** Namecheap reseller account, $50 deposit, no domain volume minimum
- **API:** `namecheap.domains.check` for availability, `namecheap.domains.create` for registration
- **Billing model:** forj pays Namecheap at wholesale, charges customer at slight markup (~15% margin)
- **Renewals:** forj auto-renews via Stripe subscription, charges customer annually
- **Fallback:** GoDaddy reseller API as secondary if Namecheap has issues

### 6.4 DNS Wiring — Auto-Configured Records

The highest-value operation in V1. Founders almost never get this right manually.

| Record | Type | Purpose | Value |
|---|---|---|---|
| `@` | A / CNAME | Root domain | Cloudflare proxied / Vercel if provisioned |
| `www` | CNAME | www redirect | → root domain |
| `@` | MX | Email routing | Google Workspace MX (or placeholder) |
| `@` | TXT | SPF | `v=spf1 include:_spf.google.com ~all` |
| `google._domainkey` | TXT | DKIM | Google Workspace DKIM key (auto-fetched) |
| `_dmarc` | TXT | DMARC baseline | `v=DMARC1; p=none; rua=mailto:dmarc@{domain}` |
| `pages` | CNAME | GitHub Pages | → `{org}.github.io` if GitHub provisioned |
| `vercel` | CNAME | Vercel deployment | → `cname.vercel-dns.com` if Vercel provisioned |

### 6.5 Vercel Integration (V2)

Vercel has a full provisioning API. Post-V1 addition with high relevance to the target user.

```
1. User OAuth → grants Vercel API access
2. Worker creates Vercel project linked to GitHub org/repo
3. Sets custom domain → getacme.com → Vercel project
4. DNS wiring layer adds Vercel CNAME to Cloudflare zone
5. Vercel SSL auto-provisions via Let's Encrypt
```

### 6.6 Railway Integration (V2)

For founders who need a backend or database. Railway API supports project + service creation.

```
1. User OAuth → grants Railway API access  
2. Worker creates Railway project
3. Links to GitHub repo for auto-deploy
4. Optionally provisions Postgres service
5. Stores Railway project URL in forj state
```

---

## 7. API Specification

### 7.1 Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/github` | Initiate GitHub OAuth — returns redirect URL |
| `POST` | `/auth/cloudflare` | Initiate Cloudflare OAuth |
| `GET` | `/auth/callback/:provider` | OAuth callback handler |
| `POST` | `/projects` | Create project, enqueue provisioning job |
| `GET` | `/projects/:id` | Get project state |
| `GET` | `/projects/:id/stream` | SSE stream of provisioning events |
| `POST` | `/projects/:id/retry/:service` | Retry a failed service worker |
| `GET` | `/projects/:id/credentials` | Retrieve credentials (one-time, then purge) |
| `GET` | `/domains/check?name=acme` | Domain availability + pricing |
| `GET` | `/dns/health/:projectId` | Validate DNS records post-provision |

### 7.2 SSE Event Schema

```
event: service_update
data: {
  "service": "github",
  "status": "complete",
  "message": "Org created: github.com/getacme",
  "timestamp": "2026-03-08T14:23:11Z"
}

event: service_failed
data: {
  "service": "cloudflare",
  "status": "failed",
  "error": "Rate limited — retrying in 5s",
  "retryable": true
}

event: complete
data: { "status": "complete", "duration_ms": 112340 }
```

### 7.3 POST /projects Request Body

```json
{
  "name": "acme",
  "domain": "getacme.com",
  "services": ["domain", "github", "cloudflare", "dns"],
  "options": {
    "github_org": "getacme",
    "github_default_repos": ["app", ".github"],
    "github_branch_protection": true
  }
}
```

---

## 8. Build Plan — MVP

### Week 1 — Core API + Workers

- [ ] Project scaffold: Node/TypeScript + Fastify + Postgres + BullMQ + Redis
- [ ] Auth module: GitHub OAuth + Cloudflare OAuth + token encryption at rest
- [ ] Domain worker: Namecheap Reseller API — availability check + registration
- [ ] GitHub worker: guided org confirmation, then repo creation + branch protection
- [ ] Cloudflare worker: zone creation via user OAuth
- [ ] State machine: Postgres-backed, per-service status tracking
- [ ] SSE event emitter: stream provisioning events to connected clients

**Milestone:** Can provision domain + GitHub repos + Cloudflare zone via API call

### Week 2 — DNS Wiring + CLI

- [ ] DNS wiring worker: auto-configure all records after service provisioning completes
- [ ] DNS health checker: validate records via DNS lookup post-provision
- [ ] CLI client (`npx forj`): interactive mode with guided GitHub org step + real-time SSE stream
- [ ] Credential handoff: encrypt → display once → purge flow
- [ ] `.forj/credentials.json` generation + automatic `.gitignore` injection
- [ ] `forj status` command

**Milestone:** `npx forj init` works end-to-end on a real project including the GitHub guided step

### Week 3 — Agent Mode + Polish

- [ ] `--non-interactive` flag: skip all prompts, use flag values only
- [ ] `--json` flag: structured JSON output for agent consumption
- [ ] `--github-org` flag: skip guided step when org already exists (agent use case)
- [ ] Error handling: partial failure recovery, per-worker retry with backoff
- [ ] `forj add <service>` command: post-init provisioning
- [ ] `forj dns check` / `forj dns fix` commands
- [ ] API key auth: per-user key + JWT for CLI session
- [ ] Basic rate limiting
- [ ] Stripe checkout: domain registration fee + forj service fee in single transaction

**Milestone:** Claude Code / Cursor can call `forj` in non-interactive mode successfully

### Week 4 — Ship

- [ ] Landing page: `npx forj` in hero, CLI demo GIF, one-line value prop
- [ ] `npm publish`: forj package on npm registry
- [ ] HN Show HN post + dev Twitter launch
- [ ] Delaware public records scrape: newly incorporated companies as cold outreach targets
- [ ] Free tier live, Pro/Agent waitlist with email capture

**Milestone:** 50 projects provisioned, public feedback collected

### V2 — Deployment Platform Integrations (post-validation)

- [ ] Vercel worker: create project, link GitHub repo, set custom domain
- [ ] Railway worker: create project, link repo, optional Postgres service
- [ ] DNS wiring updates: add Vercel CNAME + Railway entries automatically
- [ ] `forj add vercel` / `forj add railway` commands

### V3 — Reseller Revenue (post-scale)

- [ ] Google Workspace reseller application (start process at launch, not before)
- [ ] Google Workspace worker: provision org, users, billing via Reseller API
- [ ] AWS enterprise tier: cross-account IAM configuration for teams that have outgrown Vercel/Railway

---

## 9. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js + TypeScript | Native fit for API integrations, strong typing for state machines |
| API Framework | Fastify | Fast, schema-native, good SSE support |
| Queue | BullMQ + Redis | Reliable job processing, retry semantics, delay support |
| Database | Postgres | JSONB for flexible service state, reliable, well-understood |
| CLI | commander.js + inquirer | Standard for interactive CLIs, battle-tested |
| Auth / Tokens | jose (JWT) + Node crypto AES-256-GCM | Credential encryption, short-lived CLI sessions |
| Deployment | Railway or Render | Low ops overhead, managed Postgres + Redis included |
| Domain API | Namecheap Reseller API | Established reseller program, $50 deposit, competitive wholesale pricing |
| DNS Validation | `dns.resolve()` + dnspropagation.net API | Post-provision record verification |

---

## 10. Pricing & Monetization

### Payment Model

forj is the merchant for all billable services. Customer pays forj once via Stripe. forj pays providers at wholesale.

- **Domain registration:** forj pays Namecheap wholesale (~$8-10), charges customer market rate (~$12-15) + small margin
- **Domain renewals:** Stripe subscription, charged annually, auto-renews via Namecheap API
- **forj service fee:** charged at checkout alongside domain, single Stripe transaction
- **Refund policy:** if provisioning fails and cannot be retried, full refund via Stripe. Idempotent retry means this should be rare.

### Tiers

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | 1 project · Domain + GitHub config + Cloudflare + DNS wiring |
| **Pro** | $49 one-time or $99/yr | Unlimited projects · Vercel + Railway integrations · status history · DNS monitoring |
| **Agent** | $199/yr | API key access · non-interactive mode · JSON output · webhooks · priority provisioning |
| **Cohort** | Custom per batch | White-label CLI · bulk provisioning · custom defaults · dedicated support |

### Secondary Revenue Streams

- **Domain reseller margin** — ~15% on registration + renewals. Compounds across portfolio.
- **Google Workspace reseller margin** — ~20% recurring on seat fees. V3 but highest LTV stream.
- **Vercel/Railway affiliate** — one-time referral fees per activated account
- **Stripe affiliate** — one-time per activated account

> **Note on Google Workspace:** Do not wait for reseller approval before launching. Start the application at launch (not before — Google wants to see business activity), and use a referral deep-link as the interim. The reseller program has become more restrictive — expect 4+ weeks and a requirement for ~100 managed seats before approval is likely.

---

## 11. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| GitHub guided org step creates drop-off | Medium | Minimize to single browser open + confirm. Time it: should be under 20s. A/B test copy. |
| Namecheap Reseller API reliability / rate limits | Low | GoDaddy reseller API as hot fallback. Abstract registrar behind interface. |
| Google Workspace reseller application rejected or delayed | Medium | Not launch-blocking. Referral deep-link as interim. Apply after 100 customers. |
| Vercel or Railway build this natively | Medium | Likely long-term. Forj's value is cross-service wiring + DNS, not single-platform setup. Get distribution first. |
| Credential security incident | Low / catastrophic | Never persist post-handoff, encrypt in transit, audit log all access, pen test before launch |
| Low free-to-paid conversion | Medium | $49 one-time is low-friction. Agent tier is B2B — pursue Cursor/Windsurf partnership directly |

---

## 12. Pre-Build Validation

Before writing provisioning code, validate two things.

### Signal 1 — Developer Demand

Post a landing page with the value prop, a CLI screenshot/GIF, and a waitlist CTA. Distribute to:

- Dev Twitter/X: one post showing the CLI demo
- HN: "Ask HN: Would you use a CLI that provisions your full project infra in one command?"
- Indie Hackers, Reddit r/SideProject, r/webdev

**Goal:** 200 waitlist signups before writing a line of provisioning code.

### Signal 2 — Willingness to Pay

Delaware incorporation filings are public record. Scrape newly incorporated companies (last 30 days), identify technical founders on LinkedIn/GitHub, send 50 cold emails with the landing page link.

If 5+ reply with genuine interest or click through to the waitlist, demand signal is real.

> **Two weeks of validation before two weeks of build. The worst outcome is shipping something nobody pays for — not shipping something imperfect.**

---

*End of spec — v0.2*
*Changes from v0.1: Namecheap replaces Cloudflare Registrar · GitHub org creation is guided-manual · Vercel + Railway replace AWS in V2 · AWS moved to V3 enterprise · Google Workspace moved to V3 · Pricing updated to reflect hybrid model · Risks updated*
