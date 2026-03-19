# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

```bash
# Development (npm workspaces — use -w flag for all package commands)
npm run dev -w packages/api          # Start API server (localhost:3000)
npm run dev -w packages/cli          # CLI watch mode
npm run dev -w packages/workers      # Start BullMQ workers
npm run dev -w packages/landing      # Landing page dev server

# Testing
npm test -w packages/api                              # Run all API tests
npm test -w packages/api -- sse-streaming.test.ts     # Run specific test
npm run test:watch -w packages/api                    # Watch mode
npm run test:coverage -w packages/api                 # Coverage report

# Database
npm run db:migrate -w packages/api                    # Run pending migrations
npm run db:migrate:create -w packages/api -- <name>   # Create new migration

# Type checking & build
npm run type-check -w packages/api    # Check API types
npm run type-check -w packages/cli    # Check CLI types
npm run build                         # Build all packages

# Graphite (REQUIRED for all branch management — never use raw git for branches)
gt create -m "Stack N: Description"   # Create new stack
gt modify                             # Amend current stack
gt restack                            # Rebase all stacks
gt submit                             # Push + create PRs
gt log short                          # View stack tree
```

## Project Overview

**Forj** provisions production-ready project infrastructure with a single command: domain registration (Namecheap), GitHub repos, Cloudflare DNS zone, and DNS records (MX, SPF, DKIM, DMARC) in under 2 minutes. Full spec: `docs/spec.md`.

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

### Provisioning Order

```
1. Domain registered (Namecheap)
2. GitHub org verified + repos created     ← parallel with 3
3. Cloudflare zone created                 ← returns nameserver pair
4. Nameservers updated (Namecheap → Cloudflare NS)
5. DNS records wired (MX, SPF, DKIM, DMARC, CNAME via Cloudflare API)
```

### Auth Approaches

- **GitHub**: OAuth Device Flow (RFC 8628) — one-time code at `github.com/login/device`, CLI polls until authorized.
- **Cloudflare**: Guided API token creation — user creates token with `Zone:Edit` + `DNS:Edit` permissions, pastes into CLI. No standard OAuth2 available for third-party zone management.

## Key Constraints

- **ALL Namecheap API calls MUST use `requestQueue.submit()`** for rate limiting (20 req/min).
- **CLI package requires `.js` extensions** in imports (ESM requirement). Other packages omit extensions.
- **`ENABLE_NAMECHEAP_ROUTES=true`** required to mount production domain endpoints.
- **`ENABLE_MOCK_AUTH`** defaults to `false` — mock auth endpoint only enabled when `!isProduction && mockAuthEnabled`.
- **`TRUST_PROXY=false`** for local dev, `true` for production behind Cloudflare (gates proxy header trust).

## Testing

- Jest with ts-jest preset, ESM support via `NODE_OPTIONS=--experimental-vm-modules`
- Mock strategy: `global.fetch` for HTTP, `jest.fn()` for Redis
- Test files in `__tests__/` directories adjacent to source
- Integration tests require Redis running locally
- See `docs/testing-guide.md` for full guide

## Code Patterns

**API responses:** `{ success: boolean, data?: any, error?: string }`

**Worker errors:** Throw to trigger BullMQ retry. Namecheap errors use 6 categories (AUTH, INPUT, AVAILABILITY, PAYMENT, SYSTEM, NETWORK) with retryability flags.

**State machines:**
- Domain: PENDING → QUEUED → CHECKING → AVAILABLE → REGISTERING → CONFIGURING → COMPLETE/FAILED
- Cloudflare: PENDING → CREATING_ZONE → ZONE_CREATED → UPDATING_NS → VERIFYING → COMPLETE/FAILED
- GitHub: PENDING → VERIFYING_ORG → CREATING_REPO → CONFIGURING → COMPLETE/FAILED
- DNS: PENDING → WIRING_MX → WIRING_SPF → WIRING_DKIM → WIRING_DMARC → WIRING_CNAME → VERIFYING → COMPLETE/FAILED

**TypeScript:** Strict mode, discriminated unions for job types, `export type` for type exports.

**Data model:** Projects table uses JSONB `services` column. Users table stores encrypted tokens (AES-256-GCM). 4 migrations in `packages/api/migrations/`.

## Tech Stack

**Backend:** Fastify 4, BullMQ + Redis, Neon Postgres (serverless), Pino logging
**CLI:** commander.js, inquirer, chalk, ora, eventsource (SSE)
**Integrations:** Namecheap Reseller API, GitHub REST API, Cloudflare API v4, Stripe Checkout, jose (JWT)
**Build:** tsup (esbuild), TypeScript strict mode, Node.js 18+
**Monitoring:** Sentry (`@sentry/node`) in API, Workers, and CLI (opt-in telemetry)

## Git Workflow

All feature development uses **Graphite CLI (`gt`)** for stacked PRs. Each stack should be independently testable, 50-500 lines, with PR descriptions including Summary, Changes, Stack Context, Dependencies, and Testing sections.

## References

- Product spec: `docs/spec.md`
- Build plan & phase details: `docs/build-plan.md`
- Testing guide: `docs/testing-guide.md`
- Security review: `docs/security-review.md`
- Production deployment: `docs/deployment.md`
- Railway deployment: `docs/railway-deployment.md`
- MCP integration: `docs/mcp-integration.md`
- Troubleshooting: `docs/troubleshooting.md`
