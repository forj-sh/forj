/**
 * Migration: Change projects.user_id from UUID to VARCHAR
 *
 * Stack 1: Fix user ID schema mismatch
 *
 * CONTEXT:
 * - JWT tokens generate VARCHAR user IDs (e.g., "mock-user-xyz123")
 * - users table already has id as VARCHAR(255)
 * - projects.user_id was incorrectly defined as UUID
 * - This migration aligns the schema with JWT token format
 *
 * SAFETY:
 * - Up migration (UUID → VARCHAR): Safe, PostgreSQL automatically casts UUID to string
 * - Down migration (VARCHAR → UUID): Will fail if any VARCHAR values are not valid UUIDs
 * - For development, assumes clean slate or test data only
 * - In production, verify all user_id values are valid UUIDs before rollback
 */

exports.up = (pgm) => {
  // Drop the existing user_id index first
  pgm.dropIndex('projects', 'user_id');

  // Alter the column type from UUID to VARCHAR(255)
  pgm.alterColumn('projects', 'user_id', {
    type: 'varchar(255)',
    notNull: true,
  });

  // Recreate the index on user_id
  pgm.createIndex('projects', 'user_id');
};

exports.down = (pgm) => {
  // Drop the index
  pgm.dropIndex('projects', 'user_id');

  // Revert back to UUID with explicit cast
  // WARNING: This will fail if any VARCHAR user_id values are not valid UUIDs
  // PostgreSQL requires explicit USING clause for VARCHAR → UUID conversion
  pgm.alterColumn('projects', 'user_id', {
    type: 'uuid',
    notNull: true,
    using: 'user_id::uuid', // Explicit cast required for VARCHAR → UUID
  });

  // Recreate the index
  pgm.createIndex('projects', 'user_id');
};
