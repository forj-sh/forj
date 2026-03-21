/**
 * API Section component (Agent mode showcase)
 */

import { html } from '@/utils/dom';

export function APISection(): HTMLElement {
  return html`
    <section class="api-section">
      <div class="api-inner">
        <div class="api-text reveal">
          <p class="section-label" style="margin-bottom: 28px">[ AGENT MODE ]</p>
          <h2>
            <span class="jp">エージェント対応</span>
            Structured output for autonomous workflows
          </h2>
          <p>
            Every forj command returns clean JSON when called with --json. No parsing terminal output. No scraping logs. Agents get a complete provisioning manifest they can act on immediately.
          </p>
          <p style="margin-bottom: 0; color: var(--text3);">
            Same access for humans and agents. No separate tier required.
          </p>
        </div>
        <div class="api-json reveal">
          <div><span class="j-punc">{</span></div>
          <div>&nbsp;&nbsp;<span class="j-key">"status"</span><span class="j-punc">:</span> <span class="j-str">"complete"</span><span class="j-punc">,</span></div>
          <div>&nbsp;&nbsp;<span class="j-key">"project"</span><span class="j-punc">:</span> <span class="j-str">"acme"</span><span class="j-punc">,</span></div>
          <div>&nbsp;&nbsp;<span class="j-key">"duration_ms"</span><span class="j-punc">:</span> <span class="j-num">112340</span><span class="j-punc">,</span></div>
          <div>&nbsp;&nbsp;<span class="j-key">"services"</span><span class="j-punc">: {</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-key">"domain"</span><span class="j-punc">: {</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-key">"status"</span><span class="j-punc">:</span> <span class="j-str">"ok"</span><span class="j-punc">,</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-key">"value"</span><span class="j-punc">:</span> <span class="j-str">"getacme.com"</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-punc">},</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-key">"github"</span><span class="j-punc">: {</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-key">"status"</span><span class="j-punc">:</span> <span class="j-str">"ok"</span><span class="j-punc">,</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-key">"value"</span><span class="j-punc">:</span> <span class="j-str">"github.com/getacme"</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-punc">},</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-key">"dns"</span><span class="j-punc">: {</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-key">"status"</span><span class="j-punc">:</span> <span class="j-str">"ok"</span><span class="j-punc">,</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-key">"records"</span><span class="j-punc">: [</span><span class="j-str">"MX"</span><span class="j-punc">,</span><span class="j-str">"SPF"</span><span class="j-punc">,</span><span class="j-str">"DKIM"</span><span class="j-punc">]</span></div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="j-punc">}</span></div>
          <div>&nbsp;&nbsp;<span class="j-punc">},</span></div>
          <div>&nbsp;&nbsp;<span class="j-key">"credentials_path"</span><span class="j-punc">:</span> <span class="j-str">".forj/credentials.json"</span></div>
          <div><span class="j-punc">}</span></div>
        </div>
      </div>
    </section>
  `;
}
