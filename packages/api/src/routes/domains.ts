import type { FastifyInstance } from 'fastify';

// Mock domain check constants
const AVAILABILITY_THRESHOLD = 0.3; // 70% available (random > 0.3)
const BASE_PRICE = 9.95;
const PRICE_RANGE = 10;

/**
 * Mock domain routes (used when Namecheap routes are not enabled)
 *
 * Accepts { domains: string[] } to match the real Namecheap route contract.
 * Returns the same response shape: { domain, available, price (number), registrar }.
 */
export async function domainRoutes(server: FastifyInstance) {
  /**
   * POST /domains/check
   * Check domain availability - returns mock results matching Namecheap response shape
   */
  server.post<{ Body: { domains?: string[]; query?: string } }>(
    '/domains/check',
    async (request, reply) => {
      const { domains, query } = request.body || {};

      // Accept either { domains: [...] } or legacy { query: "name" }
      let domainsToCheck: string[];

      if (domains && domains.length > 0) {
        domainsToCheck = domains;
      } else if (query && query.length >= 2) {
        // Legacy fallback: generate mock domains from query
        const baseName = query.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!baseName || baseName.length < 2) {
          return reply.status(400).send({
            success: false,
            error: 'Query must contain at least 2 alphanumeric characters',
          });
        }
        domainsToCheck = [
          `${baseName}.com`,
          `${baseName}.io`,
          `${baseName}.sh`,
          `get${baseName}.com`,
          `try${baseName}.com`,
        ];
      } else {
        return reply.status(400).send({
          success: false,
          error: 'Either domains[] or query is required',
        });
      }

      const mockResults = domainsToCheck.map((domain) => {
        const available = Math.random() > AVAILABILITY_THRESHOLD;
        const price = BASE_PRICE + Math.random() * PRICE_RANGE;

        return {
          domain,
          available,
          isPremium: false,
          price,
          retailPrice: price * 1.2,
          icannFee: 0.18,
          registrar: 'Namecheap',
        };
      });

      request.log.info({
        domainsChecked: domainsToCheck.length,
      }, 'Mock domain availability check');

      return {
        success: true,
        data: {
          domains: mockResults,
        },
      };
    }
  );
}
