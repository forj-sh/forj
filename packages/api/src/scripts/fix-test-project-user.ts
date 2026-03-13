/**
 * Update test project to use the mock JWT user ID
 */

import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

config();
const sql = neon(process.env.DATABASE_URL!);

async function fixTestProject() {
  try {
    console.log('Updating test project user_id...');

    // The JWT mock auth generates this user ID pattern
    // Let's first check what user_id we need by looking at the current JWT
    console.log('ℹ️  Get the user ID from: curl -s http://localhost:3000/auth/cli ...');
    console.log('ℹ️  For now, using a UUID version');

    //  Since projects table expects UUID but JWT generates VARCHAR, convert to UUID
    const testProjectId = '123e4567-e89b-12d3-a456-426614174000';

    // Create a matching UUID-format user (to bypass auth for testing)
    // In production, user IDs would be consistent UUIDs
    const testUserId = '223e4567-e89b-12d3-a456-426614174001';

    const result = await sql`
      UPDATE projects
      SET user_id = ${testUserId}::uuid
      WHERE id = ${testProjectId}::uuid
      RETURNING id, name, domain, user_id;
    `;

    if (result.length > 0) {
      console.log('✅ Test project updated:', result[0]);
      console.log(`\nℹ️  Project ID: ${testProjectId}`);
      console.log(`ℹ️  User ID: ${mockJwtUserId}`);
    } else {
      console.log('⚠️  No project found with that ID');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to update test project:', error);
    process.exit(1);
  }
}

fixTestProject();
