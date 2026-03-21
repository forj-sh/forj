/**
 * Navigation component
 */

import { html } from '@/utils/dom';
import { bindCopyButton } from '@/utils/copy-command';

export function Nav(): HTMLElement {
  const el = html`
    <nav class="nav">
      <a href="/" class="logo">
        <img src="/forj-logo.svg" alt="forj 鍛冶場" class="logo-img" />
      </a>
      <ul class="nav-links">
        <li><a href="#features">features</a></li>
        <li><a href="#pricing">pricing</a></li>
      </ul>
      <button class="nav-cta copy-cmd">npx forj-cli init</button>
    </nav>
  `;

  bindCopyButton(el.querySelector('.copy-cmd')!);
  return el;
}
