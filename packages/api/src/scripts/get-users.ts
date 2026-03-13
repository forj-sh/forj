import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

config();
const sql = neon(process.env.DATABASE_URL!);

async function getUsers() {
  const users = await sql`SELECT id, email FROM users LIMIT 5`;
  console.log('Users:', JSON.stringify(users, null, 2));
}

getUsers();
