import { sql } from './lib/database';

async function test() {
  try {
    const result = await sql`SELECT 1 as connection_test`;
    console.log('Root lib/database connection test successful:', result);
  } catch (err) {
    console.error('Root lib/database connection test failed:', err);
  }
}

test();
