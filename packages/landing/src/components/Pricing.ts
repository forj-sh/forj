/**
 * Pricing section component
 */

import { html } from '@/utils/dom';

export function Pricing(): HTMLElement {
  return html`
    <section class="pricing" id="pricing">
      <div class="section-label">[ PRICING ]</div>
      <div class="pricing-grid">

        <div class="price-card reveal">
          <div class="price-tag-label">[ FREE ]</div>
          <div class="price-name">Starter</div>
          <div class="price-amount">$0</div>
          <div class="price-period">forever free · 1 project</div>
          <div class="price-divider"></div>
          <ul class="price-features">
            <li>Domain registration</li>
            <li>GitHub org + repos</li>
            <li>Cloudflare zone + DNS wiring</li>
            <li>1 project lifetime</li>
          </ul>
          <a href="#waitlist" class="price-btn">get started →</a>
        </div>

        <div class="price-card featured reveal">
          <div class="featured-badge">POPULAR</div>
          <div class="price-tag-label">[ PRO ]</div>
          <div class="price-name">Pro</div>
          <div class="price-amount">$99<span>/yr</span></div>
          <div class="price-period">or $49 one-time · unlimited projects</div>
          <div class="price-divider"></div>
          <ul class="price-features">
            <li>Everything in Starter</li>
            <li>Unlimited projects</li>
            <li>Vercel + Railway integrations</li>
            <li>forj status history</li>
            <li>DNS health monitoring</li>
          </ul>
          <a href="#waitlist" class="price-btn primary">start free trial →</a>
        </div>

        <div class="price-card reveal">
          <div class="price-tag-label">[ AGENT ]</div>
          <div class="price-name">Agent</div>
          <div class="price-amount">$199<span>/yr</span></div>
          <div class="price-period">API key access · for agents + power users</div>
          <div class="price-divider"></div>
          <ul class="price-features">
            <li>Everything in Pro</li>
            <li>API key access</li>
            <li>Non-interactive + JSON mode</li>
            <li>Webhook callbacks</li>
            <li>Priority provisioning queue</li>
            <li>Accelerator cohort pricing available</li>
          </ul>
          <a href="#waitlist" class="price-btn">get agent tier →</a>
        </div>

      </div>
    </section>
  `;
}
