# @forj/api

Forj API server — Orchestrates infrastructure provisioning workflows.

## Status

🚧 **Coming Soon** — Implementation planned for V1 MVP (Week 1-2)

See `project-docs/forj-spec.md` for detailed specifications.

## Planned Features

- Fastify HTTP server
- GitHub OAuth + Cloudflare OAuth
- SSE event streaming for real-time provisioning updates
- Postgres database with JSONB state tracking
- BullMQ job queue integration
- Credential encryption/handoff (AES-256-GCM)
- Stripe payment integration

## Tech Stack (Planned)

- Fastify (HTTP framework)
- Postgres (state storage with JSONB)
- BullMQ + Redis (job queue)
- jose (JWT authentication)
- Node crypto (AES-256-GCM encryption)

## API Endpoints (Planned)

- `POST /auth/github` - GitHub OAuth flow
- `POST /auth/cloudflare` - Cloudflare OAuth flow
- `POST /projects` - Create provisioning job
- `GET /projects/:id/stream` - SSE provisioning events
- `GET /projects/:id/status` - Project state
- `GET /domains/check` - Domain availability
- `GET /dns/health/:projectId` - DNS health check
