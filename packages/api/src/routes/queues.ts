import type { FastifyInstance } from 'fastify';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { FastifyAdapter } from '@bull-board/fastify';
import { Queue } from 'bullmq';
import { queues } from '../lib/queues.js';
import { getQueueHealth } from '../lib/queues.js';

/**
 * Queue monitoring routes
 */
export async function queueRoutes(server: FastifyInstance) {
  /**
   * GET /queues/health
   * Queue health status
   */
  server.get('/queues/health', async (request, reply) => {
    const health = await getQueueHealth();

    return {
      success: true,
      data: health,
    };
  });

  // Only register Bull Board if explicitly enabled via env flag
  // This prevents accidental exposure in staging/preview environments
  if (process.env.ENABLE_BULL_BOARD === 'true' && Object.keys(queues).length > 0) {
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath('/queues/admin');

    // Build typed queue array
    // Note: BullMQAdapter type compatibility requires this assertion due to library version mismatches
    const queueList: Queue[] = Object.values(queues).filter((q): q is Queue => q !== undefined);

    createBullBoard({
      queues: queueList.map((queue) => new BullMQAdapter(queue)) as any,
      serverAdapter,
    });

    await server.register(serverAdapter.registerPlugin(), {
      basePath: '/queues/admin',
      prefix: '/queues/admin',
    });

    server.log.info('Bull Board UI available at /queues/admin');
    server.log.warn('Bull Board has no authentication - ensure this is only enabled in secure environments');
  }
}
