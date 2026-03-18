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
          <div>&nbsp;&nbsp;<span class="t-label">? company / project name: </span><span class="t-val">Acme Inc</span></div>
          <div>&nbsp;&nbsp;<span class="t-label">? desired domain: </span><span class="t-dim">(checking availability...)</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">✓</span>&nbsp;<span class="t-val">acme.io</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-dim">— $9.95/yr</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">✓</span>&nbsp;<span class="t-val">getacme.com</span>&nbsp;&nbsp;<span class="t-dim">— $12.95/yr</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-error">✗</span>&nbsp;<span class="t-dim">acme.com</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-dim">— taken</span></div>
          <div>&nbsp;&nbsp;<span class="t-label">? select domain: </span><span class="t-val">getacme.com</span></div>
          <br>
          <div>&nbsp;&nbsp;<span class="t-dim">provisioning...</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">✓</span>&nbsp;&nbsp;<span class="t-label">domain registered</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-val">getacme.com</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">✓</span>&nbsp;&nbsp;<span class="t-label">github repos created</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-val">github.com/getacme</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">✓</span>&nbsp;&nbsp;<span class="t-label">cloudflare zone active</span>&nbsp;&nbsp;&nbsp;<span class="t-val">getacme.com</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-success">✓</span>&nbsp;&nbsp;<span class="t-label">dns wired</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="t-val">MX · SPF · DKIM · CNAME</span></div>
          <br>
          <div>&nbsp;&nbsp;<span class="t-dim">credentials → .forj/credentials.json&nbsp;&nbsp;</span><span class="t-success">(gitignored ✓)</span></div>
          <br>
          <div>&nbsp;&nbsp;<span class="t-success">setup complete in 1m 52s</span>&nbsp;&nbsp;<span class="t-dim">run \`forj status\` to see your stack.</span></div>
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
