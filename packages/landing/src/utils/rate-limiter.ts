/**
 * Client-side rate limiting for form submissions
 * Prevents rapid-fire submissions from same browser
 */

interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

interface RateLimitState {
  attempts: number;
  resetTime: number;
}

const STORAGE_KEY = 'forj_waitlist_ratelimit';

export class RateLimiter {
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = { maxAttempts: 3, windowMs: 60000 }) {
    this.config = config;
  }

  /**
   * Check if request is allowed
   */
  isAllowed(): boolean {
    const state = this.getState();
    const now = Date.now();

    // Reset if window has passed
    if (now >= state.resetTime) {
      this.reset();
      return true;
    }

    // Check if under limit
    return state.attempts < this.config.maxAttempts;
  }

  /**
   * Record an attempt
   */
  recordAttempt(): void {
    const state = this.getState();
    const now = Date.now();

    // Reset if window has passed
    if (now >= state.resetTime) {
      this.setState({
        attempts: 1,
        resetTime: now + this.config.windowMs,
      });
    } else {
      this.setState({
        ...state,
        attempts: state.attempts + 1,
      });
    }
  }

  /**
   * Get time until reset in seconds
   */
  getTimeUntilReset(): number {
    const state = this.getState();
    const now = Date.now();
    const remaining = Math.max(0, state.resetTime - now);
    return Math.ceil(remaining / 1000);
  }

  /**
   * Reset the rate limit
   */
  reset(): void {
    this.setState({
      attempts: 0,
      resetTime: Date.now() + this.config.windowMs,
    });
  }

  private getState(): RateLimitState {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Rate limiter storage error:', error);
    }

    return {
      attempts: 0,
      resetTime: Date.now() + this.config.windowMs,
    };
  }

  private setState(state: RateLimitState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Rate limiter storage error:', error);
    }
  }
}

// Export a singleton instance
export const waitlistRateLimiter = new RateLimiter({
  maxAttempts: 3,
  windowMs: 60000, // 1 minute
});
