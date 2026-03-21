/**
 * Hero section component
 */

import { html } from '@/utils/dom';
import { bindCopyButton } from '@/utils/copy-command';

export function Hero(): HTMLElement {
  const el = html`
    <section class="hero reveal">
      <div class="hero-label">[ INFRA PROVISIONING CLI ]</div>
      <h1>Project infra.<br><span>One command.</span></h1>
      <p class="hero-sub">
        Domain · GitHub org · Cloudflare · DNS wiring.<br>
        Correctly configured, in under 2 minutes.<br>
        Built for developers and the agents they work with.
      </p>
      <div class="hero-actions">
        <button class="btn-primary copy-cmd">npx forj-cli init</button>
        <span class="hero-note">pay per domain · no subscription</span>
      </div>
    </section>
  `;

  bindCopyButton(el.querySelector('.copy-cmd')!);
  return el;
}
