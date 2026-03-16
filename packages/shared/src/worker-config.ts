/**
 * BullMQ Worker Configuration Constants
 *
 * Shared configuration values for all BullMQ workers to ensure
 * consistent behavior across domain, GitHub, Cloudflare, and DNS workers.
 */

/**
 * Lock duration for BullMQ workers (milliseconds)
 *
 * Time before a job lock expires. Increased from default 30s to 60s
 * to accommodate long-running API calls (Namecheap, GitHub, Cloudflare).
 *
 * @default 60000 (60 seconds)
 */
export const WORKER_LOCK_DURATION = 60000;

/**
 * Lock renewal time for BullMQ workers (milliseconds)
 *
 * How often the worker should renew the lock while processing a job.
 * Set to 15s to renew lock 4 times during the 60s lock duration.
 *
 * @default 15000 (15 seconds)
 */
export const WORKER_LOCK_RENEW_TIME = 15000;
