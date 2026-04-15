/**
 * Hero section component
 */

import { html } from '@/utils/dom';
import { bindCopyButton } from '@/utils/copy-command';

export function Hero(): HTMLElement {
  const el = html`
    <section class="hero reveal">
      <a href="https://www.producthunt.com/products/forj-2?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-forj-2" target="_blank" rel="noopener noreferrer" class="ph-badge">
        <img alt="forj 鍛冶場 - Provision project infrastructure with a single command | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1124677&theme=dark&t=1776284180338" />
      </a>
      <div class="hero-label">[ INFRA PROVISIONING CLI ]</div>
      <h1>Project infra.<br><span>One command.</span></h1>
      <p class="hero-sub">
        forj lets you or your agent register a domain, configure GitHub,<br>
        wire DNS, and spin up your deployment platform correctly from a single command.
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
