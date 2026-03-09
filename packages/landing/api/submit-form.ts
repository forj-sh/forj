/**
 * Waitlist form submission API
 * Vercel serverless function
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Disposable email domains to block
const DISPOSABLE_DOMAINS = [
  'tempmail.com',
  'guerrillamail.com',
  'mailinator.com',
  '10minutemail.com',
  'throwaway.email',
  'temp-mail.org',
];

// In-memory rate limiting (resets on cold start)
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_WINDOW = 60000; // 60 seconds

interface SignupData {
  email: string;
  turnstile_token?: string;
}

function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || email.length === 0) {
    return { valid: false, error: 'Email is required' };
  }

  if (email.length > 255) {
    return { valid: false, error: 'Email is too long' };
  }

  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, error: 'Please enter a valid email address' };
  }

  const domain = email.split('@')[1]?.toLowerCase();
  if (DISPOSABLE_DOMAINS.includes(domain)) {
    return { valid: false, error: 'Disposable email addresses are not allowed' };
  }

  return { valid: true };
}

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const lastSubmission = rateLimitMap.get(identifier);

  if (lastSubmission && now - lastSubmission < RATE_LIMIT_WINDOW) {
    return false;
  }

  rateLimitMap.set(identifier, now);
  return true;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { email, turnstile_token }: SignupData = req.body;

    // Get client IP for rate limiting
    const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
    const identifier = Array.isArray(clientIp) ? clientIp[0] : clientIp;

    // Check rate limit
    if (!checkRateLimit(identifier)) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again in 60 seconds.',
      });
    }

    // Validate email
    const validation = validateEmail(email);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error,
      });
    }

    // TODO: Verify Turnstile token if provided
    // if (turnstile_token && process.env.TURNSTILE_SECRET_KEY) {
    //   const verifyResponse = await fetch(
    //     'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    //     {
    //       method: 'POST',
    //       headers: { 'Content-Type': 'application/json' },
    //       body: JSON.stringify({
    //         secret: process.env.TURNSTILE_SECRET_KEY,
    //         response: turnstile_token,
    //       }),
    //     }
    //   );
    //   const verifyData = await verifyResponse.json();
    //   if (!verifyData.success) {
    //     return res.status(400).json({
    //       success: false,
    //       message: 'CAPTCHA verification failed',
    //     });
    //   }
    // }

    // TODO: Store in database
    // For now, just log to console (will add database integration)
    console.log('Waitlist signup:', { email, ip: identifier, timestamp: new Date().toISOString() });

    // TODO: Send confirmation email via Resend
    // if (process.env.RESEND_API_KEY) {
    //   await fetch('https://api.resend.com/emails', {
    //     method: 'POST',
    //     headers: {
    //       'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify({
    //       from: 'forj <noreply@forj.dev>',
    //       to: email,
    //       subject: 'Welcome to the forj waitlist',
    //       html: '<p>Thanks for signing up! We\'ll notify you when forj launches.</p>',
    //     }),
    //   });
    // }

    return res.status(200).json({
      success: true,
      message: 'Thanks! You\'re on the waitlist.',
    });
  } catch (error) {
    console.error('Form submission error:', error);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again.',
    });
  }
}
