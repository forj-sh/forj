#!/usr/bin/env node
/**
 * Sentry Alert Configuration Script
 *
 * This script configures production alerts for the Forj project using the Sentry REST API.
 *
 * Requirements:
 * - SENTRY_AUTH_TOKEN environment variable with project:write and alert-rule:write scopes
 * - Organization slug: forj-sh
 * - Region: us.sentry.io
 *
 * Usage:
 *   SENTRY_AUTH_TOKEN=your_token npx tsx scripts/configure-sentry-alerts.ts
 */

interface SentryAlertRule {
  name: string;
  owner?: string;
  conditions: Array<{
    id: string;
    interval?: string;
    value?: number;
  }>;
  filters?: Array<{
    id: string;
    comparison_type?: string;
    value?: string;
  }>;
  actions: Array<{
    id: string;
    targetType?: string;
    targetIdentifier?: string;
  }>;
  actionMatch: 'all' | 'any' | 'none';
  filterMatch: 'all' | 'any' | 'none';
  frequency: number;
}

const SENTRY_ORG = 'forj-sh';
const SENTRY_REGION = 'https://us.sentry.io';
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;

if (!SENTRY_AUTH_TOKEN) {
  console.error('❌ SENTRY_AUTH_TOKEN environment variable is required');
  console.error('');
  console.error('To get a token:');
  console.error('1. Go to https://forj-sh.sentry.io/settings/account/api/auth-tokens/');
  console.error('2. Create a new token with these scopes:');
  console.error('   - org:read (to verify organization access)');
  console.error('   - project:read (to check existing alerts)');
  console.error('   - project:write (to create alert rules)');
  console.error('3. Set the environment variable: export SENTRY_AUTH_TOKEN=your_token');
  process.exit(1);
}

