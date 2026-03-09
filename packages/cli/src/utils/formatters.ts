import chalk from 'chalk';

/**
 * Format a status indicator
 */
export function formatStatus(
  status: 'success' | 'error' | 'pending' | 'running'
): string {
  switch (status) {
    case 'success':
      return chalk.green('✓');
    case 'error':
      return chalk.red('✗');
    case 'pending':
      return chalk.dim('○');
    case 'running':
      return chalk.cyan('◐');
    default:
      return chalk.dim('–');
  }
}

/**
 * Format a service name with status
 */
export function formatServiceStatus(
  name: string,
  status: 'success' | 'error' | 'pending' | 'running',
  detail?: string
): string {
  const indicator = formatStatus(status);
  const formattedDetail = detail ? chalk.dim(` — ${detail}`) : '';
  return `${indicator} ${name}${formattedDetail}`;
}

/**
 * Format a duration in milliseconds to human-readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format a timestamp to relative time
 */
export function formatRelativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Handle future timestamps (negative diff)
  if (diffMs < 0) {
    return 'just now'; // Treat future/clock-skewed times as current
  }

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 5) return `${seconds}s ago`;
  return 'just now';
}

/**
 * Format a table row
 */
export function formatTableRow(
  label: string,
  value: string,
  labelWidth = 15
): string {
  const paddedLabel = label.padEnd(labelWidth);
  return `${chalk.dim(paddedLabel)} ${value}`;
}

/**
 * Format a list of items with bullets
 */
export function formatList(items: string[], bullet = '•'): string {
  return items.map((item) => `  ${chalk.dim(bullet)} ${item}`).join('\n');
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes < 0) {
    return 'N/A';
  }
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format a URL for display (truncate if too long)
 */
export function formatUrl(url: string, maxLength = 60): string {
  if (url.length <= maxLength) {
    return chalk.cyan(url);
  }

  const truncated = url.substring(0, maxLength - 3) + '...';
  return chalk.cyan(truncated);
}
