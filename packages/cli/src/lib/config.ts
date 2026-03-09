import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { logger } from '../utils/logger.js';

/**
 * Configuration directory in user's home
 */
const CONFIG_DIR = join(homedir(), '.forj');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface ForjConfig {
  apiUrl?: string;
  authToken?: string;
  currentProject?: string;
}

/**
 * Ensure the .forj directory exists with secure permissions
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Validate config object shape
 */
function isValidConfig(obj: unknown): obj is ForjConfig {
  if (typeof obj !== 'object' || obj === null) return false;
  const config = obj as Record<string, unknown>;

  // Optional fields must have correct types if present
  if (config.apiUrl !== undefined && typeof config.apiUrl !== 'string') return false;
  if (config.authToken !== undefined && typeof config.authToken !== 'string') return false;
  if (config.currentProject !== undefined && typeof config.currentProject !== 'string') return false;

  return true;
}

/**
 * Read configuration from disk
 */
export function readConfig(): ForjConfig {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    return {};
  }

  try {
    const contents = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(contents);

    if (!isValidConfig(parsed)) {
      logger.warn('Config file has invalid format, using defaults');
      return {};
    }

    return parsed;
  } catch (error) {
    logger.warn('Failed to read config file, using defaults');
    return {};
  }
}

/**
 * Write configuration to disk with secure permissions
 */
export function writeConfig(config: ForjConfig): void {
  ensureConfigDir();

  try {
    writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2),
      { mode: 0o600, encoding: 'utf-8' }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write config file: ${message}`);
  }
}

/**
 * Update partial configuration
 */
export function updateConfig(partial: Partial<ForjConfig>): void {
  const current = readConfig();
  writeConfig({ ...current, ...partial });
}

/**
 * Get API URL from config or environment
 */
export function getApiUrl(): string {
  const config = readConfig();
  return (
    config.apiUrl ||
    process.env.FORJ_API_URL ||
    'https://api.forj.sh'
  );
}

/**
 * Get auth token from config
 */
export function getAuthToken(): string | undefined {
  const config = readConfig();
  return config.authToken;
}

/**
 * Set auth token in config
 */
export function setAuthToken(token: string): void {
  updateConfig({ authToken: token });
}

/**
 * Clear auth token from config
 */
export function clearAuthToken(): void {
  updateConfig({ authToken: undefined });
}
