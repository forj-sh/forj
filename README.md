# forj 鍛冶場

**One command. Production-ready infrastructure.**

`npx forj-cli init my-startup` registers a domain, creates a GitHub org + repo, and sets up Cloudflare as your DNS provider — in under 2 minutes.

---

## Links

- **Website**: [forj.sh](https://forj.sh)
- **GitHub**: [forj-sh/forj](https://github.com/forj-sh/forj)
- **npm**: [forj-cli](https://www.npmjs.com/package/forj-cli)

---

## Quick Start

```bash
# Install globally
npm install -g forj-cli

# Or run directly
npx forj-cli init my-startup
```

## Development

```bash
npm install
npm run db:migrate -w packages/api
npm run build

# Start services (each in a separate terminal)
npm run dev -w packages/api                    # API server on :3000
node packages/workers/dist/start-workers.js    # BullMQ workers
npm run dev -w packages/cli                    # CLI watch mode

# Local testing with --skip-payment (bypasses Stripe)
FORJ_API_URL=http://localhost:3000 node packages/cli/dist/cli.js init --skip-payment

# Run tests
npm test -w packages/api
```

## Repository Structure

```
forj/
├── packages/
│   ├── api/         - Fastify API server (auth, routes, Stripe, JWT)
│   ├── cli/         - CLI client (commander, inquirer, SSE streaming)
│   ├── workers/     - BullMQ workers (domain, GitHub, Cloudflare, DNS)
│   ├── shared/      - Shared types & API clients
│   └── landing/     - Landing page (Vite + TypeScript, forj.sh)
├── docs/            - Documentation
├── scripts/         - Deployment & setup scripts
└── CLAUDE.md        - AI assistant context
```

## Tech Stack

| Package | Technologies |
|---------|-------------|
| **API** | Fastify, TypeScript, Postgres (Neon), BullMQ, Redis, Stripe |
| **CLI** | commander.js, inquirer, chalk, ora, eventsource |
| **Workers** | BullMQ, Namecheap API, GitHub API, Cloudflare API |
| **Shared** | TypeScript, API clients (Namecheap, Cloudflare, GitHub) |
| **Landing** | Vite, TypeScript, Cloudflare Turnstile |

## Documentation

- [Product Specification](./docs/spec.md)
- [Build Plan](./docs/build-plan.md)
- [Testing Guide](./docs/testing-guide.md)
- [Deployment Guide](./docs/deployment.md)
- [MCP Integration](./docs/mcp-integration.md)
- [Security Review](./docs/security-review.md)
- [Troubleshooting](./docs/troubleshooting.md)

## Branding

- **Domain**: forj.sh
- **GitHub org**: forj-sh
- **npm package**: forj-cli
- **CLI**: `npx forj-cli init <project>` or `forj init <project>`

## License

MIT

---

**Built for developers and the agents they work with.**
