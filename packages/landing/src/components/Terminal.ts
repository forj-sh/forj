/**
 * Terminal demo component
 */

import { html } from '@/utils/dom';

export function Terminal(): HTMLElement {
  return html`
    <div class="terminal-wrap reveal">
      <div class="terminal">
        <div class="terminal-bar">
          <div class="terminal-dots">
            <div class="dot red"></div>
            <div class="dot yellow"></div>
            <div class="dot green"></div>
          </div>
          <span class="terminal-title">zsh — forj init</span>
        </div>
        <div class="terminal-body">
          <div class="t-line">
            <span class="t-prompt">$</span>
            <span class="t-cmd">npx forj-cli init acme</span>
          </div>
          <br>
          <div>&nbsp;&nbsp;<span class="t-dim">✦ forj 鍛冶場 — project infrastructure provisioning</span></div>
          <br>
          <div>&nbsp;&nbsp;<span class="t-label">? Company / project name: </span><span class="t-val">acme</span></div>
          <div>&nbsp;&nbsp;<span class="t-success">✔</span> Domain availability checked</div>
          <div>&nbsp;&nbsp;<span class="t-label">? Select domain:</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">✓</span>&nbsp;<span class="t-val">acme.xyz</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-dim">— $1.78/yr</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-error">✗</span>&nbsp;<span class="t-dim">acme.com</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-dim">— taken</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">✓</span>&nbsp;<span class="t-val">acme.io</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-dim">— $34.98/yr</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">✓</span>&nbsp;<span class="t-val">getacme.com</span>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-dim">— $10.18/yr</span></div>
          <br>
          <div>&nbsp;&nbsp;Registering domain...</div>
          <div>&nbsp;&nbsp;<span class="t-success">✔</span> domain: Domain provisioned successfully</div>
          <div>&nbsp;&nbsp;<span class="t-success">✔</span> Provisioning complete</div>
          <br>
          <div>&nbsp;&nbsp;<span class="t-success">✓</span> <span class="t-val">acme.xyz</span> is yours!</div>
          <br>
          <div>&nbsp;&nbsp;<span class="t-label">? What else do you want to set up?</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">◉</span>&nbsp;GitHub&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-dim">github.com/acme — org + repo</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">◉</span>&nbsp;Cloudflare DNS&nbsp;&nbsp;<span class="t-dim">Set up Cloudflare as your DNS provider</span></div>
          <br>
          <div>&nbsp;&nbsp;<span class="t-success">✔</span> github: Org verified, repo created</div>
          <div>&nbsp;&nbsp;<span class="t-success">✔</span> cloudflare: Zone active, nameservers configured</div>
          <br>
          <div>&nbsp;&nbsp;<span class="t-success">Done in 1m 42s</span></div>
          <br>
          <div class="t-line">
            <span class="t-prompt">$</span>
            <span class="cursor"></span>
          </div>
        </div>
      </div>
    </div>
  `;
}
