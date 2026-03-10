/**
 * Authentication types
 */

/**
 * CLI authentication request
 * POST /auth/cli
 */
export interface CLIAuthRequest {
  // Device identifier (optional, for tracking)
  deviceId?: string;
  // CLI version for compatibility checking
  cliVersion?: string;
}

/**
 * CLI authentication response
 */
export interface CLIAuthResponse {
  token: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
  };
}

/**
 * JWT token payload
 */
export interface TokenPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}
