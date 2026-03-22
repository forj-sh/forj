# Forj MCP Integration Guide

Public documentation: **https://forj.sh/docs**

This internal guide supplements the public docs with implementation details.

## MCP Server

The Forj API (`api.forj.sh`) serves as an HTTP-based MCP server. The `.mcp.json` in the repo root defines the available tools.

- **Production URL**: `https://api.forj.sh`
- **Local dev**: `http://localhost:3000`

## Authentication

Two methods, same access level:

1. **JWT** — obtained via GitHub OAuth Device Flow (interactive, used by CLI)
2. **API Key** — created via `POST /api-keys` (programmatic, used by agents)

Both use `Authorization: Bearer <token>` header. No tier differentiation — agents and humans have the same access.

## Available MCP Tools

| Tool | Endpoint | Method | Description |
|------|----------|--------|-------------|
| `check_domain_availability` | `/domains/check` | POST | Batch domain availability check (max 50) |
| `initialize_project` | `/projects/create` | POST | Create project for domain purchase |
| `get_project_status` | `/projects/{id}/status` | GET | Project + service status |
| `check_dns_health` | `/projects/{id}/dns/health` | GET | DNS health check |
| `fix_dns_issues` | `/projects/{id}/dns/fix` | POST | Auto-repair DNS records |
| `create_api_key` | `/api-keys` | POST | Create API key (JWT auth only) |
| `list_api_keys` | `/api-keys` | GET | List API keys |
| `rotate_api_key` | `/api-keys/{id}/rotate` | POST | Rotate API key |
| `revoke_api_key` | `/api-keys/{id}` | DELETE | Revoke API key |

## Full Provisioning

The MCP tools handle domain checks, project status, and DNS management. Full provisioning (domain purchase + GitHub + Cloudflare) should use the CLI:

```bash
npx forj-cli init acme \
  --domain getacme.com \
  --services github,cloudflare \
  --github-org acme-inc \
  --whois-privacy \
  --non-interactive \
  --json
```

This handles the full two-phase flow: domain payment via Stripe, then service provisioning.

## Pricing

Pay per project, no subscription:
- Domain registration: wholesale cost + $2 Forj service fee
- GitHub + Cloudflare: free (included)

## Key Changes from Earlier Drafts

- Removed `provision_infrastructure` MCP tool — full provisioning uses the CLI, not a single API call
- Removed Namecheap/GitHub/Cloudflare credential parameters from MCP tools — credentials are handled server-side via OAuth + encrypted storage
- Removed tier-gated access — no separate Agent tier, same access for all users
- Production URL updated to `https://api.forj.sh`
- `initialize_project` endpoint changed from `/projects/init` to `/projects/create`
