/**
 * Migration: Create users table with Cloudflare token support
 */

exports.up = (pgm) => {
  // Create users table
  pgm.createTable('users', {
    id: {
      type: 'varchar(255)',
      primaryKey: true,
      comment: 'User ID (external identifier, not auto-generated UUID)',
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    // Cloudflare integration
    cloudflare_token_encrypted: {
      type: 'text',
      notNull: false,
      comment: 'AES-256-GCM encrypted Cloudflare API token',
    },
    cloudflare_account_id: {
      type: 'varchar(255)',
      notNull: false,
      comment: 'Cloudflare account ID associated with the token',
    },
    // GitHub integration (for future use)
    github_token_encrypted: {
      type: 'text',
      notNull: false,
      comment: 'AES-256-GCM encrypted GitHub OAuth token',
    },
    github_username: {
      type: 'varchar(255)',
      notNull: false,
      comment: 'GitHub username',
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Create updated_at trigger function
  pgm.sql(`
    CREATE OR REPLACE FUNCTION users_update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  // Create trigger for users table
  pgm.createTrigger('users', 'update_users_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'users_update_updated_at_column',
    level: 'ROW',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('users');
  pgm.sql('DROP FUNCTION IF EXISTS users_update_updated_at_column();');
};
