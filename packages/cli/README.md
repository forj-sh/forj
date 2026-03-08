# @forj/cli

Forj CLI tool — Infrastructure provisioning from the command line.

## Status

🚧 **Coming Soon** — Implementation planned for V1 MVP (Week 1-3)

See `project-docs/forj-spec.md` for detailed specifications.

## Planned Features

- Interactive mode with guided prompts
- Non-interactive mode for AI agents (`--json` output)
- Domain registration via Namecheap Reseller API
- GitHub repo creation and configuration
- Cloudflare DNS zone management
- Automatic DNS record wiring (MX, SPF, DKIM, DMARC)
- Real-time SSE event streaming during provisioning

## Tech Stack (Planned)

- Node.js + TypeScript
- commander.js (CLI framework)
- inquirer (interactive prompts)
- EventSource (SSE client)
