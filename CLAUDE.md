# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

```bash
# Development (npm workspaces — use -w flag for all package commands)
npm run dev -w packages/api          # Start API server (localhost:3000)
npm run dev -w packages/cli          # CLI watch mode
node packages/workers/dist/start-workers.js  # Start BullMQ workers (must build first)
npm run dev -w packages/landing      # Landing page dev server

# Testing (API + Workers use Jest, CLI uses tsx --test)
npm test -w packages/api                              # Run all API tests
npm test -w packages/api -- sse-streaming.test.ts     # Run specific test
npm run test:watch -w packages/api                    # Watch mode
npm run test:coverage -w packages/api                 # Coverage report
npm test -w packages/workers                          # Run worker tests
npm test -w packages/cli                              # Run CLI tests (tsx --test)

# Database
npm run db:migrate -w packages/api                    # Run pending migrations
npm run db:migrate:create -w packages/api -- <name>   # Create new migration

# Type checking & build (no linter configured)
npm run type-check -w packages/api      # Check API types
npm run type-check -w packages/cli      # Check CLI types
npm run type-check -w packages/workers  # Check workers types
npm run build                           # Build all packages

# Graphite (REQUIRED for all branch management — never use raw git for branches)
gt create -m "Stack N: Description"   # Create new stack
gt modify                             # Amend current stack
gt restack                            # Rebase all stacks
gt submit                             # Push + create PRs
gt log short                          # View stack tree
```

## Project Overview

**Forj** provisions production-ready project infrastructure with a single command: domain registration (Namecheap), GitHub org + repo, and Cloudflare DNS zone with nameserver configuration — in under 2 minutes. Full spec: `docs/spec.md`. **V1 shipped March 2026** (`forj-cli@1.0.0`).

**Branding:** domain `forj.sh`, GitHub org `forj-sh`, npm package `forj-cli`, CLI invocation `npx forj-cli init acme`.

## Architecture

**Monorepo** with 5 npm workspace packages:

- **`packages/api`** — Fastify server (routes, auth middleware, Stripe, JWT). Depends on `shared`.
- **`packages/workers`** — BullMQ workers (domain, GitHub, Cloudflare, DNS). Depends on `shared`.
- **`packages/cli`** — Thin CLI client (commander + inquirer + SSE). Independent, no internal deps.
- **`packages/shared`** — Shared types + API clients (Namecheap, Cloudflare, GitHub).
- **`packages/landing`** — Landing page (Vite + TypeScript, deployed to Vercel).
- **`api/`** (root) — Vercel serverless functions (waitlist form).

### System Design

1. **CLI is a thin client** — All orchestration is server-side. CLI authenticates, sends config, streams events via SSE.
2. **Idempotent workers** — Each worker can be re-run safely. Partial failures never corrupt state.
3. **State machine per service** — Each service tracks independent state (`pending → running → complete | failed`).
4. **Credentials are ephemeral** — Encrypted, delivered once to CLI, then purged. Never persisted post-handoff.
5. **Cloudflare is DNS authority** — Namecheap is registrar only. All DNS management via Cloudflare API.

### Component Flow

```
CLI → HTTPS + SSE → API Server (Fastify) → BullMQ + Redis → Worker Pool → Postgres (state)
                                         → Stripe (payments)
```

### Provisioning Order (V1 Two-Phase Flow)

```
Phase 1 — Domain purchase:
  1. Domain registered (Namecheap) + Stripe payment

Phase 2 — Services (after domain confirmed):
  2. GitHub org verified + repo created    ← parallel with 3
  3. Cloudflare zone created               ← returns nameserver pair
  4. Nameservers updated (Namecheap → Cloudflare NS)
```

Note: DNS record wiring (MX, SPF, DKIM, DMARC) deferred to future `forj dns setup-email` command.

### Auth Approaches

- **GitHub**: OAuth Device Flow (RFC 8628) — one-time code at `github.com/login/device`, CLI polls until authorized.
- **Cloudflare**: Guided API token creation — user creates custom token with `Account Settings:Read` + `Zone:Read` + `Zone Settings:Edit` + `DNS:Edit`, includes Account Resources + Zone Resources, pastes into CLI.

## Key Constraints

