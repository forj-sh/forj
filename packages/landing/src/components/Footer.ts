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
          <span class="logo-mark" style="font-size: 18px;">forj</span>
          <span class="logo-jp">鍛冶場</span>
        </div>
        <div class="footer-right">
          © ${year} forj · MIT license · built for developers
        </div>
      </div>
    </footer>
  `;
}
