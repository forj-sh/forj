/**
 * Input validation utilities
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Domain must have at least one dot (TLD required) and valid labels
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const PROJECT_NAME_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Validate email address
 */
export function validateEmail(email: string): string | true {
  if (!email || email.trim().length === 0) {
    return 'Email is required';
  }

  if (!EMAIL_REGEX.test(email.trim())) {
    return 'Please enter a valid email address';
  }

  return true;
}

/**
 * Validate domain name
 */
export function validateDomain(domain: string): string | true {
  if (!domain || domain.trim().length === 0) {
    return 'Domain is required';
  }

  const cleanDomain = domain.trim().toLowerCase();

  if (!DOMAIN_REGEX.test(cleanDomain)) {
    return 'Please enter a valid domain name (e.g., example.com)';
  }

  if (cleanDomain.length > 253) {
    return 'Domain name is too long (max 253 characters)';
  }

  return true;
}

/**
 * Validate project name
 */
export function validateProjectName(name: string): string | true {
  if (!name || name.trim().length === 0) {
    return 'Project name is required';
  }

  const cleanName = name.trim();

  if (!PROJECT_NAME_REGEX.test(cleanName)) {
    return 'Project name must contain only letters, numbers, and hyphens, and cannot start or end with a hyphen';
  }

  if (cleanName.length < 2) {
    return 'Project name must be at least 2 characters';
  }

  if (cleanName.length > 63) {
    return 'Project name is too long (max 63 characters)';
  }

  return true;
}

/**
 * Validate GitHub org name
 */
export function validateGitHubOrg(org: string): string | true {
  if (!org || org.trim().length === 0) {
    return 'GitHub org name is required';
  }

  const cleanOrg = org.trim();

  if (cleanOrg.length > 39) {
    return 'GitHub org name must be 39 characters or less.';
  }

  // GitHub usernames/orgs: alphanumeric and hyphens, cannot start/end with hyphen, no consecutive hyphens
  const githubRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/i;

  if (!githubRegex.test(cleanOrg)) {
    return 'Invalid GitHub org name. Must be alphanumeric, may contain single hyphens, but not at the start or end.';
  }

  return true;
}

/**
 * Validate required string
 */
export function validateRequired(fieldName: string) {
  return (value: string): string | true => {
    if (!value || value.trim().length === 0) {
      return `${fieldName} is required`;
    }
    return true;
  };
}
