import type { ServiceState, ServiceStatusDisplay, ServiceType } from './services.js';

/**
 * Project schema (stored in Postgres)
 * Services are optional to support incremental provisioning
 */
export interface Project {
  id: string;
  name: string;
  domain: string;
  userId: string;
  services: Partial<Record<ServiceType, ServiceState>>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Project configuration (stored in .forj/config.json)
 */
export interface ProjectConfig {
  projectId: string;
  name: string;
  domain: string;
}

/**
 * Project status response (GET /projects/:id/status)
 * Uses Partial<Record<>> to automatically include all ServiceType values
 */
export interface ProjectStatus {
  project: string;
  domain: string;
  services: Partial<Record<ServiceType, ServiceStatusDisplay>>;
  createdAt: string;
  updatedAt: string;
}
