/**
 * Waitlist email submission service
 * Uses Web3Forms for backend-less email collection
 */

export interface WaitlistResponse {
  success: boolean;
  message: string;
}

export async function submitToWaitlist(
  email: string,
  turnstileToken?: string | null
): Promise<WaitlistResponse> {
  const accessKey = import.meta.env.VITE_WEB3FORMS_KEY;

  if (!accessKey) {
    console.error('Web3Forms access key not configured');
    return {
      success: false,
      message: 'Configuration error. Please try again later.',
    };
  }

  try {
    const payload: Record<string, string> = {
      access_key: accessKey,
      email,
      subject: 'New Forj Waitlist Signup',
      from_name: 'Forj Landing Page',
      // Honeypot field - will be filled by spam bots
      botcheck: '',
    };

    // Include Turnstile token if provided
    if (turnstileToken) {
      payload['h-captcha-response'] = turnstileToken;
    }

    const response = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      return {
        success: true,
        message: 'Thanks! You\'re on the waitlist.',
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
