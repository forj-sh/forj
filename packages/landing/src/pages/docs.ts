/**
 * Docs page entry point
 *
 * Renders API + CLI documentation for developers and agents.
 * Publicly accessible at forj.sh/docs.
 */

import '../styles/main.css';
import '../styles/docs.css';
import { html } from '../utils/dom';
import { Footer } from '../components/Footer';

function DocsNav(): HTMLElement {
  return html`
    <nav class="nav">
      <a href="/" class="logo">
        <img src="/forj-logo.svg" alt="forj 鍛冶場" class="logo-img" />
      </a>
      <ul class="nav-links">
        <li><a href="#cli-reference">cli</a></li>
        <li><a href="#api-reference">api</a></li>
        <li><a href="#mcp-integration">mcp</a></li>
      </ul>
      <a href="/" class="nav-cta">home →</a>
    </nav>
  `;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App container not found');

app.appendChild(DocsNav());

const docs = document.createElement('article');
docs.className = 'docs';
docs.innerHTML = `
<div class="docs-inner">

<h1>Forj Documentation</h1>
<p class="docs-intro">
  Forj provisions production-ready project infrastructure — domain, GitHub org + repo, and Cloudflare DNS — with a single command. Same access for humans and agents.
</p>

<nav class="docs-toc">
  <div class="section-label">[ CONTENTS ]</div>
  <ul>
    <li><a href="#quickstart">Quickstart</a></li>
    <li><a href="#cli-reference">CLI Reference</a></li>
    <li><a href="#api-reference">API Reference</a></li>
    <li><a href="#mcp-integration">MCP Integration</a></li>
    <li><a href="#pricing">Pricing</a></li>
    <li><a href="#authentication">Authentication</a></li>
    <li><a href="#api-keys">API Keys</a></li>
  </ul>
</nav>

<!-- ═══════════════════════════════════ -->
<section id="quickstart">
  <h2>Quickstart</h2>

  <h3>Interactive (humans)</h3>
  <pre><code>npx forj-cli init</code></pre>
  <p>Walks you through project name, domain selection, payment, and service provisioning.</p>

  <h3>Non-interactive (agents)</h3>
  <pre><code>npx forj-cli init acme \\
  --domain getacme.com \\
  --services github,cloudflare \\
  --github-org acme-inc \\
  --whois-privacy \\
  --non-interactive \\
  --json</code></pre>
  <p>Returns structured JSON output. Requires prior GitHub OAuth and Cloudflare token setup.</p>

  <h3>What gets provisioned</h3>
  <table>
    <thead><tr><th>Service</th><th>What happens</th><th>Cost</th></tr></thead>
    <tbody>
      <tr><td>Domain</td><td>Registered via Namecheap (WHOIS privacy included)</td><td>At-cost + $2 service fee</td></tr>
      <tr><td>GitHub</td><td>Org verified + repo created</td><td>Free</td></tr>
      <tr><td>Cloudflare</td><td>DNS zone created, nameservers configured</td><td>Free</td></tr>
    </tbody>
  </table>
</section>

<!-- ═══════════════════════════════════ -->
<section id="cli-reference">
  <h2>CLI Reference</h2>

  <h3><code>forj init [project-name]</code></h3>
  <p>Initialize project infrastructure.</p>
  <table>
    <thead><tr><th>Flag</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--domain &lt;domain&gt;</code></td><td>Domain name (e.g., "getacme.com")</td></tr>
      <tr><td><code>--services &lt;list&gt;</code></td><td>Comma-separated: github, cloudflare</td></tr>
      <tr><td><code>--github-org &lt;org&gt;</code></td><td>GitHub org name (assumes org exists)</td></tr>
      <tr><td><code>--whois-privacy</code></td><td>Use WHOIS privacy with Forj defaults</td></tr>
      <tr><td><code>--non-interactive</code></td><td>Skip prompts, use flags only</td></tr>
      <tr><td><code>--json</code></td><td>Output JSON (implies --non-interactive)</td></tr>
    </tbody>
  </table>

  <h3><code>forj status</code></h3>
  <p>Show provisioning status for the current project.</p>

  <h3><code>forj dns check</code></h3>
  <p>Check DNS health for the project's domain.</p>

  <h3>JSON output format</h3>
  <pre><code>{
  "status": "complete",
  "project": "acme",
  "domain": "getacme.com",
  "duration_ms": 112340,
  "services": {
    "domain": { "status": "ok", "value": "getacme.com" },
    "github": { "status": "ok", "value": "github.com/acme-inc" },
    "dns": { "status": "ok", "records": ["NS"] }
  },
  "credentials_path": ".forj/credentials.json"
}</code></pre>
</section>

<!-- ═══════════════════════════════════ -->
<section id="api-reference">
  <h2>API Reference</h2>
  <p>Base URL: <code>https://api.forj.sh</code></p>
  <p>Authenticated endpoints require an <code>Authorization: Bearer &lt;token&gt;</code> header. Most accept either a JWT or API key. Some endpoints (e.g., creating API keys) are JWT-only — noted in the tables below.</p>

  <h3>Health</h3>
  <table>
    <thead><tr><th>Method</th><th>Endpoint</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td>GET</td><td><code>/health</code></td><td>No</td><td>Health check with database/queue status</td></tr>
    </tbody>
  </table>

  <h3>Authentication</h3>
  <table>
    <thead><tr><th>Method</th><th>Endpoint</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td>POST</td><td><code>/auth/github/device</code></td><td>No</td><td>Initiate GitHub OAuth Device Flow</td></tr>
      <tr><td>POST</td><td><code>/auth/github/poll</code></td><td>No</td><td>Poll for GitHub OAuth token</td></tr>
      <tr><td>GET</td><td><code>/auth/github/status</code></td><td>Yes</td><td>Check GitHub token status</td></tr>
      <tr><td>POST</td><td><code>/auth/cloudflare</code></td><td>Yes</td><td>Store Cloudflare API token</td></tr>
      <tr><td>GET</td><td><code>/auth/cloudflare/status</code></td><td>Yes</td><td>Check Cloudflare token status</td></tr>
    </tbody>
  </table>

  <h3>Domains</h3>
  <table>
    <thead><tr><th>Method</th><th>Endpoint</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td>POST</td><td><code>/domains/check</code></td><td>Yes</td><td>Check domain availability (batch, max 50)</td></tr>
    </tbody>
  </table>
  <pre><code>curl -X POST https://api.forj.sh/domains/check \\
  -H "Authorization: Bearer \$TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"domains": ["acme.com", "acme.io", "getacme.com"]}'</code></pre>

  <h3>Projects</h3>
  <table>
    <thead><tr><th>Method</th><th>Endpoint</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td>POST</td><td><code>/projects/create</code></td><td>Yes</td><td>Create project for domain purchase</td></tr>
      <tr><td>POST</td><td><code>/projects/:id/contact-info</code></td><td>Yes</td><td>Store ICANN contact info</td></tr>
      <tr><td>POST</td><td><code>/projects/:id/provision-services</code></td><td>Yes</td><td>Start Phase 2 service provisioning</td></tr>
      <tr><td>GET</td><td><code>/projects/:id/status</code></td><td>Yes</td><td>Get project + service status</td></tr>
      <tr><td>GET</td><td><code>/projects/:id/dns/health</code></td><td>Yes</td><td>Check DNS health</td></tr>
      <tr><td>POST</td><td><code>/projects/:id/dns/fix</code></td><td>Yes</td><td>Auto-repair DNS issues</td></tr>
    </tbody>
  </table>

  <h3>Payments</h3>
  <table>
    <thead><tr><th>Method</th><th>Endpoint</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td>POST</td><td><code>/stripe/create-checkout-session</code></td><td>Yes</td><td>Create Stripe checkout for domain purchase</td></tr>
      <tr><td>GET</td><td><code>/stripe/checkout-session/:id</code></td><td>Yes</td><td>Get checkout session status</td></tr>
    </tbody>
  </table>

  <h3>API Keys</h3>
  <table>
    <thead><tr><th>Method</th><th>Endpoint</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td>POST</td><td><code>/api-keys</code></td><td>JWT only</td><td>Create new API key</td></tr>
      <tr><td>GET</td><td><code>/api-keys</code></td><td>Yes</td><td>List API keys</td></tr>
      <tr><td>DELETE</td><td><code>/api-keys/:id</code></td><td>Yes</td><td>Revoke API key</td></tr>
      <tr><td>POST</td><td><code>/api-keys/:id/rotate</code></td><td>Yes</td><td>Rotate API key</td></tr>
    </tbody>
  </table>

  <h3>SSE Events</h3>
  <table>
    <thead><tr><th>Method</th><th>Endpoint</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td>GET</td><td><code>/events/stream/:projectId</code></td><td>Yes</td><td>Real-time provisioning events (Server-Sent Events)</td></tr>
    </tbody>
  </table>
</section>

<!-- ═══════════════════════════════════ -->
<section id="mcp-integration">
  <h2>MCP Integration</h2>
  <p>The Forj API works as an HTTP-based MCP server. AI coding assistants (Claude Code, Cursor, etc.) can call Forj tools directly.</p>

  <h3>Setup</h3>
  <p>Add to your project's <code>.mcp.json</code>:</p>
  <pre><code>{
  "mcpServers": {
    "forj": {
      "type": "http",
      "url": "https://api.forj.sh",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY_HERE"
      }
    }
  }
}</code></pre>

  <h3>Available MCP tools</h3>
  <table>
    <thead><tr><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>check_domain_availability</code></td><td>Check if domains are available (batch)</td></tr>
      <tr><td><code>initialize_project</code></td><td>Create a new project</td></tr>
      <tr><td><code>get_project_status</code></td><td>Get project + service status</td></tr>
      <tr><td><code>check_dns_health</code></td><td>Check DNS health for a project</td></tr>
      <tr><td><code>fix_dns_issues</code></td><td>Auto-repair DNS records</td></tr>
      <tr><td><code>create_api_key</code></td><td>Create a new API key</td></tr>
      <tr><td><code>list_api_keys</code></td><td>List your API keys</td></tr>
      <tr><td><code>rotate_api_key</code></td><td>Rotate an API key</td></tr>
      <tr><td><code>revoke_api_key</code></td><td>Revoke an API key</td></tr>
    </tbody>
  </table>
  <p>Full provisioning (domain purchase + service setup) should use the CLI via <code>npx forj-cli init --non-interactive --json</code>. The MCP tools are best suited for domain checks, status monitoring, and DNS management.</p>
</section>

<!-- ═══════════════════════════════════ -->
<section id="pricing">
  <h2>Pricing</h2>
  <p>Pay per project. No subscription, no tiers.</p>
  <table>
    <thead><tr><th>Item</th><th>Cost</th></tr></thead>
    <tbody>
      <tr><td>Domain registration</td><td>Wholesale cost + $2 Forj service fee</td></tr>
      <tr><td>GitHub org + repo</td><td>Free (included)</td></tr>
      <tr><td>Cloudflare DNS zone</td><td>Free (included)</td></tr>
    </tbody>
  </table>
  <p>Domain prices are fetched live from Namecheap. A typical <code>.com</code> costs ~$11-14/yr total. The $2 service fee covers the bundled provisioning service.</p>
  <p>Agents and humans pay the same price. No separate API tier.</p>
</section>

<!-- ═══════════════════════════════════ -->
<section id="authentication">
  <h2>Authentication</h2>

  <h3>GitHub OAuth Device Flow (interactive)</h3>
  <p>The CLI uses GitHub's Device Flow (RFC 8628). Run <code>forj init</code> and you'll be prompted to authorize at <code>github.com/login/device</code>.</p>

  <h3>API Keys (programmatic)</h3>
  <p>For agents and CI/CD. Create via the CLI after authenticating, or via the API:</p>
  <pre><code>curl -X POST https://api.forj.sh/api-keys \\
  -H "Authorization: Bearer \$JWT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My Agent Key",
    "scopes": ["agent:provision", "agent:read"],
    "environment": "live"
  }'</code></pre>
  <p>Save the returned key immediately — it's only shown once. Use it as a Bearer token in subsequent requests.</p>

  <h3>Cloudflare API Token</h3>
  <p>Create a custom Cloudflare token with these permissions:</p>
  <ul>
    <li>Account Settings: Read</li>
    <li>Zone: Read</li>
    <li>Zone Settings: Edit</li>
    <li>DNS: Edit</li>
  </ul>
  <p>The CLI guides you through this. The token is encrypted (AES-256-GCM) and stored server-side.</p>
</section>

<!-- ═══════════════════════════════════ -->
<section id="api-keys">
  <h2>API Keys</h2>

  <h3>Scopes</h3>
  <table>
    <thead><tr><th>Scope</th><th>Permissions</th></tr></thead>
    <tbody>
      <tr><td><code>agent:provision</code></td><td>Full provisioning — create projects, register domains, provision services</td></tr>
      <tr><td><code>agent:read</code></td><td>Read-only — check domains, get status, check DNS health</td></tr>
    </tbody>
  </table>

  <h3>Key format</h3>
  <p>Live keys: <code>forj_live_...</code> — Test keys: <code>forj_test_...</code></p>

  <h3>Best practices</h3>
  <ul>
    <li>Use <code>agent:read</code> for monitoring/CI, <code>agent:provision</code> only when needed</li>
    <li>Rotate keys every 90 days</li>
    <li>Store in environment variables, never commit to source</li>
    <li>Revoke immediately if compromised</li>
  </ul>
</section>

</div>
`;

app.appendChild(docs);
app.appendChild(Footer());
