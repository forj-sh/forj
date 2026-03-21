/**
 * Pricing section component
 */

import { html } from '@/utils/dom';
import { bindCopyButton } from '@/utils/copy-command';

export function Pricing(): HTMLElement {
  const el = html`
    <section class="pricing" id="pricing">
      <div class="section-label">[ PRICING ]</div>
      <div class="pricing-grid">

        <div class="price-card featured reveal">
          <div class="price-tag-label">[ PAY PER PROJECT ]</div>
          <div class="price-name">Domain + Infrastructure</div>
          <div class="price-amount">domain cost<span> + $2</span></div>
          <div class="price-period">no subscription · no tiers · humans and agents alike</div>
          <div class="price-divider"></div>
          <ul class="price-features">
            <li>Domain registration (at-cost + $2 service fee)</li>
            <li>GitHub org + repos</li>
            <li>Cloudflare zone + DNS wiring</li>
            <li>Non-interactive + JSON mode for agents</li>
            <li>API key access</li>
            <li>Unlimited projects</li>
          </ul>
          <button class="price-btn primary copy-cmd">npx forj-cli init</button>
        </div>

      </div>
    </section>
  `;

  bindCopyButton(el.querySelector('.copy-cmd')!);
  return el;
}
