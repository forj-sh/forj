/**
 * Waitlist form submission API
 * Vercel serverless function
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { emailExists, createSignup } from '../lib/database';

const resend = new Resend(process.env.RESEND_API_KEY);

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

    // Get client IP for rate limiting and Turnstile validation
    const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
    const identifier = Array.isArray(clientIp) ? clientIp[0] : clientIp;

    // Verify Turnstile token
    if (turnstile_token && process.env.TURNSTILE_SECRET_KEY) {
      try {
        const verifyResponse = await fetch(
          'https://challenges.cloudflare.com/turnstile/v0/siteverify',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret: process.env.TURNSTILE_SECRET_KEY,
              response: turnstile_token,
              remoteip: identifier,
            }),
          }
        );
        const verifyData = await verifyResponse.json();
        if (!verifyData.success) {
          console.error('Turnstile verification failed:', verifyData['error-codes']);
          return res.status(400).json({
            success: false,
            message: 'CAPTCHA verification failed. Please try again.',
          });
        }
        console.log('Turnstile verification successful');
      } catch (turnstileError) {
        console.error('Turnstile verification error:', turnstileError);
        return res.status(500).json({
          success: false,
          message: 'Verification error. Please try again.',
        });
      }
    }

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

    // Check if email already exists
    const exists = await emailExists(email);
    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'This email is already on the waitlist.',
      });
    }

    // Store in database
    await createSignup(email, identifier);
    console.log('Waitlist signup:', { email, ip: identifier, timestamp: new Date().toISOString() });

    // Send notification email to admin
    if (process.env.RESEND_API_KEY) {
      try {
        console.log('Attempting to send email notification...');
        const emailResult = await resend.emails.send({
          from: 'forj <hello@updates.forj.sh>',
          to: 'dewar.daniel@pm.me',
          subject: 'New forj waitlist signup',
          text: `New signup: ${email}\nIP: ${identifier}\nTime: ${new Date().toISOString()}`,
        });
        console.log('Email sent successfully:', emailResult);
      } catch (emailError) {
        // Log but don't fail the request if email fails
        console.error('Failed to send notification email:', emailError);
      }
    } else {
      console.warn('RESEND_API_KEY not found - skipping email notification');
    }

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
