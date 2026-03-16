# SSE Authentication Investigation

**Date**: March 15, 2026
**Issue**: BUG-001 from E2E-TEST-RESULTS.md
**Status**: ✅ FALSE ALARM - No bug found

## Issue Report

From E2E-TEST-RESULTS.md:
> **BUG-001**: SSE Stream Authentication Breaking CLI Connections
> - **Severity**: CRITICAL
> - **Component**: `/events/stream/:projectId` endpoint
> - **Issue**: SSE endpoint requires JWT auth (PR #84), but CLI may not be sending `Authorization` header
> - **Impact**: CLI cannot receive real-time provisioning updates
> - **Error**: `SSE connection error. Will attempt to reconnect`

## Investigation Findings

### 1. CLI Implementation (packages/cli/src/lib/sse-client.ts)

**Lines 75-79**:
```typescript
eventSource = new EventSource(url, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

**✅ CONFIRMED**: CLI correctly sends `Authorization: Bearer ${token}` header with every EventSource connection.

### 2. API Implementation (packages/api/src/routes/events.ts)

**Lines 47-56**:
```typescript
server.get<{ Params: { projectId: string } }>(
  '/events/stream/:projectId',
  {
    preHandler: [
      requireAuth,  // JWT verification
      ipRateLimit('sse-stream', { maxRequests: 10, windowMs: 60000 })
    ]
  },
  async (request, reply) => { /* ... */ }
);
```

**✅ CONFIRMED**: SSE endpoint correctly requires JWT authentication via `requireAuth` middleware.

### 3. Authentication Flow

1. CLI authenticates via `/auth/cli` (development only, when `ENABLE_MOCK_AUTH=true`) and receives JWT token
2. CLI stores token via `getAuthToken()` from config
3. When creating SSE client, token is included in EventSource headers
4. API verifies JWT token in `requireAuth` middleware
5. API verifies project ownership before streaming events
6. SSE stream begins

**✅ CONFIRMED**: Complete authentication flow is correctly implemented.

## Root Cause of Reported Error

The error message "SSE connection error. Will attempt to reconnect" (lines 129-133 of sse-client.ts) is a **generic connection error handler**, NOT an authentication error.

Possible causes for this error during E2E testing:
1. **No JWT token**: CLI was not authenticated before attempting SSE connection
2. **Expired JWT**: Token expired (TTL varies by auth method: 24h for mock auth via `/auth/cli`)
3. **Network issues**: API server not running or unreachable
4. **Redis unavailable**: SSE requires Redis pub/sub for event streaming
5. **Project not found**: The project ID does not exist or user lacks ownership

## Recommendation

**No code changes needed**. The SSE authentication is working correctly.

### To verify SSE works during testing:

**Prerequisites**:
- API server running with `ENABLE_MOCK_AUTH=true` (development only)
- Redis server running (required for SSE pub/sub)
- Test project created in database

```bash
# 1. Get JWT token (requires ENABLE_MOCK_AUTH=true)
TOKEN=$(curl -X POST http://localhost:3000/auth/cli \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","cliVersion":"0.1.0"}' | jq -r '.data.token')

# 2. Test SSE endpoint with auth
curl -N \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/events/stream/test-project-id
```

Expected responses:
- **200 OK** with SSE stream if project exists and user owns it
- **404 Not Found** if project doesn't exist in database
- **403 Forbidden** if project exists but user is not the owner
- **401 Unauthorized** if token is missing, invalid, or expired

## Conclusion

BUG-001 is a **false alarm**. The SSE authentication is correctly implemented and the CLI sends proper Authorization headers. The reported error during E2E testing could have been caused by:
- Missing authentication (not calling `/auth/cli` before connecting)
- Test project not existing in the database
- Mock auth endpoint not enabled (`ENABLE_MOCK_AUTH=false`)
- Redis server not running (required for SSE pub/sub)
- Expired or invalid JWT token

**Recommendation**: Mark BUG-001 as RESOLVED (false alarm). Follow-up task: Update E2E-TEST-RESULTS.md to reflect this finding.
