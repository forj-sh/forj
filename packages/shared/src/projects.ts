import type { ServiceType } from './services.js';

/**
 * Project initialization request
 * POST /projects/init
 */
export interface ProjectInitRequest {
  name: string;
  domain: string;
  services: ServiceType[];
  githubOrg?: string;
}

/**
 * Project initialization response
 */
export interface ProjectInitResponse {
  projectId: string;
}

/**
 * Add service request
 * POST /projects/:id/services
 * Response: ApiResponse<{ message: string }> with success status
 */
export interface AddServiceRequest {
  service: ServiceType;
}
