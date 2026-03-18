# Forj MCP Integration Guide

This guide explains how to use the Forj Infrastructure Provisioning API with Claude Code and other AI assistants via the Model Context Protocol (MCP).

## Table of Contents

- [Overview](#overview)
- [Setup](#setup)
- [Authentication](#authentication)
- [Available Tools](#available-tools)
- [Usage Examples](#usage-examples)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## Overview

The Forj API provides infrastructure provisioning capabilities through a standardized MCP interface. This allows AI coding assistants to:

- Provision complete infrastructure stacks (domain + GitHub + Cloudflare + DNS)
- Check domain availability
- Manage API keys programmatically
- Monitor project status
- Fix DNS configuration issues

## Setup

### 1. Configure MCP Server

The `.mcp.json` file in the project root defines the Forj API as an MCP server. For team collaboration, commit this file to your repository.

### 2. Set API Base URL

For local development:
```json
{
  "mcpServers": {
    "forj": {
      "url": "http://localhost:3000"
    }
  }
}
```

For production:
```json
{
  "mcpServers": {
    "forj": {
      "url": "https://api.forj.sh"
    }
  }
}
```

### 3. Configure Authentication

Update the `headers.Authorization` field in `.mcp.json`:

**Option A: JWT Token** (for user authentication)
```json
{
  "headers": {
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Option B: API Key** (for programmatic access)
```json
{
  "headers": {
    "Authorization": "Bearer forj_live_abc123..."
  }
}
```

## Authentication

### Getting a JWT Token

```bash
curl -X POST http://localhost:3000/auth/cli \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"my-device","cliVersion":"1.0.0"}' \
  | jq -r '.data.token'
```

### Creating an API Key

First authenticate with a JWT, then create an API key:

```bash
curl -X POST http://localhost:3000/api-keys \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MCP Integration Key",
    "scopes": ["agent:provision", "agent:read"],
    "environment": "live"
  }' \
  | jq -r '.data.key'
```

**IMPORTANT**: Save the API key immediately - it's only shown once!

## Available Tools

### Infrastructure Provisioning

#### `provision_infrastructure`

Provisions a complete infrastructure stack for a new project.

**Scopes Required**: `agent:provision`

**Parameters**:
- `projectId` (string, required): Unique project identifier
- `domain` (string, required): Domain name to register
- `githubOrg` (string, required): GitHub organization name
- `years` (number, required): Years to register domain (1-10)
- `namecheapApiUser` (string, required): Namecheap API username
- `namecheapApiKey` (string, required): Namecheap API key
- `namecheapUsername` (string, required): Namecheap account username
- `githubToken` (string, required): GitHub personal access token
- `cloudflareApiToken` (string, required): Cloudflare API token
- `cloudflareAccountId` (string, required): Cloudflare account ID
- `contactInfo` (object, required): Domain registration contact information

**Example Usage**:
```
Claude, please provision infrastructure for my new project "acme-corp" with domain "acme.com"
```

**Rate Limits**: 10 requests/hour (user) + 5 requests/hour (IP)

---

#### `check_domain_availability`

Check if domains are available for registration.

**Scopes Required**: `agent:read`

**Parameters**:
- `domains` (array of strings, required): Domain names to check (max 50)

**Example Usage**:
```
Claude, check if acme.com, acme.io, and acme.dev are available
```

**Rate Limits**: 50 requests/hour (user) + 30 requests/hour (IP)

---

### API Key Management

#### `create_api_key`

Create a new API key with specific scopes.

**Parameters**:
- `name` (string, optional): Friendly name for the key
- `scopes` (array, required): List of permissions for the API key. Possible values are `"agent:provision"` and `"agent:read"`.
- `environment` (string, optional): "live" or "test" (default: "live")
- `expiresAt` (string, optional): ISO 8601 expiration date

**Example Usage**:
```
Claude, create a new API key named "Production Key" with provision and read scopes
```

**Rate Limits**: 20 requests/hour (user) + 10 requests/hour (IP)

---

#### `list_api_keys`

List all API keys for the authenticated user.

**Parameters**:
- `includeRevoked` (boolean, optional): Include revoked keys (default: false)

**Example Usage**:
```
Claude, show me all my active API keys
```

**Rate Limits**: 50 requests/hour (user) + 30 requests/hour (IP)

---

#### `rotate_api_key`

Rotate an API key (revokes old key, creates new key with same scopes).

**Scopes Required**: `agent:provision`

**Parameters**:
- `id` (string, required): API key ID to rotate

**Example Usage**:
```
Claude, rotate my API key with ID abc-123
```

**Security**: Old key is revoked before new key is returned. Update all systems using the old key immediately.

**Rate Limits**: 20 requests/hour (user) + 10 requests/hour (IP)

---

#### `revoke_api_key`

Permanently revoke an API key.

**Parameters**:
- `id` (string, required): API key ID to revoke

**Example Usage**:
```
Claude, revoke API key xyz-789
```

**Rate Limits**: 20 requests/hour (user) + 10 requests/hour (IP)

---

### Project Management

#### `initialize_project`

Initialize a new project configuration.

**Parameters**:
- `name` (string, required): Project name
- `domain` (string, required): Domain for the project
- `services` (array, required): List of services to provision. Possible values include `"domain"`, `"github"`, `"cloudflare"`, and `"dns"`.
- `githubOrg` (string, optional): GitHub organization name

**Example Usage**:
```
Claude, initialize a new project called "startup-mvp" for domain startup.io
```

**Rate Limits**: 30 requests/hour (user) + 50 requests/hour (IP)

---

#### `get_project_status`

Get status of a project and its services.

**Parameters**:
- `id` (string, required): Project ID

**Example Usage**:
```
Claude, what's the status of project proj_abc-123?
```

**Rate Limits**: 100 requests/hour (user) + 60 requests/hour (IP)

---

#### `check_dns_health`

Check DNS health for a project's domain. Domain and Cloudflare zone ID are loaded automatically from the project record.

**Parameters**:
- `id` (string, required): Project ID

**Example Usage**:
```
Claude, check the DNS health for project proj_abc-123
```

**Rate Limits**: 30 requests/hour (user) + 20 requests/hour (IP)

---

#### `fix_dns_issues`

Auto-repair DNS issues by recreating missing/invalid records. The Cloudflare API token is fetched from encrypted storage — no credentials need to be passed.

**Parameters**:
- `id` (string, required): Project ID
- `recordTypes` (array of strings, optional): Specific record types to fix (e.g., "MX", "SPF", "DKIM", "DMARC"). If omitted, fixes all issues.

**Example Usage**:
```
Claude, fix the DNS issues for project proj_xyz-456
```

**Rate Limits**: 20 requests/hour (user) + 10 requests/hour (IP)

---

## Usage Examples

### Example 1: Provision Infrastructure for a New Startup

```
User: Claude, I need to provision infrastructure for my new startup "TechVenture"
      with domain techventure.io. Use my GitHub org "techventure-team".

Claude: I'll help you provision the infrastructure. First, I need some information:

1. How many years do you want to register the domain?
2. Your Namecheap API credentials (API user, API key, username)
3. Your GitHub personal access token
4. Your Cloudflare API token and account ID
5. Contact information for domain registration

User: [provides credentials]

Claude: [calls provision_infrastructure tool]

Great! I've started the provisioning process. The infrastructure is being created
in the background. You can monitor progress with:

  GET /provision/status/proj_techventure_123

The process typically takes 2-5 minutes and will provision:
- Domain registration (techventure.io)
- GitHub repository in techventure-team org
- Cloudflare DNS zone
- Email DNS records (MX, SPF, DKIM, DMARC)
```

### Example 2: Check Domain Availability

```
User: Claude, check if myapp.com, myapp.io, and myapp.dev are available

Claude: [calls check_domain_availability tool]

Here are the results:
- myapp.com: ❌ Not available
- myapp.io: ✅ Available ($29.88/year)
- myapp.dev: ✅ Available ($12.98/year)

Would you like to provision infrastructure with myapp.io?
```

### Example 3: Rotate Compromised API Key

```
User: Claude, I think my API key "Production Key" (ID: key_abc123) was leaked.
      Please rotate it immediately.

Claude: [calls rotate_api_key tool]

✅ API key rotated successfully!

Old key (key_abc123) has been revoked.
New key created: forj_live_XYZ789... (ID: key_def456)

⚠️  IMPORTANT: Save this new key immediately - it will only be shown once!

Update all systems using the old key with this new key:
- CI/CD pipelines
- Production servers
- Monitoring systems

The old key is now invalid and cannot be used.
```

### Example 4: Check and Fix DNS Issues

```
User: Claude, my emails aren't working for project proj_startup_001.
      Can you check the DNS?

Claude: [calls check_dns_health with id="proj_startup_001"]

I found several DNS issues for your domain startup.io:
- ❌ MX records: Missing
- ❌ SPF record: Invalid syntax
- ✅ DKIM records: Healthy
- ❌ DMARC record: Missing

Would you like me to auto-fix these issues?

User: Yes, please fix them

Claude: [calls fix_dns_issues with id="proj_startup_001"]

✅ DNS issues fixed!

Fixed 3 records:
- Created MX records for Google Workspace
- Updated SPF record with correct syntax
- Created DMARC record with recommended policy

Your email should work within 5-10 minutes (DNS propagation time).
```

Note: No credentials are needed — the Cloudflare API token is fetched
from encrypted storage using the authenticated user's stored credentials.
```

## Security Considerations

### 1. API Key Management

- **Never commit API keys to version control**
- Store API keys in environment variables or secure vaults
- Rotate keys regularly (recommended: every 90 days)
- Use `test` keys for development, `live` keys for production
- Revoke keys immediately if compromised

### 2. Scope Restrictions

API keys are restricted by scopes:
- `agent:provision`: Full provisioning capabilities (high privilege)
- `agent:read`: Read-only access (recommended for monitoring)

**Best Practice**: Create separate keys for different purposes:
- CI/CD: `agent:read` only
- Production deployment: `agent:provision`
- Monitoring/dashboards: `agent:read` only

### 3. Rate Limiting

All endpoints are rate-limited:
- **Per-user limits**: Prevent individual abuse
- **Per-IP limits**: Prevent distributed attacks

If you hit rate limits, wait for the reset time (returned in `X-RateLimit-Reset` header).

### 4. Credential Handling

**IMPORTANT SECURITY CONSIDERATION**: Some MCP tools (like `provision_infrastructure`) require sensitive credentials (`namecheapApiKey`, `githubToken`, `cloudflareApiToken`) to be passed directly as parameters. This design has both benefits and risks:

**Benefits**:
- No credential storage on Forj servers (except encrypted OAuth tokens)
- Credentials are ephemeral - only used for the duration of the request
- User maintains full control over their credentials

**Risks**:
- Credentials could be exposed in AI assistant chat logs
- Credentials could be inadvertently copied/shared with conversation history

**Best Practices**:
- Use environment variables in your AI assistant configuration to avoid typing credentials directly
- Clear chat history after provisioning operations
- Rotate credentials regularly (especially after sharing conversations)
- Consider pre-configuring OAuth tokens (Cloudflare, GitHub) via the `/auth` endpoints instead of passing tokens directly

When using MCP tools that require credentials:
- Credentials are NOT stored by the API (except encrypted tokens for OAuth)
- Each provisioning request requires full credentials
- Use environment variables to avoid exposing credentials in chat logs
- Never commit MCP configuration files with hardcoded credentials

### 5. Audit Logging

All MCP tool invocations are logged with:
- User ID
- Timestamp
- Action performed
- IP address

Review audit logs regularly for suspicious activity.

## Troubleshooting

### Authentication Errors

**Error**: `401 Unauthorized`

**Solutions**:
1. Check that your JWT token or API key is valid
2. Verify the token hasn't expired
3. Ensure the token is correctly formatted in the Authorization header

**Error**: `403 Forbidden - Insufficient scopes`

**Solutions**:
1. Check that your API key has the required scopes
2. For `provision_infrastructure`, you need `agent:provision` scope
3. Rotate your API key to update scopes if needed

### Rate Limit Errors

**Error**: `429 Too Many Requests`

**Solutions**:
1. Check `X-RateLimit-Reset` header for reset time
2. Wait for the specified time before retrying
3. Consider caching results to reduce API calls
4. Use batch operations where available (e.g., check multiple domains at once)

### MCP Connection Errors

**Error**: `Failed to connect to MCP server`

**Solutions**:
1. Verify the API server is running (`curl http://localhost:3000/health`)
2. Check the `url` in `.mcp.json` is correct
3. Ensure no firewall is blocking the connection
4. For local development, confirm the API is running on port 3000

### Tool Execution Errors

**Error**: `Missing required parameters`

**Solutions**:
1. Check the tool definition in `.mcp.json` for required parameters
2. Ensure all required fields are provided
3. Verify parameter types match expectations (string, number, array, object)

**Error**: `Invalid project ID format`

**Solutions**:
1. Project IDs must match pattern: `proj_{uuid}`
2. Use `initialize_project` to get a valid project ID
3. Check that the project exists before querying status

## Additional Resources

- **API Documentation**: See `packages/api/README.md`
- **Rate Limiting**: See `packages/api/src/middleware/rate-limit.ts`
- **Authentication**: See `packages/api/src/middleware/auth.ts`
- **API Key Management**: See `packages/api/src/routes/api-keys.ts`
- **Provisioning**: See `packages/api/src/routes/provision.ts`

## Support

For issues or questions:
1. Check the [troubleshooting section](#troubleshooting) above
2. Review API server logs for detailed error messages
3. Open an issue at: https://github.com/forj-sh/forj/issues
