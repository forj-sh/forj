# Forj Scripts

This directory contains automation scripts for managing the Forj infrastructure.

## Sentry Alert Configuration

**Script:** `configure-sentry-alerts.ts`

Automatically configures production alerts for all three Forj Sentry projects using the Sentry REST API.

### Prerequisites

1. **Sentry Auth Token** with the following scopes:
   - `org:read` (to verify organization access)
   - `project:read` (to check existing alerts)
   - `project:write` (to create alert rules)

   To create a token:
   1. Visit https://forj-sh.sentry.io/settings/account/api/auth-tokens/
   2. Click "Create New Token"
   3. Select scopes: `org:read`, `project:read`, `project:write`
   4. Copy the token (you'll only see it once)

2. **Node.js** >= 18.0.0

3. **tsx** installed (for running TypeScript scripts):
   ```bash
   npm install -g tsx
   ```

### Usage

```bash
# Set your Sentry auth token
export SENTRY_AUTH_TOKEN=your_sentry_token_here

# Run the script from the project root
npx tsx scripts/configure-sentry-alerts.ts
```

Or add it to your shell profile for persistence:

```bash
# Add to ~/.zshrc or ~/.bashrc
export SENTRY_AUTH_TOKEN=sntrys_your_token_here
```

### What Gets Configured

#### forj-api Alerts

1. **High Error Rate (>5% in 5 min)** - Metric alert
   - Critical threshold: 5% error rate
   - Warning threshold: 2% error rate
   - Notification: Email to team

2. **Critical Error (fatal level)** - Issue alert
   - Triggers on any error with `level: 'fatal'`
   - Notification: Immediate email

3. **Rate Limit Violations (>100/hour)** - Issue alert
   - Triggers when >100 rate limit errors occur in 1 hour
   - Filtered by tag: `rate_limit`
   - Notification: Email every 60 minutes

4. **Database Connection Issues** - Issue alert
   - Triggers on first occurrence of connection pool errors
   - Filtered by tag: `connection pool`
   - Notification: Immediate email

#### forj-workers Alerts

1. **Failed BullMQ Jobs (>10/hour)** - Issue alert
   - Triggers when >10 job failures occur in 1 hour
   - Filtered by tag: `job`
   - Notification: Email every 60 minutes

2. **Redis Memory Issues** - Issue alert
   - Triggers on first occurrence of Redis memory errors
   - Filtered by tag: `redis`
   - Notification: Immediate email

3. **High Worker Error Rate (>5% in 5 min)** - Metric alert
   - Critical threshold: 5% error rate
   - Notification: Email to team

#### forj-cli Alerts

1. **High CLI Error Rate (>2% in 10 min)** - Metric alert
   - Critical threshold: 2% error rate (lower than API/Workers due to user impact)
   - Time window: 10 minutes
   - Notification: Email to team

2. **CLI Crashes** - Issue alert
   - Triggers on first occurrence of any error-level event
   - Notification: Immediate email

### Idempotency

The script checks for existing alerts by name before creating new ones. You can safely re-run the script without creating duplicates.

### Troubleshooting

**Error: "SENTRY_AUTH_TOKEN environment variable is required"**
- Make sure you've exported the token: `export SENTRY_AUTH_TOKEN=your_token`

**Error: "API Error: 401 Unauthorized"**
- Your token may be invalid or expired
- Regenerate the token in Sentry settings

**Error: "API Error: 403 Forbidden"**
- Your token doesn't have the required scopes (`project:write`, `alert-rule:write`)
- Create a new token with the correct permissions

**Alert not created**
- An alert with the same name may already exist
- Check the Sentry dashboard: https://forj-sh.sentry.io/alerts/

### Next Steps After Running

1. **Verify alerts in Sentry dashboard:**
   - API: https://forj-sh.sentry.io/alerts/forj-api/
   - Workers: https://forj-sh.sentry.io/alerts/forj-workers/
   - CLI: https://forj-sh.sentry.io/alerts/forj-cli/

2. **Configure Slack integration:**
   - Go to https://forj-sh.sentry.io/settings/integrations/slack/
   - Connect your workspace
   - Update alert actions to include Slack notifications

3. **Test alerts:**
   ```bash
   # Trigger a test error in the API
   curl http://localhost:3000/debug-sentry

   # Check Sentry to verify the alert fired
   ```

4. **Update documentation:**
   - Mark alert configuration tasks as complete in CLAUDE.md
   - Update docs/security-review.md with alert confirmation

### Alert Tuning

After running in production for 1-2 weeks, you may want to adjust thresholds:

- **Error rate thresholds** - If you get too many false positives, increase from 5% to 10%
- **Time windows** - Adjust from 5 minutes to 10 minutes if alerts are too noisy
- **Frequency** - Change notification frequency from 5 min to 15 min if getting alert fatigue

To modify alerts:
1. Update the script with new thresholds
2. Delete existing alerts in Sentry dashboard
3. Re-run the script

### Security Considerations

- **Never commit your Sentry auth token** to version control
- Store the token securely (1Password, AWS Secrets Manager, etc.)
- Rotate tokens quarterly
- Use environment-specific tokens for production vs staging
- Review alert rule permissions regularly

### Support

For issues with this script:
- File an issue: https://github.com/forj-sh/forj/issues
- Contact: dewar.daniel@pm.me
