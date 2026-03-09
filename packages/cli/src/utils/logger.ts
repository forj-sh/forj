import chalk from 'chalk';
import ora, { Ora } from 'ora';

/**
 * CLI logger with consistent formatting
 */
export const logger = {
  /**
   * Display success message
   */
  success(message: string): void {
    console.log(chalk.green('✓'), message);
  },

  /**
   * Display error message (non-fatal)
   */
  error(message: string): void {
    console.error(chalk.red('✗'), message);
  },

  /**
   * Display warning message
   */
  warn(message: string): void {
    console.warn(chalk.yellow('⚠'), message);
  },

  /**
   * Display info message
   */
  info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  },

  /**
   * Display plain message
   */
  log(message: string): void {
    console.log(message);
  },

  /**
   * Display dimmed/secondary message
   */
  dim(message: string): void {
    console.log(chalk.dim(message));
  },

  /**
   * Create a spinner for long-running operations
   */
  spinner(text: string): Ora {
    return ora({
      text,
      color: 'cyan',
    });
  },

  /**
   * Display a blank line
   */
  newline(): void {
    console.log();
  },
};
