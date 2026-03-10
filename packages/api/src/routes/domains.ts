import type { FastifyInstance } from 'fastify';
import type { DomainCheckRequest, DomainCheckResponse } from '@forj/shared';

// Mock domain check constants
const MOCK_TLDS = ['com', 'io', 'sh', 'dev', 'app'] as const;
const AVAILABILITY_THRESHOLD = 0.3; // 70% available (random > 0.3)
const BASE_PRICE = 9.95;
const PRICE_RANGE = 10;
const MIN_QUERY_LENGTH = 2;

/**
 * Domain routes
 */
export async function domainRoutes(server: FastifyInstance) {
  /**
   * POST /domains/check
   * Check domain availability - returns mock domain options
   */
  server.post<{ Body: DomainCheckRequest }>('/domains/check', async (request, reply) => {
    const { query } = request.body || {};

    if (!query || query.length < MIN_QUERY_LENGTH) {
      return reply.status(400).send({
        success: false,
        error: `Query must be at least ${MIN_QUERY_LENGTH} characters`,
      });
    }

    // Sanitize query to get base domain name
    const baseName = query.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Validate sanitized base name
    if (!baseName || baseName.length < MIN_QUERY_LENGTH) {
      return reply.status(400).send({
        success: false,
        error: 'Query must contain at least 2 alphanumeric characters',
      });
    }

    // Mock domain availability results
    const mockDomains = MOCK_TLDS.map((tld, index) => {
      const name = index === 0 ? `${baseName}.${tld}` : `get${baseName}.${tld}`;
      const available = Math.random() > AVAILABILITY_THRESHOLD;
      const price = (BASE_PRICE + Math.random() * PRICE_RANGE).toFixed(2);

      return {
        name,
        price,
        available,
        registrar: 'Namecheap',
      };
    });

    request.log.info({
      query,
      resultCount: mockDomains.length,
    }, 'Domain availability check');

    const response: DomainCheckResponse = {
      domains: mockDomains,
    };

    return {
      success: true,
      data: response,
    };
  });
}
