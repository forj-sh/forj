/**
 * Create a test project in the database for worker testing
 */

import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

// Load environment variables
config();

const sql = neon(process.env.DATABASE_URL!);

async function createTestProject() {
  try {
    console.log('Creating test project in database...');

    // Generate UUIDs for project
    const testProjectId = '123e4567-e89b-12d3-a456-426614174000';
    // Use a valid UUID for user_id since projects table expects UUID
    const testUserId = '223e4567-e89b-12d3-a456-426614174001';

    const result = await sql`
      INSERT INTO projects (id, user_id, name, domain, services, created_at, updated_at)
      VALUES (
        ${testProjectId}::uuid,
        ${testUserId}::uuid,
        'Test Project',
        'test-forj-worker-12345.com',
        '{}'::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        updated_at = NOW()
      RETURNING id, name, domain, user_id;
    `;

    console.log('✅ Test project created:', result[0]);
    console.log(`\nℹ️  Use this project ID in your tests: ${testProjectId}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to create test project:', error);
    process.exit(1);
  }
}

createTestProject();
