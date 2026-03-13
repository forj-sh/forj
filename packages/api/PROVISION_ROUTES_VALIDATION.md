# Provision Routes Validation

**Stack 8: Wire CLI integration via provision routes**

Date: March 12, 2026
Status: ✅ Complete

## Implementation Summary

The provision routes (`packages/api/src/routes/provision.ts`) provide the HTTP interface for the CLI to initiate full infrastructure provisioning via the orchestrator.

## Routes

### POST /provision
Starts background provisioning for a project.

**Request Body**: `ProvisioningConfig` interface from orchestrator

**Required Fields** (updated in Stack 8):
- `userId` - User ID from JWT token
- `projectId` - Unique project identifier
- `domain` - Domain to provision (e.g., "example.com")
- `namecheapApiUser` - Namecheap API credentials
- `namecheapApiKey` - Namecheap API credentials
- `namecheapUsername` - Namecheap account username
- `githubToken` - GitHub OAuth token
- `cloudflareApiToken` - Cloudflare API token
- `cloudflareAccountId` - **✅ NEW in Stack 8** - Cloudflare account ID (required for zone creation)
- `githubOrg` - GitHub organization name
- `years` - Domain registration years
- `contactInfo` - Complete domain contact information (9 subfields)

**Response**:
```json
{
  "success": true,
  "data": {
    "projectId": "proj-abc123",
    "message": "Provisioning started in background. Use /events/stream/:projectId to monitor progress."
  }
}
```

**Important Behavior**:
- Returns immediately (non-blocking)
- Provisioning runs in background workers
- Client monitors progress via SSE endpoint: `GET /events/stream/:projectId`
- Fire-and-forget orchestrator call with error logging

**Error Handling**:
- 400: Missing required fields
- 400: Incomplete contact information
- 500: Provisioning failed to start

### GET /provision/status/:projectId
Get aggregated provisioning status (not yet implemented).

**Status**: 501 Not Implemented

**Recommended Approach**:
- Query BullMQ job statuses for all jobs in provisioning pipeline
- Aggregate into single status response
- Include job IDs, current states, and error messages if any

**Current Workaround**: Use SSE streaming for real-time updates

## Stack 8 Changes

### 1. Added Cloudflare Account ID Validation
**Location**: `POST /provision` validation block

**Change**:
```typescript
// Before:
if (
  !config.userId ||
  !config.projectId ||
  !config.domain ||
  !config.namecheapApiUser ||
  !config.namecheapApiKey ||
  !config.namecheapUsername ||
  !config.githubToken ||
  !config.cloudflareApiToken ||  // ← Missing cloudflareAccountId
  !config.githubOrg ||
  !config.years ||
  !config.contactInfo
) { ... }

// After:
if (
  !config.userId ||
  !config.projectId ||
  !config.domain ||
  !config.namecheapApiUser ||
  !config.namecheapApiKey ||
  !config.namecheapUsername ||
  !config.githubToken ||
  !config.cloudflareApiToken ||
  !config.cloudflareAccountId ||  // ← NEW FIELD
  !config.githubOrg ||
  !config.years ||
  !config.contactInfo
) { ... }
```

**Updated Error Message**:
```
'Required: userId, projectId, domain, namecheapApiUser, namecheapApiKey, namecheapUsername, githubToken, cloudflareApiToken, cloudflareAccountId, githubOrg, years, contactInfo'
```

**Reason**: Matches orchestrator's `ProvisioningConfig` interface update from Stack 7

## Server Registration

**Location**: `packages/api/src/server.ts` line 175

```typescript
await server.register(provisionRoutes);
logger.info('Provisioning routes registered');
```

**Status**: ✅ Already registered in server

**Authentication**: Currently **not protected** - needs JWT middleware in future stack

## CLI Integration

The CLI will call this endpoint with:

```typescript
// CLI pseudocode
const response = await fetch('http://localhost:3000/provision', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwtToken}`,  // TODO: Add auth middleware
  },
  body: JSON.stringify({
    userId: userIdFromJWT,
    projectId: generatedProjectId,
    domain: userSelectedDomain,
    namecheapApiUser: process.env.NAMECHEAP_API_USER,
    namecheapApiKey: process.env.NAMECHEAP_API_KEY,
    namecheapUsername: process.env.NAMECHEAP_USERNAME,
    githubToken: githubOAuthToken,
    cloudflareApiToken: cloudflareApiToken,
    cloudflareAccountId: cloudflareAccountId,
    githubOrg: userSelectedOrg,
    years: 1,
    contactInfo: { /* user-provided contact info */ },
    emailProvider: 'GOOGLE_WORKSPACE',
    // ... optional fields
  }),
});

// Then immediately connect to SSE stream
const eventSource = new EventSource(`http://localhost:3000/events/stream/${projectId}`);
eventSource.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log(`Progress: ${update.type}`);
};
```

## Event Flow

1. **CLI**: POST /provision → Returns immediately with `projectId`
2. **API**: Orchestrator queues jobs in BullMQ (domain, GitHub, Cloudflare, DNS)
3. **Workers**: Process jobs in background, publish events to Redis
4. **CLI**: Listens to SSE stream `GET /events/stream/:projectId`
5. **API**: Streams Redis events to CLI via SSE
6. **CLI**: Displays real-time progress to user

## Example SSE Events

```json
{"type": "DOMAIN_REGISTRATION_STARTED", "projectId": "proj-123", "data": {"domain": "example.com"}}
{"type": "DOMAIN_REGISTRATION_COMPLETE", "projectId": "proj-123", "data": {"domain": "example.com"}}
{"type": "ORG_VERIFICATION_STARTED", "projectId": "proj-123", "data": {"orgName": "example-org"}}
{"type": "ZONE_CREATION_STARTED", "projectId": "proj-123", "data": {"domain": "example.com"}}
{"type": "MX_WIRING_COMPLETE", "projectId": "proj-123", "data": {"recordsCreated": 5}}
{"type": "PROVISIONING_COMPLETE", "projectId": "proj-123", "data": {"duration": 180}}
```

## Security Considerations

### Current State
- ❌ **No authentication** - endpoint is currently open
- ❌ **No rate limiting** - vulnerable to DoS
- ❌ **No authorization** - any user could provision for any project
- ❌ **Credentials in request body** - API keys exposed in logs

### Recommended Improvements (Future Stacks)
1. **Add JWT authentication middleware** - require valid token
2. **Add rate limiting** - per-user limits on provisioning requests
3. **Add authorization checks** - verify user owns project
4. **Secure credential handling** - encrypt sensitive fields in request
5. **Audit logging** - log all provisioning attempts with user context

## Testing Readiness

✅ Build passes (TypeScript strict mode)
✅ Route registered in server
✅ Validation includes `cloudflareAccountId`
✅ Fire-and-forget orchestrator call with error logging
✅ SSE integration already exists in `routes/events.ts`
✅ Ready for end-to-end testing

**Next Steps**:
- Create end-to-end integration test (Stack 9)
- Add authentication middleware (Future stack)
- Implement `/provision/status/:projectId` endpoint (Future stack)
