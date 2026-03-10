import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ForjError } from '../utils/errors.js';

export interface ProjectConfig {
  projectId: string;
  name: string;
  domain: string;
}

/**
 * Validate project config shape
 */
function isValidProjectConfig(obj: unknown): obj is ProjectConfig {
  if (typeof obj !== 'object' || obj === null) return false;
  const config = obj as Record<string, unknown>;

  return (
    typeof config.projectId === 'string' &&
    config.projectId.length > 0 &&
    typeof config.name === 'string' &&
    typeof config.domain === 'string'
  );
}

/**
 * Read project config from .forj/config.json
 */
export function readProjectConfig(): ProjectConfig {
  const configPath = join(process.cwd(), '.forj', 'config.json');

  if (!existsSync(configPath)) {
    throw new ForjError(
      'No forj project found in current directory.\nRun `forj init` to create a new project.',
      'NO_PROJECT'
    );
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!isValidProjectConfig(parsed)) {
      throw new ForjError(
        'Invalid project config format',
        'INVALID_CONFIG'
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof ForjError) throw error;
    throw new ForjError(
      'Failed to read project config',
      'CONFIG_ERROR',
      error
    );
  }
}
