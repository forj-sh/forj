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

// Load environment variables FIRST
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../api/.env');
config({ path: envPath });

// IMPORTANT: Import Sentry AFTER dotenv config but BEFORE everything else
// Using dynamic import to ensure dotenv runs first (ESM imports are hoisted)
await import('./instrument.js');

import Redis from 'ioredis';
import { DomainWorker } from './domain-worker.js';
import { CloudflareWorker } from './cloudflare-worker.js';
import { DNSWorker } from './dns-worker.js';
import { GitHubWorker } from './github-worker.js';
import { closeDatabase } from './database.js';
import type { DomainWorkerConfig, CloudflareWorkerConfig, DNSWorkerConfig, DNSWorkerEvent, GitHubWorkerConfig, GitHubWorkerEvent } from '@forj/shared';

console.log(`📁 Loaded environment from: ${envPath}\n`);

// Environment validation
const requiredEnvVars = [
  'REDIS_URL',
  'DATABASE_URL',
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

// Factory function to create project event publishers for workers
// Uses same channel as domain worker so SSE stream receives all events
const createProjectEventPublisher = (workerName: string) => ({
  async publishEvent(event: { projectId: string } & Record<string, any>): Promise<void> {
    try {
      const channel = `worker:events:${event.projectId}`;
      await redis.publish(channel, JSON.stringify(event));
    } catch (error) {
      console.error(`Failed to publish ${workerName} event:`, error);
    }
  },
});

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
  eventPublisher: createProjectEventPublisher('Cloudflare'),
};

const cloudflareWorker = new CloudflareWorker(cloudflareWorkerConfig);
console.log(`✅ Cloudflare worker started (concurrency: ${cloudflareWorkerConfig.concurrency})`);

// DNS worker configuration
const dnsWorkerConfig: DNSWorkerConfig = {
  redis: redisConfig,
  concurrency: parseInt(process.env.DNS_WORKER_CONCURRENCY || '3', 10),
  eventPublisher: createProjectEventPublisher('DNS'),
};

const dnsWorker = new DNSWorker(dnsWorkerConfig);
console.log(`✅ DNS worker started (concurrency: ${dnsWorkerConfig.concurrency})`);

// GitHub worker configuration
const githubWorkerConfig: GitHubWorkerConfig = {
  redis: redisConfig,
  concurrency: parseInt(process.env.GITHUB_WORKER_CONCURRENCY || '3', 10),
  eventPublisher: createProjectEventPublisher('GitHub'),
};

const githubWorker = new GitHubWorker(githubWorkerConfig);
console.log(`✅ GitHub worker started (concurrency: ${githubWorkerConfig.concurrency})`);

console.log('\n✨ Workers ready. Listening for jobs...\n');
console.log('ℹ️  Active: Domain, Cloudflare, DNS, GitHub');

// Graceful shutdown
const shutdown = async () => {
  console.log('\n🛑 Shutting down workers...');

  // Use Promise.allSettled to ensure all resources close even if one fails
  const results = await Promise.allSettled([
    domainWorker.close(),
    cloudflareWorker.close(),
    dnsWorker.close(),
    githubWorker.close(),
    redis.disconnect(),
    closeDatabase(),
  ]);

  // Log any shutdown failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const workerNames = ['Domain worker', 'Cloudflare worker', 'DNS worker', 'GitHub worker', 'Redis connection', 'Database connection'];
      console.error(`❌ Failed to close ${workerNames[index]}:`, result.reason);
    }
  });

  console.log('✅ All workers stopped');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
