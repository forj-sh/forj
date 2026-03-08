/**
 * Waitlist email signup form component
 */

import { html } from '@/utils/dom';
import { validateEmail, sanitizeEmail } from '@/utils/validation';
import { submitToWaitlist } from '@/services/waitlist';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export function WaitlistForm(): HTMLElement {
  const container = html`
    <section class="waitlist" id="waitlist">
      <div class="waitlist-inner">
        <div class="waitlist-content reveal">
          <div class="section-label">[ JOIN WAITLIST ]</div>
          <h2>Get early access</h2>
          <p class="waitlist-desc">
            Be among the first to provision infrastructure in under 2 minutes.
            We'll notify you when Forj launches.
          </p>
        </div>

        <form class="waitlist-form reveal" id="waitlist-form">
          <div class="form-group">
            <input
              type="email"
              id="email-input"
              class="email-input"
              placeholder="your@email.com"
              autocomplete="email"
              required
            />
            <button type="submit" class="submit-btn" id="submit-btn">
              <span class="btn-text">Join waitlist →</span>
            </button>
          </div>
          <div class="form-message" id="form-message"></div>
          <p class="form-note">
            No spam, ever. We'll only email you when Forj is ready to use.
          </p>
        </form>
      </div>
    </section>
  `;

  // Get form elements
  const form = container.querySelector<HTMLFormElement>('#waitlist-form')!;
  const emailInput = container.querySelector<HTMLInputElement>('#email-input')!;
  const submitBtn = container.querySelector<HTMLButtonElement>('#submit-btn')!;
  const btnText = submitBtn.querySelector<HTMLSpanElement>('.btn-text')!;
  const messageEl = container.querySelector<HTMLDivElement>('#form-message')!;

  let currentState: FormState = 'idle';

  // Update UI based on state
  function setState(state: FormState, message?: string) {
    currentState = state;

    // Update button
    submitBtn.disabled = state === 'submitting' || state === 'success';
    submitBtn.classList.toggle('loading', state === 'submitting');
    submitBtn.classList.toggle('success', state === 'success');
    submitBtn.classList.toggle('error', state === 'error');

    // Update button text
    if (state === 'submitting') {
      btnText.textContent = 'Submitting...';
    } else if (state === 'success') {
      btnText.textContent = 'Joined! ✓';
    } else {
      btnText.textContent = 'Join waitlist →';
    }

    // Update message
    if (message) {
      messageEl.textContent = message;
      messageEl.classList.remove('success', 'error');
      if (state === 'success') {
        messageEl.classList.add('success');
      } else if (state === 'error') {
        messageEl.classList.add('error');
      }
    } else {
      messageEl.textContent = '';
    }
  }

  // Handle form submission
  async function handleSubmit(e: Event) {
    e.preventDefault();

    if (currentState === 'submitting' || currentState === 'success') {
      return;
    }

    const rawEmail = emailInput.value;
    const email = sanitizeEmail(rawEmail);

    // Validate email
    const validation = validateEmail(email);
    if (!validation.valid) {
      setState('error', validation.error);
      return;
    }

    // Submit to waitlist
    setState('submitting');

    const result = await submitToWaitlist(email);

    if (result.success) {
      setState('success', result.message);
      emailInput.value = '';

      // Track conversion (optional - can be added later)
      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'waitlist_signup', {
          event_category: 'engagement',
          event_label: 'email_signup',
        });
      }
    } else {
      setState('error', result.message);
      // Reset to idle after 3 seconds
      setTimeout(() => {
        if (currentState === 'error') {
          setState('idle');
        }
      }, 3000);
    }
  }

  // Clear error on input
  emailInput.addEventListener('input', () => {
    if (currentState === 'error') {
      setState('idle');
    }
  });

  form.addEventListener('submit', handleSubmit);

  return container;
}
