import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Custom error handler for Fastify
 */
export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { statusCode = 500, message } = error;

  // Log error
  request.log.error({
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code,
    },
    request: {
      method: request.method,
      url: request.url,
    },
  }, 'Request error');

  // Send error response
  reply.status(statusCode).send({
    success: false,
    error: message,
    code: error.code,
    ...(process.env.NODE_ENV !== 'production' && {
      stack: error.stack,
    }),
  });
}
