import chalk from 'chalk';

/**
 * Standard error class for CLI errors
 */
export class ForjError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ForjError';
  }
}

/**
 * Display an error message and exit
 */
export function handleError(error: unknown): never {
  if (error instanceof ForjError) {
    console.error(chalk.red('✗ Error:'), error.message);
    if (error.code) {
      console.error(chalk.dim(`  Code: ${error.code}`));
    }
    if (error.details && process.env.DEBUG) {
      console.error(chalk.dim('  Details:'), error.details);
    }
  } else if (error instanceof Error) {
    console.error(chalk.red('✗ Unexpected error:'), error.message);
    if (process.env.DEBUG) {
      console.error(chalk.dim(error.stack));
    }
  } else {
    console.error(chalk.red('✗ An unknown error occurred'));
    if (process.env.DEBUG) {
      console.error(chalk.dim(String(error)));
    }
  }

  process.exit(1);
}

/**
 * Wrap async command handlers with error handling
 */
export function withErrorHandling<T extends unknown[]>(
  fn: (...args: T) => Promise<void>
) {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      handleError(error);
    }
  };
}
