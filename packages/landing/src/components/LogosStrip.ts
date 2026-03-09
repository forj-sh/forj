/**
 * Logos strip component (social proof)
 */

import { html } from '@/utils/dom';

export function LogosStrip(): HTMLElement {
  const logos = ['Paperchain', 'UnitedMasters', 'Datalicious', 'Relay'];

  // Duplicate logos for seamless infinite scroll
  const logosHTML = [...logos, ...logos]
    .map(logo => `<span>${logo}</span>`)
    .join('');

  return html`
    <div class="logos-strip">
      <div class="logos-inner">
        <span class="logos-label">built by founder and dev from</span>
        <div class="logos-scroll">
          ${logosHTML}
        </div>
      </div>
    </div>
  `;
}
