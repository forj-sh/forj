/**
 * Footer component
 */

import { html } from '@/utils/dom';

export function Footer(): HTMLElement {
  const year = new Date().getFullYear();

  return html`
    <footer>
      <div class="footer-inner">
        <div class="footer-left">
          <img src="/forj-logo.svg" alt="forj 鍛冶場" class="footer-logo" />
        </div>
        <div class="footer-right">
          © ${year} forj · MIT license · built for developers
        </div>
      </div>
    </footer>
  `;
}
