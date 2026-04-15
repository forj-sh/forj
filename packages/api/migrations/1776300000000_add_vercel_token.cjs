/**
 * Migration: Add Vercel token and team ID to users table
 *
 * Stores encrypted Vercel API token and team ID for Vercel project provisioning.
 * Uses separate encryption key (VERCEL_ENCRYPTION_KEY) for security isolation.
 */

exports.up = (pgm) => {
  pgm.addColumns('users', {
    vercel_token_encrypted: {
      type: 'text',
      notNull: false,
      comment: 'AES-256-GCM encrypted Vercel API token',
    },
    vercel_team_id: {
      type: 'varchar(255)',
      notNull: false,
      comment: 'Vercel team ID (scope for API calls)',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['vercel_token_encrypted', 'vercel_team_id']);
};
