/**
 * Cloudflare Turnstile integration
 * Privacy-friendly CAPTCHA alternative
 */

declare global {
  interface Window {
    turnstile?: {
      render: (element: string | HTMLElement, options: TurnstileOptions) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
      getResponse: (widgetId: string) => string;
    };
    onTurnstileLoad?: () => void;
  }
}

interface TurnstileOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact';
}

export class TurnstileManager {
  private widgetId: string | null = null;
  private scriptLoaded = false;
  private scriptLoading = false;
  private loadCallbacks: Array<() => void> = [];

  /**
   * Load Turnstile script
   */
  async loadScript(): Promise<void> {
    if (this.scriptLoaded) {
      return Promise.resolve();
    }

    if (this.scriptLoading) {
      return new Promise((resolve) => {
        this.loadCallbacks.push(resolve);
      });
    }

    this.scriptLoading = true;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;

      script.onload = () => {
        this.scriptLoaded = true;
        this.scriptLoading = false;
        resolve();
        this.loadCallbacks.forEach((cb) => cb());
        this.loadCallbacks = [];
      };

      script.onerror = () => {
        this.scriptLoading = false;
        reject(new Error('Failed to load Turnstile script'));
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Render Turnstile widget
   */
  async render(
    container: HTMLElement,
    options: Partial<TurnstileOptions> = {}
  ): Promise<string | null> {
    const sitekey = import.meta.env.VITE_TURNSTILE_SITEKEY;

    if (!sitekey) {
      console.warn('Turnstile sitekey not configured, skipping CAPTCHA');
      return null;
    }

    try {
      await this.loadScript();

      if (!window.turnstile) {
        throw new Error('Turnstile not loaded');
      }

      this.widgetId = window.turnstile.render(container, {
        sitekey,
        theme: 'dark',
        size: 'normal',
        ...options,
      });

      return this.widgetId;
    } catch (error) {
      console.error('Turnstile render error:', error);
      return null;
    }
  }

  /**
   * Get response token
   */
  getResponse(): string | null {
    if (!this.widgetId || !window.turnstile) {
      return null;
    }

    return window.turnstile.getResponse(this.widgetId);
  }

  /**
   * Reset widget
   */
  reset(): void {
    if (this.widgetId && window.turnstile) {
      window.turnstile.reset(this.widgetId);
    }
  }

  /**
   * Remove widget
   */
  remove(): void {
    if (this.widgetId && window.turnstile) {
      window.turnstile.remove(this.widgetId);
      this.widgetId = null;
    }
  }

  /**
   * Check if Turnstile is enabled
   */
  isEnabled(): boolean {
    return !!import.meta.env.VITE_TURNSTILE_SITEKEY;
  }
}

export const turnstileManager = new TurnstileManager();
