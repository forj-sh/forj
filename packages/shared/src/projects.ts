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
 */
export interface AddServiceRequest {
  service: ServiceType;
}

/**
 * Add service response
 * Note: Wrapped in ApiResponse envelope by API layer
 */
export interface AddServiceResponse {
  message: string;
}
