/**
 * Email validation utilities using Zod
 */

import { z } from 'zod';

// Email validation schema
export const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Please enter a valid email address')
  .max(255, 'Email is too long');

// Validate email and return result
export function validateEmail(email: string): { valid: boolean; error?: string } {
  const result = emailSchema.safeParse(email);

  if (result.success) {
    return { valid: true };
  }

  return {
    valid: false,
    error: result.error.errors[0]?.message || 'Invalid email',
  };
}

// Basic sanitization for email input
export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
