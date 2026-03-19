/**
 * Stripe checkout flow for CLI
 *
 * Opens browser for payment, polls checkout session status until paid.
 */

import open from 'open';
import { api } from './api-client.js';
import { logger } from '../utils/logger.js';
import { ForjError } from '../utils/errors.js';

interface CheckoutSessionStatus {
  id: string;
  status: string;
  paymentStatus: string;
  amountTotal: number;
  currency: string;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (matches Stripe session expiry)

/**
 * Open Stripe Checkout in browser and wait for payment confirmation.
 *
 * Returns when payment_status === 'paid'.
 * Throws on timeout, cancellation, or payment failure.
 */
export async function openCheckoutAndWaitForPayment(
  sessionUrl: string,
  sessionId: string
): Promise<void> {
  // Open Stripe checkout in browser
  logger.dim('Opening payment page in your browser...');
  try {
    await open(sessionUrl);
  } catch {
    logger.warn('Could not open browser automatically.');
    logger.info(`Please visit: ${sessionUrl}`);
  }

  const spinner = logger.spinner('Waiting for payment...');
  spinner.start();

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const session = await api.get<CheckoutSessionStatus>(
        `/stripe/checkout-session/${sessionId}`
      );

      if (session.paymentStatus === 'paid') {
        spinner.succeed('Payment confirmed');
        return;
      }

      // Stripe session expired or was cancelled
      if (session.status === 'expired') {
        spinner.fail('Checkout session expired');
        throw new ForjError(
          'Stripe checkout session expired. Please try again.',
          'PAYMENT_EXPIRED'
        );
      }
    } catch (error) {
      if (error instanceof ForjError) {
        // Network errors are transient — keep polling
        if (error.code === 'NETWORK_ERROR') {
          logger.dim('Network issue, retrying payment check...');
        } else {
          throw error;
        }
      }
      // Non-ForjError failures are also treated as transient
    }
  }

  spinner.fail('Payment timed out');
  throw new ForjError(
    'Payment timed out after 30 minutes. Please try again.',
    'PAYMENT_TIMEOUT'
  );
}