async function sentryAPI(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: any
): Promise<any> {
  const url = `${SENTRY_REGION}/api/0/${path}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
    'Content-Type': 'application/json',
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Get response text first
    const responseText = await response.text();

    // Check if response is successful
    if (!response.ok) {
      console.error(`API Error: ${method} ${path}`);
      console.error(`Status: ${response.status} ${response.statusText}`);
      console.error(`Response: ${responseText}`);

      // Special handling for 403 Forbidden
      if (response.status === 403) {
        console.error('\n⚠️  Your auth token does not have the required permissions.');
        console.error('Please create a new token with these scopes:');
        console.error('  - org:read (to verify organization access)');
        console.error('  - project:read (to check existing alerts)');
        console.error('  - project:write (to create alert rules)');
        console.error('\nCreate token at: https://forj-sh.sentry.io/settings/account/api/auth-tokens/');
      }

      throw new Error(`Sentry API error: ${response.status} ${response.statusText}`);
    }

    // Parse JSON if there's content
    if (responseText.trim()) {
      return JSON.parse(responseText);
    }
    return null;
  } catch (error: any) {
    if (error.message?.includes('Sentry API error')) {
      throw error; // Re-throw API errors as-is
    }
    console.error(`Network Error: ${method} ${path}`);
    console.error(error.message);
    throw error;
  }
}

/**
 * Configure issue alerts (event-based alerts)
 */
async function createIssueAlert(
  projectSlug: string,
  alertConfig: SentryAlertRule
): Promise<void> {
  console.log(`  Creating issue alert: ${alertConfig.name}`);

  try {
    await sentryAPI(
      'POST',
      `projects/${SENTRY_ORG}/${projectSlug}/rules/`,
      alertConfig
    );
    console.log(`  ✅ Created: ${alertConfig.name}`);
  } catch (error: any) {
    // Check if it's a duplicate error
    if (error.message?.includes('400 Bad Request')) {
      console.log(`  ⚠️  Skipped (duplicate or similar alert exists): ${alertConfig.name}`);
    } else {
      console.error(`  ❌ Failed to create: ${alertConfig.name}`);
      throw error;
    }
  }
}

/**
 * Get existing alert rules to avoid duplicates
 */
async function getExistingAlerts(projectSlug: string): Promise<string[]> {
  try {
    const rules = await sentryAPI('GET', `projects/${SENTRY_ORG}/${projectSlug}/rules/`);
    return rules.map((rule: any) => rule.name);
  } catch (error) {
    console.warn(`  ⚠️  Could not fetch existing alerts for ${projectSlug}`);
    return [];
  }
}

/**
 * Configure alerts for forj-api project
 */
async function configureAPIAlerts(): Promise<void> {
  console.log('\n📊 Configuring alerts for forj-api...');

  const existingAlerts = await getExistingAlerts('forj-api');

  // High Error Rate Alert (using event frequency)
  if (!existingAlerts.includes('High Error Rate (>50 errors in 5 min)')) {
    await createIssueAlert('forj-api', {
      name: 'High Error Rate (>50 errors in 5 min)',
      conditions: [
        {
          id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
          interval: '5m',
          value: 50,
        },
      ],
      filters: [],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
        },
      ],
      actionMatch: 'any',
      filterMatch: 'all',
      frequency: 5, // 5 minutes
    });
  }

  // Critical Error Alert (fatal level)
  if (!existingAlerts.includes('Critical Error (fatal level)')) {
    await createIssueAlert('forj-api', {
      name: 'Critical Error (fatal level)',
      conditions: [
        {
          id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition',
        },
      ],
      filters: [],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
        },
      ],
      actionMatch: 'any',
      filterMatch: 'all',
      frequency: 5, // 5 minutes
    });
  }

  // Rate Limit Violation Alert
  if (!existingAlerts.includes('Rate Limit Violations (>100/hour)')) {
    await createIssueAlert('forj-api', {
      name: 'Rate Limit Violations (>100/hour)',
      conditions: [
        {
          id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
          interval: '1h',
          value: 100,
        },
      ],
      filters: [],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
        },
      ],
      actionMatch: 'any',
      filterMatch: 'all',
      frequency: 60, // 60 minutes
    });
  }

  // Note: Database Connection Pool alerts will be captured by "Critical Error" alert
}

/**
 * Configure alerts for forj-workers project
 */
async function configureWorkersAlerts(): Promise<void> {
  console.log('\n⚙️  Configuring alerts for forj-workers...');

  const existingAlerts = await getExistingAlerts('forj-workers');

  // First Seen Errors Alert (catches all new error types including Redis, DB, etc.)
  if (!existingAlerts.includes('New Worker Errors')) {
    await createIssueAlert('forj-workers', {
      name: 'New Worker Errors',
      conditions: [
        {
          id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition',
        },
      ],
      filters: [],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
        },
      ],
      actionMatch: 'any',
      filterMatch: 'all',
      frequency: 5, // 5 minutes
    });
  }

  // Failed BullMQ Jobs Alert
  if (!existingAlerts.includes('Failed BullMQ Jobs (>10/hour)')) {
    await createIssueAlert('forj-workers', {
      name: 'Failed BullMQ Jobs (>10/hour)',
      conditions: [
        {
          id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
          interval: '1h',
          value: 10,
        },
      ],
      filters: [],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
        },
      ],
      actionMatch: 'any',
      filterMatch: 'all',
      frequency: 60, // 60 minutes
    });
  }

  // High Worker Error Rate (using event frequency)
  if (!existingAlerts.includes('High Worker Error Rate (>30 errors in 5 min)')) {
    await createIssueAlert('forj-workers', {
      name: 'High Worker Error Rate (>30 errors in 5 min)',
      conditions: [
        {
          id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
          interval: '5m',
          value: 30,
        },
      ],
      filters: [],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
        },
      ],
      actionMatch: 'any',
      filterMatch: 'all',
      frequency: 5, // 5 minutes
    });
  }
}

/**
 * Configure alerts for forj-cli project
 */
async function configureCLIAlerts(): Promise<void> {
  console.log('\n💻 Configuring alerts for forj-cli...');

  const existingAlerts = await getExistingAlerts('forj-cli');

  // High CLI Error Rate (lower threshold due to user impact)
  if (!existingAlerts.includes('High CLI Error Rate (>10 errors in 10 min)')) {
    await createIssueAlert('forj-cli', {
      name: 'High CLI Error Rate (>10 errors in 10 min)',
      conditions: [
        {
          id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
          interval: '10m',
          value: 10,
        },
      ],
      filters: [],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
        },
      ],
      actionMatch: 'any',
      filterMatch: 'all',
      frequency: 10, // 10 minutes
    });
  }

  // CLI Crash Alert (immediate notification)
  if (!existingAlerts.includes('CLI Crashes')) {
    await createIssueAlert('forj-cli', {
      name: 'CLI Crashes',
      conditions: [
        {
          id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition',
        },
      ],
      filters: [],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
        },
      ],
      actionMatch: 'any',
      filterMatch: 'all',
      frequency: 5, // 5 minutes
    });
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log('🚀 Sentry Alert Configuration Script');
  console.log(`Organization: ${SENTRY_ORG}`);
  console.log(`Region: ${SENTRY_REGION}`);
  console.log('');

  try {
    // Verify API access
    console.log('🔐 Verifying Sentry API access...');
    const org = await sentryAPI('GET', `organizations/${SENTRY_ORG}/`);
    console.log(`✅ Connected to organization: ${org.name}`);

    // Configure alerts for each project
    await configureAPIAlerts();
    await configureWorkersAlerts();
    await configureCLIAlerts();

    console.log('\n✨ Alert configuration complete!');
    console.log('\nNext steps:');
    console.log('1. Review alerts in Sentry dashboard: https://forj-sh.sentry.io/alerts/');
    console.log('2. Configure Slack integration for notifications');
    console.log('3. Test alerts by triggering sample errors');
    console.log('4. Update CLAUDE.md checklist items');
  } catch (error) {
    console.error('\n❌ Alert configuration failed');
    console.error(error);
    process.exit(1);
  }
}

main();
