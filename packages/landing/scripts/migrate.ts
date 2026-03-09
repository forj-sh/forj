/**
 * Database migration script
 * Run with: npx tsx scripts/migrate.ts
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function migrate() {
  console.log('🗄️  Running database migrations...');

  try {
    // Create signups table
    await sql`
      CREATE TABLE IF NOT EXISTS signups (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        ip_address VARCHAR(45) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log('✅ Created signups table');

    // Create index on email for faster lookups
    await sql`
      CREATE INDEX IF NOT EXISTS idx_signups_email ON signups(email)
    `;
    console.log('✅ Created email index');

    // Create index on created_at for stats queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_signups_created_at ON signups(created_at DESC)
    `;
    console.log('✅ Created created_at index');

    // Create updated_at trigger function
    await sql`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `;
    console.log('✅ Created updated_at trigger function');

    // Create trigger on signups table
    await sql`
      DROP TRIGGER IF EXISTS update_signups_updated_at ON signups
    `;
    await sql`
      CREATE TRIGGER update_signups_updated_at
        BEFORE UPDATE ON signups
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column()
    `;
    console.log('✅ Created updated_at trigger');

    console.log('🎉 Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
