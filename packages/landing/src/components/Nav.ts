/**
 * Navigation component
 */

import { html } from '@/utils/dom';

export function Nav(): HTMLElement {
  return html`
    <nav class="nav">
      <a href="/" class="logo">
        <img src="/forj-logo.svg" alt="forj 鍛冶場" class="logo-img" />
      </a>
      <ul class="nav-links">
        <li><a href="#features">features</a></li>
        <li><a href="#pricing">pricing</a></li>
        <li><a href="#">docs</a></li>
        <li><a href="https://github.com/pcdkd/forj" target="_blank" rel="noopener">github</a></li>
      </ul>
      <a href="#waitlist" class="nav-cta">start now →</a>
    </nav>
  `;
}
