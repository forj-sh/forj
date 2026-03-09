# forj 鍛冶場

**Project infrastructure provisioning CLI — One command. Production-ready infrastructure.**

`npx forj-cli init my-startup` provisions domain, GitHub repos, Cloudflare DNS, and automatically wires all DNS records (MX, SPF, DKIM, DMARC) in under 2 minutes.

---

## 🌐 Links

- **Website**: [forj.sh](https://forj.sh)
- **GitHub**: [forj-sh/forj](https://github.com/forj-sh/forj)
- **npm**: forj-cli (coming soon)

---

## 📁 Repository Structure

This is a monorepo containing all Forj components:

```
forj/
├── packages/
│   ├── landing/     - Marketing landing page (Vite + TypeScript)
│   ├── cli/         - CLI client (coming soon)
│   ├── api/         - API server (coming soon)
│   ├── workers/     - BullMQ workers (coming soon)
│   └── shared/      - Shared types & utilities (coming soon)
├── project-docs/    - Product specifications
├── CLAUDE.md        - AI assistant context
└── README.md        - This file
```

## 🚀 Quick Start

### Landing Page (Current Focus)

```bash
# Install dependencies
npm install

# Run landing page locally
npm run dev -w packages/landing

# Build for production
npm run build -w packages/landing
```

## 📖 Documentation

- **Product Specification**: [`project-docs/forj-spec.md`](./project-docs/forj-spec.md) (v0.2)
- **AI Context**: [`CLAUDE.md`](./CLAUDE.md)
- **Landing Page**: [`packages/landing/README.md`](./packages/landing/README.md) (coming soon)

## 🛠️ Tech Stack

| Package | Technologies |
|---------|-------------|
| **Landing** | Vite, TypeScript, Web3Forms, Cloudflare Turnstile |
| **CLI** | Node.js, TypeScript, commander.js, inquirer (planned) |
| **API** | Fastify, TypeScript, Postgres, BullMQ, Redis (planned) |

## 🎯 Current Status

**Phase:** Pre-launch validation
**Goal:** 200 waitlist signups before building MVP

- ✅ Product specification (v0.2)
- ✅ API feasibility assessment
- ✅ Landing page (live at forj.sh)
- ⏳ MVP (4 week build after validation)

## 📦 Branding

- **Domain**: forj.sh
- **GitHub org**: forj-sh
- **npm package**: forj-cli
- **CLI usage**: `npx forj-cli init <project>` or `forj init <project>` (after global install)

## 📝 License

MIT

---

**Built for developers and the agents they work with.**
