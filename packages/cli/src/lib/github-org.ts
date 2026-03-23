/**
 * GitHub org creation + OAuth app authorization flow.
 *
 * Extracted from init.ts so both `init` and `add` commands can reuse it.
 */

import inquirer from 'inquirer';
import open from 'open';
import { FORJ_GITHUB_APP_ID } from '@forj/shared';
import { api } from './api-client.js';
import { promptGitHubOrgConfirmation } from './prompts.js';
import { logger } from '../utils/logger.js';

/**
 * Guide the user through GitHub org creation + OAuth app authorization.
 *
 * New GitHub orgs block third-party OAuth apps by default, so we must
 * explicitly grant Forj access before we can create repos in the org.
 */
export async function promptGitHubOrgSetup(suggestedOrg?: string): Promise<string> {
  const createOrgUrl = 'https://github.com/organizations/new';

  logger.warn('GitHub org must be created manually — takes 15 seconds.');
  logger.dim(`Create the organization at: ${createOrgUrl}`);
  logger.newline();

  const orgName = await promptGitHubOrgConfirmation(suggestedOrg);

  // Build the per-org OAuth app grant URL
  const grantUrl = `https://github.com/orgs/${orgName}/policies/applications/${FORJ_GITHUB_APP_ID}`;

  logger.newline();
  logger.warn('Grant Forj access to your new org (required for repo creation).');
  logger.dim(`Approve at: ${grantUrl}`);
  logger.newline();

  try {
    await open(grantUrl);
  } catch {
    // Browser open is best-effort; URL is printed above
  }

  await inquirer.prompt([
    {
      type: 'input',
      name: 'confirm',
      message: 'Press Enter after granting access...',
    },
  ]);

  // Verify access by calling the API to check org membership
  const spinner = logger.spinner('Verifying org access...');
  spinner.start();

  try {
    await api.get(`/github/verify-org/${orgName}`);
    spinner.succeed('GitHub org access verified');
  } catch {
    spinner.warn('Could not verify org access — provisioning will attempt anyway');
  }

  return orgName;
}
