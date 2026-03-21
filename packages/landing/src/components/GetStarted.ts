/**
 * Get Started CTA section (replaces WaitlistForm)
 */

import { html } from '@/utils/dom';

export function GetStarted(): HTMLElement {
  return html`
    <section class="waitlist" id="get-started">
      <div class="waitlist-inner">
        <div class="waitlist-content reveal">
          <div class="section-label">[ GET STARTED ]</div>
          <h2>One command away</h2>
          <p class="waitlist-desc">
            Domain + GitHub + Cloudflare DNS — configured correctly, in under 2 minutes.
          </p>
        </div>

        <div class="waitlist-form reveal">
          <div class="form-group">
            <code class="email-input" style="display: flex; align-items: center; font-family: monospace; cursor: text; user-select: all;">npx forj-cli init</code>
          </div>
          <p class="form-note">
            Works for humans and agents alike. Add --json for structured output.
          </p>
        </div>
      </div>
    </section>
  `;
}
