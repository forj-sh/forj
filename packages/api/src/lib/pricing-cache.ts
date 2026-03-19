/**
 * Pricing cache - Redis-backed cache for Namecheap pricing
 *
 * Reference: docs/namecheap-integration.md Section 4.7
 *
 * Caches TLD pricing for 1 hour to reduce API calls to Namecheap.
 */

import type { Redis } from 'ioredis';
import type { NamecheapClient, TldPricing } from '@forj/shared';
import type { Logger } from 'pino';

/**
 * Pricing cache configuration
 */
export interface PricingCacheConfig {
  redis: Redis;
  namecheapClient: NamecheapClient;
  /** Pino logger instance for structured logging */
  logger: Logger;
  /** Cache TTL in seconds (default: 1 hour) */
  ttl?: number;
  /** Redis key prefix */
  keyPrefix?: string;
}

/**
 * Pricing cache class
 *
 * Caches Namecheap TLD pricing in Redis with automatic refresh.
 */
export class PricingCache {
  private readonly redis: Redis;
  private readonly namecheapClient: NamecheapClient;
  private readonly logger: Logger;
  private readonly ttl: number;
  private readonly keyPrefix: string;

  constructor(config: PricingCacheConfig) {
    this.redis = config.redis;
    this.namecheapClient = config.namecheapClient;
    this.logger = config.logger;
    this.ttl = config.ttl || 3600; // 1 hour default
    this.keyPrefix = config.keyPrefix || 'pricing';
  }

  /**
   * Get pricing for a TLD
   *
   * @param tld - TLD (e.g., 'COM', 'IO')
   * @param action - Action type ('REGISTER', 'RENEW')
   * @returns TLD pricing or null if not found
   */
  async getTldPricing(
    tld: string,
    action: 'REGISTER' | 'RENEW' = 'REGISTER'
  ): Promise<TldPricing | null> {
    const key = this.getCacheKey(tld, action);

    try {
      // Try to get from cache first
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached);
      }

      // Cache miss - fetch from Namecheap
      const pricing = await this.fetchAndCachePricing(tld, action);
      return pricing;
    } catch (error) {
      this.logger.error({ error, tld, action }, `Failed to get pricing for ${tld}`);
      return null;
    }
  }

  /**
   * Get pricing for multiple TLDs
   *
   * @param tlds - Array of TLDs
   * @param action - Action type
   * @returns Map of TLD to pricing
   */
  async getMultipleTldPricing(
    tlds: string[],
    action: 'REGISTER' | 'RENEW' = 'REGISTER'
  ): Promise<Map<string, TldPricing | null>> {
    const results = new Map<string, TldPricing | null>();

    // Fetch all in parallel
    await Promise.all(
      tlds.map(async (tld) => {
        const pricing = await this.getTldPricing(tld, action);
        results.set(tld.toUpperCase(), pricing);
      })
    );

    return results;
  }

  /**
   * Refresh pricing cache for a TLD
   *
   * @param tld - TLD to refresh
   * @param action - Action type
   * @returns Updated pricing
   */
  async refreshTldPricing(
    tld: string,
    action: 'REGISTER' | 'RENEW' = 'REGISTER'
  ): Promise<TldPricing | null> {
    return this.fetchAndCachePricing(tld, action);
  }

  /**
   * Fetch pricing from Namecheap and cache it
   */
  private async fetchAndCachePricing(
    tld: string,
    action: 'REGISTER' | 'RENEW'
  ): Promise<TldPricing | null> {
    try {
      // Fetch from Namecheap
      const pricingList = await this.namecheapClient.getTldPricing(tld, action);

      // Find pricing for 1 year registration/renewal
      const pricing = pricingList.find(
        (p) => p.tld.toUpperCase() === tld.toUpperCase() && p.duration === 1 && p.durationType === 'YEAR'
      );

      if (!pricing) {
        this.logger.warn({ tld, action }, `No pricing found for ${tld} ${action}`);
        return null;
      }

      // Cache it
      const key = this.getCacheKey(tld, action);
      await this.redis.setex(key, this.ttl, JSON.stringify(pricing));

      return pricing;
    } catch (error) {
      this.logger.error({ error, tld, action }, `Failed to fetch pricing for ${tld}`);
      return null;
    }
  }

  /**
   * Get cache key for a TLD and action
   */
  private getCacheKey(tld: string, action: string): string {
    return `${this.keyPrefix}:${tld.toUpperCase()}:${action}`;
  }

  /**
   * Clear all pricing cache
   *
   * Uses SCAN instead of KEYS for non-blocking iteration over Redis keys.
   * KEYS is an O(N) blocking operation that can cause latency spikes in production.
   */
  async clearAll(): Promise<void> {
    try {
      const stream = this.redis.scanStream({
        match: `${this.keyPrefix}:*`,
        count: 100, // Fetch 100 keys per iteration
      });

      const pipeline = this.redis.pipeline();
      let keysDeleted = 0;

      // Collect keys from stream and queue deletions
      for await (const keys of stream) {
        if (keys.length > 0) {
          for (const key of keys) {
            pipeline.del(key);
            keysDeleted++;
          }
        }
      }

      // Execute all queued deletions
      if (keysDeleted > 0) {
        await pipeline.exec();
        this.logger.info({ keysDeleted }, 'Pricing cache cleared');
      } else {
        this.logger.info('Pricing cache already empty');
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to clear pricing cache');
    }
  }

  /**
   * Check domain for premium pricing
   *
   * Stack 11: Added to support premium domain pricing in Stripe checkout
   *
   * @param domainName - Full domain name (e.g., 'premium.com')
   * @returns Domain check result with premium pricing, or null if unavailable
   */
  async checkDomainPremiumPrice(
    domainName: string
  ): Promise<{ isPremium: boolean; premiumPrice?: number; icannFee?: number } | null> {
    try {
      const results = await this.namecheapClient.checkDomains([domainName]);

      if (results.length === 0) {
        this.logger.warn({ domainName }, 'No results from domain check');
        return null;
      }

      const result = results[0];

      return {
        isPremium: result.isPremium,
        premiumPrice: result.isPremium ? result.premiumRegistrationPrice : undefined,
        icannFee: result.icannFee,
      };
    } catch (error) {
      this.logger.error({ error, domainName }, 'Failed to check domain for premium pricing');
      return null;
    }
  }

  /**
   * Warm up cache with common TLDs
   *
   * Preloads pricing for popular TLDs to reduce latency.
   */
  async warmup(tlds: string[] = ['COM', 'NET', 'ORG', 'IO', 'CO', 'XYZ', 'APP', 'DEV']): Promise<void> {
    this.logger.info({ tldCount: tlds.length }, `Warming up pricing cache for ${tlds.length} TLDs...`);

    await Promise.all(
      tlds.map(async (tld) => {
        try {
          await this.getTldPricing(tld, 'REGISTER');
          await this.getTldPricing(tld, 'RENEW');
        } catch (error) {
          this.logger.error({ error, tld }, `Failed to warm up pricing for ${tld}`);
        }
      })
    );

    this.logger.info({ tldCount: tlds.length }, 'Pricing cache warmup complete');
  }
}
