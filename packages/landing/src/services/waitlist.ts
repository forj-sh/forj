/**
 * Waitlist email submission service
 * Submits to our own Vercel API route
 */

export interface WaitlistResponse {
  success: boolean;
  message: string;
}

export async function submitToWaitlist(
  email: string,
  turnstileToken?: string | null
): Promise<WaitlistResponse> {
  try {
    const response = await fetch('/api/submit-form', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email,
        turnstile_token: turnstileToken,
      }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      return {
        success: true,
        message: data.message || 'Thanks! You\'re on the waitlist.',
      };
    }

    return {
      success: false,
      message: data.message || 'Something went wrong. Please try again.',
    };
  } catch (error) {
    console.error('Waitlist submission error:', error);
    return {
      success: false,
      message: 'Network error. Please check your connection and try again.',
    };
  }
}
