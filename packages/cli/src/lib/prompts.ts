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
