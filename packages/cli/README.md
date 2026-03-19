# forj-cli

**One command. Production-ready infrastructure.**

`npx forj-cli init my-startup` provisions domain, GitHub repos, Cloudflare DNS, and wires all email records (MX, SPF, DKIM, DMARC) in under 2 minutes.

## Install

```bash
# Run directly
npx forj-cli init my-startup

# Or install globally
npm install -g forj-cli
forj init my-startup
```

## Features

- Interactive mode with guided prompts
- Non-interactive mode for AI agents (`--non-interactive`, `--json`)
- Domain registration via Namecheap
- GitHub org verification + repo creation
- Cloudflare DNS zone management
- Automatic DNS wiring (MX, SPF, DKIM, DMARC, CNAME)
- Real-time SSE streaming during provisioning
- API key auth for programmatic access

## Commands

```
forj init [project]   Initialize project infrastructure
forj status           Show project infrastructure status
forj add <service>    Add a service to your project
forj dns              Manage DNS records
forj login            Authenticate with Forj
forj logout           Sign out and clear credentials
```

## Agent / CI Usage

```bash
npx forj-cli init my-startup \
  --non-interactive \
  --domain my-startup.com \
  --services domain,github,cloudflare,dns \
  --github-org my-startup \
  --json
```

## Links

- **Website**: [forj.sh](https://forj.sh)
- **GitHub**: [forj-sh/forj](https://github.com/forj-sh/forj)
- **API docs**: [MCP Integration Guide](https://github.com/forj-sh/forj/blob/main/docs/mcp-integration.md)

## License

MIT
