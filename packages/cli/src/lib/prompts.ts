import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  validateProjectName,
  validateDomain,
  validateGitHubOrg,
} from './validators.js';

export interface DomainOption {
  name: string;
  price: string;
  available: boolean;
}

export interface ServiceOption {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

/**
 * Prompt for project name
 */
export async function promptProjectName(
  defaultName?: string
): Promise<string> {
  const { projectName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'Company / project name:',
      default: defaultName,
      validate: validateProjectName,
    },
  ]);

  return projectName.trim();
}

/**
 * Prompt for domain selection from available options
 */
export async function promptDomainSelection(
  domains: DomainOption[]
): Promise<string> {
  // Check if we have any available domains
  const availableDomains = domains.filter(d => d.available);

  if (domains.length === 0 || availableDomains.length === 0) {
    // No available domains, fall back to custom domain prompt
    return promptCustomDomain();
  }

  const choices = domains.map((domain) => {
    const status = domain.available
      ? chalk.green('✓')
      : chalk.red('✗');
    const price = domain.available
      ? chalk.dim(`— $${domain.price}/yr`)
      : chalk.dim('— taken');

    return {
      name: `${status} ${domain.name}  ${price}`,
      value: domain.name,
      disabled: !domain.available,
    };
  });

  const { selectedDomain } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedDomain',
      message: 'Select domain:',
      choices,
      pageSize: 10,
    },
  ]);

  return selectedDomain;
}

/**
 * Prompt for custom domain name
 */
export async function promptCustomDomain(): Promise<string> {
  const { domain } = await inquirer.prompt([
    {
      type: 'input',
      name: 'domain',
      message: 'Domain name:',
      validate: validateDomain,
    },
  ]);

  return domain.trim().toLowerCase();
}

/**
 * Prompt for service selection
 */
export async function promptServiceSelection(
  services: ServiceOption[]
): Promise<string[]> {
  const choices = services.map((service) => ({
    name: `${service.name}  ${chalk.dim(service.description)}`,
    value: service.id,
    checked: service.enabled,
  }));

  const { selectedServices } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedServices',
      message: 'Services to provision:',
      choices,
      validate: (answer: string[]) => {
        if (answer.length === 0) {
          return 'You must select at least one service';
        }
        return true;
      },
    },
  ]);

  return selectedServices;
}

/**
 * Prompt for GitHub org confirmation
 */
export async function promptGitHubOrgConfirmation(
  suggestedOrg?: string
): Promise<string> {
  const { orgName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'orgName',
      message: 'GitHub org name (confirm when created):',
      default: suggestedOrg,
      validate: validateGitHubOrg,
    },
  ]);

  return orgName.trim();
}

/**
 * Prompt for confirmation (yes/no)
 */
export async function promptConfirm(
  message: string,
  defaultValue = true
): Promise<boolean> {
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: defaultValue,
    },
  ]);

  return confirmed;
}

/**
 * Prompt for text input
 */
export async function promptInput(
  message: string,
  defaultValue?: string,
  validate?: (input: string) => string | true
): Promise<string> {
  const { value } = await inquirer.prompt([
    {
      type: 'input',
      name: 'value',
      message,
      default: defaultValue,
      validate,
    },
  ]);

  return value.trim();
}

/**
 * Prompt for selection from list
 */
export async function promptSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>
): Promise<T> {
  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message,
      choices,
    },
  ]);

  return selected;
}

/**
 * Contact info for domain registration
 */
export interface ContactInfoInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
  organizationName?: string;
}

/**
 * Prompt for ICANN-required contact info or WHOIS privacy shortcut
 */
export async function promptContactInfo(): Promise<{
  contact: ContactInfoInput;
  useWhoisPrivacy: boolean;
}> {
  const contact = await inquirer.prompt([
    {
      type: 'input',
      name: 'firstName',
      message: 'First name:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'lastName',
      message: 'Last name:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'email',
      message: 'Email:',
      validate: (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Valid email required',
    },
    {
      type: 'input',
      name: 'phone',
      message: 'Phone (e.g., +1.5551234567):',
      validate: (v: string) => {
        // Accept Namecheap format (+N.NNNNN) or common international formats (+NNNNNNN)
        if (/^\+\d{1,3}\.\d{4,14}$/.test(v)) return true;
        // Also accept plain international format and auto-convert later
        if (/^\+\d{7,15}$/.test(v)) return true;
        return 'Phone must start with + and country code (e.g., +1.5551234567 or +15551234567)';
      },
    },
    {
      type: 'input',
      name: 'address1',
      message: 'Street address:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'city',
      message: 'City:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'stateProvince',
      message: 'State / province:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'postalCode',
      message: 'Postal code:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'country',
      message: 'Country code (e.g., US, GB, DE):',
      validate: (v: string) => /^[A-Z]{2}$/i.test(v.trim()) || 'ISO 2-letter country code required',
      filter: (v: string) => v.trim().toUpperCase(),
    },
  ]);

  return {
    contact: {
      firstName: contact.firstName.trim(),
      lastName: contact.lastName.trim(),
      email: contact.email.trim(),
      phone: contact.phone.trim(),
      address1: contact.address1.trim(),
      city: contact.city.trim(),
      stateProvince: contact.stateProvince.trim(),
      postalCode: contact.postalCode.trim(),
      country: contact.country.trim(),
    },
    useWhoisPrivacy: true,
  };
}

/**
 * Prompt for services AFTER domain is registered
 */
export async function promptPostDomainServices(
  domain: string,
  projectName: string
): Promise<string[]> {
  const choices = [
    {
      name: `GitHub  ${chalk.dim(`github.com/${projectName} — org + repo`)}`,
      value: 'github',
      checked: true,
    },
    {
      name: `Cloudflare DNS  ${chalk.dim('Set up Cloudflare as your DNS provider')}`,
      value: 'cloudflare',
      checked: true,
    },
    {
      name: `Vercel  ${chalk.dim('Deploy frontend with custom domain')}`,
      value: 'vercel',
      checked: false,
    },
  ];

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'What else do you want to set up?',
      choices,
    },
  ]);

  return selected;
}
