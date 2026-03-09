import { Command } from 'commander';
import {
  promptProjectName,
  promptDomainSelection,
  promptServiceSelection,
  promptConfirm,
  DomainOption,
  ServiceOption,
} from '../lib/prompts.js';
import { withErrorHandling } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function createTestPromptsCommand(): Command {
  const command = new Command('test-prompts');

  command
    .description('Test interactive prompts (dev only)')
    .action(
      withErrorHandling(async () => {
        logger.info('Testing interactive prompts...');
        logger.newline();

        // Test project name
        const projectName = await promptProjectName('my-startup');
        logger.success(`Project name: ${projectName}`);
        logger.newline();

        // Test domain selection
        const domains: DomainOption[] = [
          { name: 'example.com', price: '12.95', available: false },
          { name: 'getexample.com', price: '9.95', available: true },
          { name: 'example.io', price: '39.95', available: true },
        ];
        const domain = await promptDomainSelection(domains);
        logger.success(`Selected domain: ${domain}`);
        logger.newline();

        // Test service selection
        const services: ServiceOption[] = [
          {
            id: 'domain',
            name: 'Domain registration',
            description: 'Namecheap reseller',
            enabled: true,
          },
          {
            id: 'github',
            name: 'GitHub org + repos',
            description: 'github.com/your-org',
            enabled: true,
          },
          {
            id: 'cloudflare',
            name: 'Cloudflare zone + DNS',
            description: 'Auto-configured records',
            enabled: true,
          },
          {
            id: 'vercel',
            name: 'Vercel project',
            description: 'Linked to GitHub',
            enabled: false,
          },
        ];
        const selectedServices = await promptServiceSelection(services);
        logger.success(`Selected services: ${selectedServices.join(', ')}`);
        logger.newline();

        // Test confirmation
        const confirmed = await promptConfirm('Continue with provisioning?');
        logger.success(`Confirmed: ${confirmed}`);
      })
    );

  return command;
}
