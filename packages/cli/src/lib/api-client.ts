import { getApiUrl, getAuthToken } from './config.js';
import { ForjError } from '../utils/errors.js';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
  requiresAuth?: boolean;
}

/**
 * Make an API request to the Forj backend
 */
export async function apiRequest<T = unknown>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    method = 'GET',
    body,
    headers = {},
    requiresAuth = true,
  } = options;

  const apiUrl = getApiUrl();
  const url = `${apiUrl}${endpoint}`;

  // Clone headers to avoid mutation
  const requestHeaders: Record<string, string> = { ...headers };

  // Add auth token if required
  if (requiresAuth) {
    const token = getAuthToken();
    if (!token) {
      throw new ForjError(
        'Not authenticated. Please run `forj login` first.',
        'AUTH_REQUIRED'
      );
    }
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  // Add content type for JSON bodies
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    // Parse response - check content type first
    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!isJson) {
      // Non-JSON response
      if (!response.ok) {
        throw new ForjError(
          `Request failed with status ${response.status}`,
          'API_ERROR',
          { status: response.status }
        );
      }
      // Return empty response for successful non-JSON
      return undefined as T;
    }

    // Parse JSON response
    const data: ApiResponse<T> = await response.json();

    // Handle errors
    if (!response.ok) {
      throw new ForjError(
        data.error || data.message || `Request failed with status ${response.status}`,
        'API_ERROR',
        { status: response.status, data }
      );
    }

    if (!data.success) {
      throw new ForjError(
        data.error || data.message || 'Request failed',
        'API_ERROR',
        data
      );
    }

    return data.data as T;
  } catch (error) {
    if (error instanceof ForjError) {
      throw error;
    }

    // Network or other errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new ForjError(
        `Unable to connect to Forj API at ${apiUrl}`,
        'NETWORK_ERROR',
        error
      );
    }

    throw new ForjError(
      'An unexpected error occurred while making the request',
      'UNKNOWN_ERROR',
      error
    );
  }
}

/**
 * Convenience methods for common HTTP methods
 */
export const api = {
  get: <T = unknown>(endpoint: string, requiresAuth = true) =>
    apiRequest<T>(endpoint, { method: 'GET', requiresAuth }),

  post: <T = unknown>(endpoint: string, body?: unknown, requiresAuth = true) =>
    apiRequest<T>(endpoint, { method: 'POST', body, requiresAuth }),

  put: <T = unknown>(endpoint: string, body?: unknown, requiresAuth = true) =>
    apiRequest<T>(endpoint, { method: 'PUT', body, requiresAuth }),

  delete: <T = unknown>(endpoint: string, requiresAuth = true) =>
    apiRequest<T>(endpoint, { method: 'DELETE', requiresAuth }),
};
