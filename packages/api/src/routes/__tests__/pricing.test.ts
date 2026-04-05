/**
 * Unit tests for the public pricing route.
 *
 * Uses a minimal Fastify instance with a mocked PricingCache to avoid
 * needing Redis, Postgres, or Namecheap credentials in CI.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import { pricingRoutes } from '../pricing.js';
import type { PricingCache } from '../../lib/pricing-cache.js';
import type { TldPricing } from '@forj/shared';

function mockTld(tld: string, wholesale: number, icannFee = 0.18): TldPricing {
  return {
    tld,
    action: 'REGISTER',
    duration: 1,
    durationType: 'YEAR',
    wholesalePrice: wholesale,
    retailPrice: wholesale + 2,
    icannFee,
    currency: 'USD',
  };
}

describe('GET /v1/pricing', () => {
  let server: FastifyInstance;
  let mockPricingCache: jest.Mocked<Pick<PricingCache, 'getMultipleTldPricing'>>;

  beforeEach(async () => {
    mockPricingCache = {
      getMultipleTldPricing: jest.fn(),
    };

    server = Fastify({ logger: false });
    await server.register(async (instance) => {
      await pricingRoutes(instance, mockPricingCache as unknown as PricingCache);
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns flat service fee plus per-TLD pricing', async () => {
    mockPricingCache.getMultipleTldPricing.mockResolvedValue(
      new Map<string, TldPricing | null>([
        ['COM', mockTld('COM', 10.28)],
        ['IO', mockTld('IO', 39.5)],
        ['DEV', mockTld('DEV', 14.0)],
        ['NET', null], // simulate one cache miss
        ['ORG', mockTld('ORG', 11.5)],
        ['CO', mockTld('CO', 25.0)],
        ['XYZ', mockTld('XYZ', 2.0)],
        ['APP', mockTld('APP', 14.0)],
      ])
    );

    const response = await server.inject({ method: 'GET', url: '/v1/pricing' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.success).toBe(true);
    expect(body.data.currency).toBe('USD');
    expect(body.data.serviceFee).toEqual({
      amount: 2.0,
      per: 'project',
      description: expect.stringContaining('Flat forj fee'),
    });

    // Total = wholesale + icannFee + serviceFee, rounded to cents
    expect(body.data.domains.com).toEqual({
      wholesale: 10.28,
      icannFee: 0.18,
      total: 12.46,
      currency: 'USD',
    });
    expect(body.data.domains.io.total).toBe(41.68);
    expect(body.data.domains.dev.total).toBe(16.18);

    // Cache miss should be filtered out, not returned as null
    expect(body.data.domains.net).toBeUndefined();

    expect(body.data.included).toEqual(expect.arrayContaining([
      expect.stringContaining('Domain registration'),
      expect.stringContaining('GitHub'),
      expect.stringContaining('Cloudflare'),
    ]));

    expect(body.data.notes.humanReadable).toBe('https://forj.sh/pricing.md');
    expect(body.data.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // `updatedAt` is deliberately NOT returned — pricing freshness is
    // controlled by PricingCache, not by this response's timestamp.
    expect(body.data.updatedAt).toBeUndefined();
  });

  it('honors the FORJ_SERVICE_FEE_CENTS env override', async () => {
    const original = process.env.FORJ_SERVICE_FEE_CENTS;
    process.env.FORJ_SERVICE_FEE_CENTS = '350'; // $3.50 instead of $2.00
    try {
      mockPricingCache.getMultipleTldPricing.mockResolvedValue(
        new Map([['COM', mockTld('COM', 10.28)]])
      );

      const response = await server.inject({ method: 'GET', url: '/v1/pricing' });
      const body = JSON.parse(response.body);

      expect(body.data.serviceFee.amount).toBe(3.5);
      // Total must reflect the overridden fee so it matches Stripe checkout
      expect(body.data.domains.com.total).toBe(13.96); // 10.28 + 0.18 + 3.50
    } finally {
      if (original === undefined) delete process.env.FORJ_SERVICE_FEE_CENTS;
      else process.env.FORJ_SERVICE_FEE_CENTS = original;
    }
  });

  it('computes totals in integer cents (no FP drift)', async () => {
    // Values chosen to expose classic floating-point drift:
    // 0.1 + 0.2 !== 0.3 in IEEE 754. End-to-end cents math must round cleanly.
    mockPricingCache.getMultipleTldPricing.mockResolvedValue(
      new Map([['COM', mockTld('COM', 0.1, 0.2)]])
    );

    const response = await server.inject({ method: 'GET', url: '/v1/pricing' });
    const body = JSON.parse(response.body);

    expect(body.data.domains.com.total).toBe(2.3); // 0.10 + 0.20 + 2.00
  });

  it('requests REGISTER pricing for all public TLDs', async () => {
    mockPricingCache.getMultipleTldPricing.mockResolvedValue(new Map());

    await server.inject({ method: 'GET', url: '/v1/pricing' });

    expect(mockPricingCache.getMultipleTldPricing).toHaveBeenCalledTimes(1);
    const [tlds, action] = mockPricingCache.getMultipleTldPricing.mock.calls[0];
    expect(action).toBe('REGISTER');
    expect(tlds).toEqual(
      expect.arrayContaining(['COM', 'NET', 'ORG', 'IO', 'CO', 'XYZ', 'APP', 'DEV'])
    );
  });

  it('sets a public Cache-Control header', async () => {
    mockPricingCache.getMultipleTldPricing.mockResolvedValue(new Map());

    const response = await server.inject({ method: 'GET', url: '/v1/pricing' });

    expect(response.headers['cache-control']).toBe('public, max-age=300');
  });

  it('returns an empty domains object when the cache has no data', async () => {
    mockPricingCache.getMultipleTldPricing.mockResolvedValue(new Map());

    const response = await server.inject({ method: 'GET', url: '/v1/pricing' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.domains).toEqual({});
    // Service fee is still advertised even when upstream pricing is unavailable
    expect(body.data.serviceFee.amount).toBe(2.0);
  });

  it('skips TLDs priced in a non-USD currency', async () => {
    mockPricingCache.getMultipleTldPricing.mockResolvedValue(
      new Map<string, TldPricing | null>([
        ['COM', mockTld('COM', 10.28)],
        // Simulate Namecheap returning EUR for a TLD — must not be summed
        // with the USD service fee
        ['EU', { ...mockTld('EU', 8.5), currency: 'EUR' }],
      ])
    );

    const response = await server.inject({ method: 'GET', url: '/v1/pricing' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.domains.com).toBeDefined();
    expect(body.data.domains.eu).toBeUndefined();
  });

  it('treats a missing icannFee as 0 rather than producing NaN', async () => {
    const pricingWithoutIcannFee = {
      ...mockTld('COM', 10.28),
      icannFee: undefined as unknown as number,
    };
    mockPricingCache.getMultipleTldPricing.mockResolvedValue(
      new Map<string, TldPricing | null>([['COM', pricingWithoutIcannFee]])
    );

    const response = await server.inject({ method: 'GET', url: '/v1/pricing' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.domains.com).toEqual({
      wholesale: 10.28,
      icannFee: 0,
      total: 12.28, // 10.28 + 0 + 2.00
      currency: 'USD',
    });
    expect(Number.isNaN(body.data.domains.com.total)).toBe(false);
  });

  it('requires no authentication', async () => {
    mockPricingCache.getMultipleTldPricing.mockResolvedValue(
      new Map([['COM', mockTld('COM', 10.28)]])
    );

    const response = await server.inject({
      method: 'GET',
      url: '/v1/pricing',
      // Intentionally no Authorization header
    });

    expect(response.statusCode).toBe(200);
  });
});
