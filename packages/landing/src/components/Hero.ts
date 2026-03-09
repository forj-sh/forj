/**
 * Hero section component
 */

import { html } from '@/utils/dom';

export function Hero(): HTMLElement {
  return html`
    <section class="hero reveal">
      <div class="hero-label">[ INFRA PROVISIONING CLI ]</div>
      <h1>Project infra.<br><span>One command.</span></h1>
      <p class="hero-sub">
        Domain · GitHub org · Cloudflare · DNS wiring.<br>
        Correctly configured, in under 2 minutes.<br>
        Built for developers and the agents they work with.
      </p>
      <div class="hero-actions">
        <a href="#waitlist" class="btn-primary">try for free →</a>
        <span class="hero-note">no credit card · MIT CLI</span>
      </div>
    </section>
  `;
}
