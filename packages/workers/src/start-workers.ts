#!/usr/bin/env node
/**
 * Worker process startup script
 *
 * Starts all BullMQ workers for background job processing:
 * - Domain worker (Namecheap domain operations)
 * - GitHub worker (repo creation, org verification)
 * - Cloudflare worker (zone creation, DNS management)
 * - DNS worker (DNS record wiring and verification)
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Redis from 'ioredis';
import { DomainWorker } from './domain-worker.js';
import { CloudflareWorker } from './cloudflare-worker.js';
import type { DomainWorkerConfig, CloudflareWorkerConfig } from '@forj/shared';

// Load environment variables from API package
// Workers share the same .env as the API server
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../api/.env');
config({ path: envPath });

console.log(`📁 Loaded environment from: ${envPath}\n`);

// Environment validation
const requiredEnvVars = [
  'REDIS_URL',
  'NAMECHEAP_API_USER',
  'NAMECHEAP_API_KEY',
  'NAMECHEAP_USERNAME',
  'NAMECHEAP_CLIENT_IP',
];

const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Parse Redis URL
const redisUrl = new URL(process.env.REDIS_URL!);
const redisConfig = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  password: redisUrl.password || undefined,
};

console.log(`🔌 Connecting to Redis at ${redisConfig.host}:${redisConfig.port}...`);

// Create Redis connection for workers
const redis = new Redis(redisConfig);

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
  process.exit(1);
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

// Worker concurrency from env (defaults to 5)
const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

// Initialize workers
console.log('\n🚀 Starting workers...\n');

// Create event publisher for SSE streaming
const eventPublisher = {
  async publishWorkerEvent(projectId: string, event: any): Promise<number | null> {
    try {
      const channel = `worker:events:${projectId}`;
      const subscribers = await redis.publish(channel, JSON.stringify(event));
      return subscribers;
    } catch (error) {
      console.error('Failed to publish event:', error);
      return null;
    }
  },
};

// Domain worker configuration
const domainWorkerConfig: DomainWorkerConfig = {
  namecheap: {
    apiUser: process.env.NAMECHEAP_API_USER!,
    apiKey: process.env.NAMECHEAP_API_KEY!,
    userName: process.env.NAMECHEAP_USERNAME!,
    clientIp: process.env.NAMECHEAP_CLIENT_IP!,
    sandbox: process.env.NAMECHEAP_SANDBOX === 'true',
  },
  redis: redisConfig,
  queue: {
    name: 'domain',
    concurrency,
    retry: {
      maxAttempts: 3,
      backoffType: 'exponential',
      backoffDelay: 5000,
    },
  },
  eventPublisher,
};

const domainWorker = new DomainWorker(domainWorkerConfig, redis);
console.log(`✅ Domain worker started (concurrency: ${concurrency})`);

// Cloudflare worker configuration
const cloudflareWorkerConfig: CloudflareWorkerConfig = {
  redis: redisConfig,
  concurrency: parseInt(process.env.CLOUDFLARE_WORKER_CONCURRENCY || '3', 10),
  // Note: CloudflareWorker publishes events to Redis internally via its publishEvent() method
  // No need to provide an external eventPublisher (would cause duplicate events)
};

const cloudflareWorker = new CloudflareWorker(cloudflareWorkerConfig);
console.log(`✅ Cloudflare worker started (concurrency: ${cloudflareWorkerConfig.concurrency})`);

// TODO: Initialize GitHub and DNS workers
// GitHub and DNS workers will be added in upcoming stacks

console.log('\n✨ Workers ready. Listening for jobs...\n');
console.log('ℹ️  Active: Domain, Cloudflare');
console.log('ℹ️  Pending: GitHub, DNS');

// Graceful shutdown
const shutdown = async () => {
  console.log('\n🛑 Shutting down workers...');

  // Use Promise.allSettled to ensure all resources close even if one fails
  const results = await Promise.allSettled([
    domainWorker.close(),
    cloudflareWorker.close(),
    redis.disconnect(),
  ]);

  // Log any shutdown failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const workerNames = ['Domain worker', 'Cloudflare worker', 'Redis connection'];
      console.error(`❌ Failed to close ${workerNames[index]}:`, result.reason);
    }
  });

  console.log('✅ All workers stopped');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