- **ALL Namecheap API calls MUST use `requestQueue.submit()`** for rate limiting (20 req/min).
- **CLI package requires `.js` extensions** in imports (ESM requirement). Other packages omit extensions.
- **`ENABLE_NAMECHEAP_ROUTES=true`** required to mount production domain endpoints.
- **`ENABLE_MOCK_AUTH`** defaults to `false` — mock auth endpoint only enabled when `!isProduction && mockAuthEnabled`.
- **`TRUST_PROXY=false`** for local dev, `true` for production behind Cloudflare (gates proxy header trust).
- **Sentry must be imported FIRST** in `packages/api/src/index.ts` (before Fastify server creation). Custom `errorHandler` must register before `Sentry.setupFastifyErrorHandler`.
- **Environment variables:** See `packages/api/.env.example` for full reference. Notable: separate encryption keys for Cloudflare and GitHub tokens (security isolation), `REQUIRE_PAYMENT` enforced in production.
- **Migrations use numeric timestamps** (e.g., `1741570800000`) not sequential numbers.

## Testing

- Jest with ts-jest preset, ESM support via `NODE_OPTIONS=--experimental-vm-modules`
- Mock strategy: `global.fetch` for HTTP, `jest.fn()` for Redis
- Test files in `__tests__/` directories adjacent to source
- Integration tests require Redis running locally
- Test timeout: 30 seconds (database-heavy tests)
- See `docs/testing-guide.md` for full guide

## Code Patterns

**API responses:** `{ success: boolean, data?: any, error?: string }`

**Worker errors:** Throw to trigger BullMQ retry. Non-retryable errors (PAYMENT, VALIDATION, AUTH) throw `UnrecoverableError` to stop BullMQ retries. Error classes in `packages/shared/src/` use category enums with `isRetryable()` and `getUserMessage()` methods.

**State machines:**
- Domain: PENDING → QUEUED → CHECKING → AVAILABLE → REGISTERING → CONFIGURING → COMPLETE/FAILED
- Cloudflare: PENDING → CREATING_ZONE → ZONE_CREATED → UPDATING_NS → VERIFYING → COMPLETE/FAILED
- GitHub: PENDING → VERIFYING_ORG → CREATING_REPO → CONFIGURING → COMPLETE/FAILED
- DNS: PENDING → WIRING_MX → WIRING_SPF → WIRING_DKIM → WIRING_DMARC → WIRING_CNAME → VERIFYING → COMPLETE/FAILED

**TypeScript:** Strict mode, discriminated unions for job types, `export type` for type exports.

**Data model:** Projects table uses JSONB `services` column + `phase`, `contact_info`, `stripe_session_id` columns. Users table stores encrypted tokens (AES-256-GCM) + `contact_info` (reused across projects). 6 migrations in `packages/api/migrations/`.

**Phone numbers:** Namecheap requires `+CC.NNNNNNNNNN` format (e.g., `+1.5551234567`). The domain worker normalizes plain international format (`+15551234567`) automatically.

**Pricing:** Domain prices shown to users include ICANN fee (wholesale + icannFee). `.ai` pricing not available from Namecheap API.

## Tech Stack

**Backend:** Fastify 4, BullMQ + Redis, Railway Postgres (API/workers), Neon Postgres (landing page), Pino logging
**CLI:** commander.js, inquirer, chalk, ora, eventsource (SSE)
**Integrations:** Namecheap Reseller API, GitHub REST API, Cloudflare API v4, Stripe Checkout, jose (JWT)
**Build:** tsup (esbuild), TypeScript strict mode, Node.js 18+. CLI build adds shebang (`#!/usr/bin/env node`).
**Monitoring:** Sentry (`@sentry/node`) in API, Workers, and CLI (opt-in telemetry)

## Git Workflow

All feature development uses **Graphite CLI (`gt`)** for stacked PRs. Each stack should be independently testable, 50-500 lines, with PR descriptions including Summary, Changes, Stack Context, Dependencies, and Testing sections.

## Formatting

- 2-space indentation, LF line endings, UTF-8 (enforced by `.editorconfig`)
- Trailing whitespace trimmed (except `.md` files)

## References

- Product spec: `docs/spec.md`
- Build plan & phase details: `docs/build-plan.md`
- Testing guide: `docs/testing-guide.md`
- Security review: `docs/security-review.md`
- Production deployment: `docs/deployment.md`
- Railway deployment: `docs/railway-deployment.md`
- MCP integration: `docs/mcp-integration.md`
- Troubleshooting: `docs/troubleshooting.md`
