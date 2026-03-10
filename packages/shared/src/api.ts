/**
 * API Response Envelope
 * Used by all API endpoints for consistent response structure
 * Discriminated union ensures type safety between success and error states
 */
export type ApiResponse<T = unknown> =
  | {
      success: true;
      data?: T;
      message?: string;
    }
  | {
      success: false;
      error: string;
      message?: string;
    };

/**
 * Generic paginated response
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
