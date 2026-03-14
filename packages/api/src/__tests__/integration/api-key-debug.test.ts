/**
 * Debug test to see what's wrong with API key creation
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createServer } from '../../server.js';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { API_KEY_SCOPES } from '../../lib/api-key-service.js';

describe('API Key Debug', () => {
  let server: FastifyInstance;
  let jwtToken: string;
  const testUserId = 'test-user-debug';
  const testEmail = 'debug@example.com';
  const jwtSecret = 'test-secret-debug';

  beforeAll(async () => {
    process.env.JWT_SECRET = jwtSecret;
    server = await createServer();

    const secret = new TextEncoder().encode(jwtSecret);
    jwtToken = await new SignJWT({ userId: testUserId, email: testEmail })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
  }, 30000);

  afterAll(async () => {
    await server.close();
  }, 30000);

  it('should create an API key and show full response', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api-keys',
      headers: {
        authorization: `Bearer ${jwtToken}`,
      },
      payload: {
        scopes: [API_KEY_SCOPES.AGENT_READ],
        environment: 'test',
      },
    });

    console.log('=== RESPONSE STATUS ===');
    console.log(response.statusCode);

    console.log('\n=== RESPONSE HEADERS ===');
    console.log(JSON.stringify(response.headers, null, 2));

    console.log('\n=== RESPONSE BODY ===');
    console.log(response.body);

    const body = JSON.parse(response.body);
    console.log('\n=== PARSED BODY ===');
    console.log(JSON.stringify(body, null, 2));

    // Don't assert anything, just show what we get
  });
});
