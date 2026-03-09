/**
 * Database utilities for Neon PostgreSQL
 */

import { neon } from '@neondatabase/serverless';

// Get database connection string from environment
const sql = neon(process.env.DATABASE_URL!);

export interface Signup {
  id: number;
  email: string;
  ip_address: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Check if email already exists in database
 */
export async function emailExists(email: string): Promise<boolean> {
  const result = await sql`
    SELECT EXISTS(
      SELECT 1 FROM signups WHERE email = ${email.toLowerCase()}
    ) as exists
  `;
  return result[0].exists;
}

/**
 * Create a new signup record
 */
export async function createSignup(email: string, ipAddress: string): Promise<Signup> {
  const result = await sql`
    INSERT INTO signups (email, ip_address)
    VALUES (${email.toLowerCase()}, ${ipAddress})
    RETURNING id, email, ip_address, created_at, updated_at
  `;
  return result[0] as Signup;
}

/**
 * Get signup statistics
 */
export async function getSignupStats(): Promise<{
  total: number;
  today: number;
  this_week: number;
}> {
  const result = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as this_week
    FROM signups
  `;
  return {
    total: Number(result[0].total),
    today: Number(result[0].today),
    this_week: Number(result[0].this_week),
  };
}

/**
 * Get recent signups (admin only)
 */
export async function getRecentSignups(limit: number = 50): Promise<Signup[]> {
  const result = await sql`
    SELECT id, email, ip_address, created_at, updated_at
    FROM signups
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return result as Signup[];
}
