/**
 * Migration: Create api_keys table for agent authentication
 *
 * This table stores API keys for long-lived agent access.
 * Keys are hashed with bcrypt before storage.
 * Supports scoped access (agent:provision, agent:read).
 */

exports.up = (pgm) => {
  // Create api_keys table
  pgm.createTable('api_keys', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'varchar(255)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
      comment: 'User who owns this API key',
    },
    key_hash: {
      type: 'text',
      notNull: true,
      comment: 'bcrypt hash of the API key',
    },
    key_hint: {
      type: 'varchar(8)',
      notNull: true,
      comment: 'First 8 chars of the key secret for quick lookup',
    },
    scopes: {
      type: 'text[]',
      notNull: true,
      comment: 'Array of scopes (e.g., agent:provision, agent:read)',
    },
    name: {
      type: 'varchar(255)',
      notNull: false,
      comment: 'Optional name for the key (e.g., "Production CI", "Local Dev")',
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
    expires_at: {
      type: 'timestamp with time zone',
      notNull: false,
      comment: 'Optional expiration date',
    },
    last_used_at: {
      type: 'timestamp with time zone',
      notNull: false,
      comment: 'Last time this key was used',
    },
    revoked_at: {
      type: 'timestamp with time zone',
      notNull: false,
      comment: 'When this key was revoked (null = active)',
    },
  });

  // Create index on user_id for efficient lookups
  pgm.createIndex('api_keys', 'user_id');

  // Create index on key_hint for efficient key verification
  pgm.createIndex('api_keys', 'key_hint');

  // Create index on revoked_at for filtering active keys
  pgm.createIndex('api_keys', 'revoked_at', {
    where: 'revoked_at IS NULL',
    name: 'idx_api_keys_active',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('api_keys');
};
