/**
 * Features section component
 */

import { html } from '@/utils/dom';

export function Features(): HTMLElement {
  return html`
    <section class="features" id="features">
      <div class="section-label">[ WHAT FORJ DOES ]</div>
      <div class="features-grid">

        <div class="feature-card reveal">
          <div class="feature-tag">[ DOMAIN ]</div>
          <h3 class="feature-title">Register and wire your domain</h3>
          <p class="feature-desc">Checks availability across TLDs, registers via Namecheap Reseller API, configures DNS — all in the same step. No manual nameserver changes.</p>
          <div class="feature-arrow">→</div>
          <div class="feature-mockup">
            <div><span class="ok">✓</span> <span class="key">getacme.com</span> <span class="dim">registered via Namecheap</span></div>
            <div><span class="ok">✓</span> <span class="dim">nameservers updated</span></div>
            <div><span class="ok">✓</span> <span class="dim">zone active in</span> <span class="val">14s</span></div>
          </div>
        </div>

        <div class="feature-card reveal">
          <div class="feature-tag">[ GITHUB ]</div>
          <h3 class="feature-title">Org, repos, branch protection</h3>
          <p class="feature-desc">Creates your GitHub org with sane defaults — main app repo, .github org config, branch protection rules. The setup a senior engineer would do.</p>
          <div class="feature-arrow">→</div>
          <div class="feature-mockup">
            <div><span class="ok">✓</span> <span class="key">github.com/getacme</span> <span class="dim">org created</span></div>
            <div><span class="ok">✓</span> <span class="dim">repos:</span> <span class="val">app</span> <span class="dim">/</span> <span class="val">.github</span></div>
            <div><span class="ok">✓</span> <span class="dim">branch protection on</span> <span class="val">main</span></div>
          </div>
        </div>

        <div class="feature-card reveal">
          <div class="feature-tag">[ DNS WIRING ]</div>
          <h3 class="feature-title">Auto-configure every record</h3>
          <p class="feature-desc">MX, SPF, DKIM, DMARC, CNAME — all wired correctly across every provisioned service. The part founders always get wrong, done right the first time.</p>
          <div class="feature-arrow">→</div>
          <div class="feature-mockup">
            <div><span class="ok">✓</span> <span class="key">SPF</span>&nbsp;&nbsp;<span class="dim">v=spf1 include:_spf.google.com ~all</span></div>
            <div><span class="ok">✓</span> <span class="key">DKIM</span> <span class="dim">google._domainkey configured</span></div>
            <div><span class="ok">✓</span> <span class="key">DMARC</span> <span class="dim">baseline policy active</span></div>
          </div>
        </div>

        <div class="feature-card reveal">
          <div class="feature-tag">[ AGENT-READY ]</div>
          <h3 class="feature-title">Designed for agents, not just humans</h3>
          <p class="feature-desc">Full non-interactive mode with structured JSON output. Cursor, Claude Code, and Windsurf can call forj as a tool — programmatic infra provisioning for autonomous workflows.</p>
          <div class="feature-arrow">→</div>
          <div class="feature-mockup">
            <div><span class="dim">$ npx forj init acme \\</span></div>
            <div><span class="dim">&nbsp;&nbsp;&nbsp;&nbsp;--domain getacme.com \\</span></div>
            <div><span class="dim">&nbsp;&nbsp;&nbsp;&nbsp;--non-interactive \\</span></div>
            <div><span class="key">&nbsp;&nbsp;&nbsp;&nbsp;--json</span></div>
          </div>
        </div>

      </div>
    </section>
  `;
}
