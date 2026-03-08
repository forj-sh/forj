# @forj/workers

Forj BullMQ workers — Idempotent service provisioning workers.

## Status

🚧 **Coming Soon** — Implementation planned for V1 MVP (Week 1-2)

See `project-docs/forj-spec.md` for detailed specifications.

## Planned Workers

### V1 Workers
- **Domain Worker** - Namecheap Reseller API integration
- **GitHub Worker** - Repo creation, branch protection, org configuration
- **Cloudflare Worker** - Zone creation via user OAuth
- **DNS Wiring Worker** - Auto-configure MX, SPF, DKIM, DMARC, CNAME records

### V2 Workers
- **Vercel Worker** - Project creation, repo linking, domain setup
- **Railway Worker** - Project creation, repo linking, Postgres provisioning

### V3 Workers
- **Google Workspace Worker** - Provision org, users, billing (reseller API)
- **AWS Worker** - Cross-account IAM configuration

## Design Principles

- **Idempotent** - Workers can be re-run safely without side effects
- **State machine** - Each service tracks state: `pending → running → complete | failed`
- **Retry with backoff** - Exponential backoff for transient failures
- **Event emission** - Real-time SSE events for CLI/UI updates

## Tech Stack (Planned)

- BullMQ (job queue)
- Redis (queue backend)
- TypeScript
- Zod (API response validation)
