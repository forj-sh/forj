/**
 * Initial migration: Create projects table
 */

exports.up = (pgm) => {
  // Enable pgcrypto extension for gen_random_uuid()
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

  // Create projects table
  pgm.createTable('projects', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    domain: {
      type: 'varchar(255)',
      notNull: true,
    },
    user_id: {
      type: 'uuid',
      notNull: true,
    },
    services: {
      type: 'jsonb',
      notNull: true,
      default: '{}',
      comment: 'Service states: { domain: { status, value, meta }, github: {...}, ... }',
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

  // Create index on user_id for fast lookups
  pgm.createIndex('projects', 'user_id');

  // Create index on domain for uniqueness checks
  pgm.createIndex('projects', 'domain', { unique: true });

  // Create index on services JSONB column for status queries
  pgm.sql(`
    CREATE INDEX projects_services_idx ON projects USING GIN (services);
  `);

  // Create updated_at trigger function (table-specific to avoid conflicts on rollback)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION projects_update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  // Create trigger for projects table
  pgm.createTrigger('projects', 'update_projects_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'projects_update_updated_at_column',
    level: 'ROW',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('projects');
  pgm.sql('DROP FUNCTION IF EXISTS projects_update_updated_at_column();');
};
