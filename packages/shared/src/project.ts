import type { ServiceState, ServiceStatusDisplay, ServiceType } from './services.js';

/**
 * Project schema (stored in Postgres)
 */
export interface Project {
  id: string;
  name: string;
  domain: string;
  userId: string;
  services: Record<ServiceType, ServiceState>;
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
 */
export interface ProjectStatus {
  project: string;
  domain: string;
  services: {
    domain?: ServiceStatusDisplay;
    github?: ServiceStatusDisplay;
    cloudflare?: ServiceStatusDisplay;
    dns?: ServiceStatusDisplay;
    vercel?: ServiceStatusDisplay;
    railway?: ServiceStatusDisplay;
  };
  createdAt: string;
  updatedAt: string;
}
