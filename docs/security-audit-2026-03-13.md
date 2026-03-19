# Forj Security Audit Report

**Date:** March 13, 2026
**Version:** 1.0
**Auditors:** Gemini Deep Research Agent, Codex Security Scanner
**Synthesis:** Claude Code
**Codebase Version:** Phase 6 Complete (commit: a19025b)

---

## Executive Summary

This report presents findings from a comprehensive security audit of the Forj infrastructure provisioning platform conducted by two independent automated security analysis agents. The audit identified **8 distinct vulnerabilities** across authentication, authorization, credential management, and rate limiting subsystems.

### Risk Assessment

**Overall Risk Rating:** **CRITICAL**

**Launch Readiness:** **NO** - The platform contains multiple critical vulnerabilities that enable complete authentication bypass and credential theft. Public deployment is blocked until critical and high-priority findings are remediated.

### Findings Summary

| Severity | Count | Blockers |
|----------|-------|----------|
| CRITICAL | 3     | 3        |
| HIGH     | 2     | 2        |
| MEDIUM   | 2     | 0        |
| LOW      | 1     | 0        |
| **TOTAL** | **8** | **5** |

### Key Vulnerabilities

1. **Anonymous JWT minting** enables complete authentication bypass
2. **Domain registration lacks authorization** allowing free registrations on Forj's account
3. **Plaintext credentials in Redis** exposes all third-party API tokens
4. **Unauthenticated SSE stream** leaks project data to any observer
5. **Non-atomic API key rotation** can lock users out of their accounts

### Compliance Status

- **OWASP Top 10 2021:** Violates A01 (Broken Access Control), A02 (Cryptographic Failures), A07 (Identification & Authentication Failures)
- **ICANN Policy:** Domain registrations use placeholder contact data violating accurate Whois requirements
- **PCI DSS:** N/A (no credit card handling - Stripe processes payments)

### Recommended Timeline

**Critical Path (Blocks Launch):** 5-8 days
- Stacks 1-5: Authentication, authorization, and credential security fixes
- Must be completed before any public beta or production deployment

**Pre-Launch (Strongly Recommended):** Additional 2-3 days
- Stacks 6-7: Rate limiting and encryption key isolation

**Post-Launch (Optional):** Can defer
- Stack 8: ICANN-compliant contact data collection

---

## Vulnerability Details

### [CRITICAL-01] Anonymous JWT Minting via `/auth/cli`

**CVSS 3.1 Score:** 9.8 (Critical)
**OWASP Category:** A01:2021 – Broken Access Control
**CWE:** CWE-306 (Missing Authentication for Critical Function)

#### Description

The CLI authentication endpoint issues fully privileged JWT tokens without validating any credential material. Any attacker can obtain a valid authentication token by sending a POST request with arbitrary device metadata.

#### Location

- **File:** `packages/api/src/routes/auth.ts`
- **Lines:** 19-73
- **Function:** `POST /auth/cli`

#### Technical Details

```typescript
// Line 26: Mock user ID generated with no authentication
const mockUserId = 'mock-user-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

// Line 45-52: JWT signed with no credential verification
const mockToken = await new SignJWT({
  userId: mockUserId,
  email: mockEmail,
})
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt(iat)
  .setExpirationTime(exp)
  .sign(secret);
```

The endpoint:
1. Accepts any `deviceId` and `cliVersion` in the request body
2. Generates a new `mock-user-*` ID with no validation
3. Signs a JWT with `userId` and `email` claims
4. Returns the token to the unauthenticated caller

JWTs issued by this endpoint are accepted by `requireAuth` middleware and automatically bypass scope checks in `requireScopes`.

#### Impact

- **Authentication Bypass:** Complete circumvention of all authentication controls
- **Unauthorized Access:** Attackers can call any protected API endpoint
- **Resource Abuse:** Free domain registration, project creation, API key generation
- **Data Exposure:** Access to other users' projects if project IDs are discovered

#### Attack Scenario

```bash
# Step 1: Mint a JWT with no credentials
TOKEN=$(curl -s http://api.forj.sh/auth/cli \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"attacker","cliVersion":"0.1.0"}' | jq -r '.data.token')

# Step 2: Use token to access protected endpoints
curl http://api.forj.sh/projects/init \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"stolen","domain":"victim.com","services":["domain"]}'

# Step 3: Access API key management
curl http://api.forj.sh/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"scopes":["provision:write"],"name":"backdoor"}'
```

#### Proof of Concept

**Reproduction Steps:**
1. `curl -X POST http://localhost:3000/auth/cli -H 'Content-Type: application/json' -d '{"deviceId":"demo","cliVersion":"0.1.0"}'`
2. Extract the `data.token` from the response
3. Use as Bearer token when calling `/projects/init`, `/domains/register`, or `/api-keys`
4. Observe successful authentication and authorization

**Expected Behavior:** Endpoint should require GitHub Device Flow authentication or another verified identity provider before issuing JWTs.

#### Remediation

**Priority:** P0 - Immediate

**Recommended Fix:**
1. Remove the mock endpoint from production builds entirely
2. Replace with real GitHub Device Flow authentication (already implemented in Phase 5)
3. Add environment flag `ENABLE_MOCK_AUTH` defaulting to `false` in production
4. Only enable mock endpoint in local development with explicit opt-in

**Code Changes:**
```typescript
// Add environment check
if (process.env.ENABLE_MOCK_AUTH !== 'true') {
  // Return 404 or redirect to real auth flow
  return reply.status(404).send({
    success: false,
    error: 'Use /auth/github for authentication',
  });
}
```

**Verification:**
- Confirm `/auth/cli` returns 404 in production mode
- Verify protected endpoints reject mock JWTs in production
- Update integration tests to use real authentication

#### References

- OWASP: https://owasp.org/Top10/A01_2021-Broken_Access_Control/
- CWE-306: https://cwe.mitre.org/data/definitions/306.html

---

### [CRITICAL-02] Domain Registration Lacks Authorization and Payment Enforcement

**CVSS 3.1 Score:** 9.1 (Critical)
**OWASP Category:** A01:2021 – Broken Access Control
**CWE:** CWE-862 (Missing Authorization)

#### Description

The production Namecheap domain registration endpoint has authorization checks commented out and explicitly bypassed. There is no verification that a Stripe payment has been completed before queueing domain registration jobs. This allows unauthorized users to register domains charged to Forj's wholesale Namecheap account.

#### Location

- **File:** `packages/api/src/routes/domains-namecheap.ts`
- **Lines:** 166-176 (authorization bypass), 127 (payment TODO)
- **Function:** `POST /domains/register`

#### Technical Details

```typescript
// Line 166-176: Authorization check commented out
// TEMPORARILY DISABLED FOR WORKER TESTING
// Issue: JWT generates VARCHAR user IDs but projects table expects UUID
// const ownsProject = await verifyProjectOwnership(jobData.projectId, userId, request.log);
// if (!ownsProject) {
//   return reply.status(403).send({
//     success: false,
//     error: 'Forbidden - you do not own this project',
//     code: 'FORBIDDEN',
//   });
// }
request.log.warn({ projectId: jobData.projectId, userId }, 'Authorization check bypassed for testing');
```

```typescript
// Line 127: Payment verification missing
// TODO (SECURITY): Add payment verification (Stripe checkout completed)
```

Despite these security controls being disabled:
- Jobs are queued with `priority: 1` ("CRITICAL - user has paid")
- Real Namecheap API calls will be made when `ENABLE_NAMECHEAP_ROUTES=true`
- No server-side validation of payment status exists

#### Impact

- **Financial Loss:** Attackers can register unlimited domains on Forj's registrar account
- **Infrastructure Abuse:** Nameservers can be pointed to attacker-controlled infrastructure
- **PII Exposure:** Contact information submitted in requests is stored in job queue
- **Cost Escalation:** No limit on number of registrations or registration duration (years)

#### Attack Scenario

```bash
# Combine with CRITICAL-01 to register domains without payment
TOKEN=$(curl -s http://localhost:3000/auth/cli \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"evil","cliVersion":"0.1.0"}' | jq -r '.data.token')

curl -X POST http://localhost:3000/domains/register \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId":"fake-proj-123",
    "domainName":"stolen-domain.com",
    "years": 10,
    "registrant": {
      "firstName": "Test",
      "lastName": "User",
      "emailAddress": "attacker@evil.com",
      "phone": "+1.0000000000",
      "address1": "123 Fake St",
      "city": "New York",
      "stateProvince": "NY",
      "postalCode": "10001",
      "country": "US"
    },
    "tech": {...},
    "admin": {...},
    "auxBilling": {...}
  }'

# Job queued with priority 1 even though no payment occurred
# Domain will be registered via Namecheap API in worker
```

#### Proof of Concept

**Reproduction Steps:**
1. Set `ENABLE_NAMECHEAP_ROUTES=true` in environment
2. Mint JWT using `/auth/cli` vulnerability
3. POST to `/domains/register` with any `projectId` and contact info
4. Observe job accepted with "user has paid" priority (line 193)
5. Worker will attempt real registration if Namecheap credentials configured

**Expected Behavior:**
- Endpoint should verify user owns the project via database query
- Endpoint should require proof of successful Stripe checkout session
- Job should not be queued without both authorization and payment verification

#### Remediation

**Priority:** P0 - Immediate

**Recommended Fix:**
1. Uncomment and restore `verifyProjectOwnership` check
2. Implement Stripe payment verification before queuing job
3. Store Stripe session ID in projects table and validate it hasn't been used
4. Reject requests that don't match authenticated user's project ownership

**Code Changes:**
```typescript
// 1. Restore authorization check
const ownsProject = await verifyProjectOwnership(jobData.projectId, userId, request.log);
if (!ownsProject) {
  return reply.status(403).send({
    success: false,
    error: 'Forbidden - you do not own this project',
    code: 'FORBIDDEN',
  });
}

// 2. Add payment verification
const project = await getProject(jobData.projectId);
if (!project.stripeSessionId) {
  return reply.status(402).send({
    success: false,
    error: 'Payment required',
    code: 'PAYMENT_REQUIRED',
  });
}

// Verify Stripe session was successful and matches this project
const session = await stripe.checkout.sessions.retrieve(project.stripeSessionId);
if (session.payment_status !== 'paid') {
  return reply.status(402).send({
    success: false,
    error: 'Payment not completed',
    code: 'PAYMENT_INCOMPLETE',
  });
}
```

**Verification:**
- Domain registration fails without valid project ownership
- Domain registration fails without Stripe payment proof
- Authorized user with payment can register domains
- Test rejects attempts to reuse Stripe session IDs

#### References

- OWASP: https://owasp.org/Top10/A01_2021-Broken_Access_Control/
- CWE-862: https://cwe.mitre.org/data/definitions/862.html

---

### [CRITICAL-03] Plaintext Credentials Stored in Redis Job Queue

**CVSS 3.1 Score:** 8.2 (High, escalated to Critical due to credential scope)
**OWASP Category:** A02:2021 – Cryptographic Failures
**CWE:** CWE-312 (Cleartext Storage of Sensitive Information)

#### Description

Provisioning jobs embed plaintext third-party API tokens (GitHub, Cloudflare, Namecheap) directly in BullMQ job data, which is persisted indefinitely in Redis. There is no encryption, credential scrubbing, or automatic job cleanup. Any compromise of Redis instantly exposes all customer credentials.

#### Location

- **File:** `packages/api/src/lib/orchestrator.ts`
- **Lines:** 223-357
- **Functions:** `setupGitHub()`, `setupCloudflare()`, `updateNameservers()`

**Affected Workers:**
- `packages/workers/src/github-worker.ts`
- `packages/workers/src/cloudflare-worker.ts`
- `packages/workers/src/domain-worker.ts`
- `packages/workers/src/dns-worker.ts`

#### Technical Details

```typescript
// Line 222-228: GitHub token in plaintext
const orgJobData: VerifyOrgJobData = {
  operation: GitHubOperationType.VERIFY_ORG,
  userId: config.userId,
  projectId: config.projectId,
  orgName: config.githubOrg,
  accessToken: config.githubToken,  // ← PLAINTEXT GitHub PAT
};

// Line 268-275: Cloudflare token in plaintext
const jobData: CreateZoneJobData = {
  operation: CloudflareOperationType.CREATE_ZONE,
  userId: config.userId,
  projectId: config.projectId,
  domain: config.domain,
  apiToken: config.cloudflareApiToken,  // ← PLAINTEXT Cloudflare token
  accountId: config.cloudflareAccountId,
};

// Line 350-357: Cloudflare token in DNS jobs
const jobData: WireDNSRecordsJobData = {
  operation: DNSOperationType.WIRE_RECORDS,
  userId: config.userId,
  projectId: config.projectId,
  domain: config.domain,
  zoneId,
  cloudflareApiToken: config.cloudflareApiToken,  // ← PLAINTEXT token
  emailProvider: config.emailProvider || EmailProvider.GOOGLE_WORKSPACE,
  // ...
};
```

**Job Persistence:**
- BullMQ queues instantiated without `removeOnComplete` or `removeOnFail` options
- Jobs remain in Redis indefinitely after completion
- No worker logic to scrub credentials from job data

**Redis Storage Format:**
```bash
# Redis stores jobs as hashes
redis-cli HGETALL bull:github:1
1) "data"
2) "{\"operation\":\"verify-org\",\"userId\":\"...\",\"accessToken\":\"ghp_xxxxxxxxxxxxx\",...}"
3) "opts"
4) "{\"attempts\":3,\"backoff\":{\"type\":\"exponential\",\"delay\":2000}}"
```

#### Impact

- **Complete Credential Compromise:** All GitHub, Cloudflare, and Namecheap credentials exposed
- **Scope of Access:**
  - GitHub: Full org and repo access (create, delete, modify code)
  - Cloudflare: DNS zone management (redirect traffic, intercept emails)
  - Namecheap: Domain transfers, nameserver changes, registrar account access
- **Persistence:** Credentials remain accessible indefinitely (no TTL, no cleanup)
- **Attack Vectors:**
  - Redis compromise via misconfiguration or vulnerability
  - Insider threat (anyone with Redis access)
  - Bull Board UI if exposed (provides web interface to job data)
  - Shared Redis instance in multi-tenant environments

#### Attack Scenario

```bash
# Attacker gains access to Redis (misconfiguration, insider, compromise)
redis-cli

# List all GitHub jobs
KEYS bull:github:*

# Extract plaintext token from any job
HGETALL bull:github:1
# Output: {"accessToken":"ghp_xxxxxxxxxxxxxxxxxxxx",...}

# Use stolen token to compromise organization
curl -H "Authorization: Bearer ghp_xxxxxxxxxxxxxxxxxxxx" \
  https://api.github.com/orgs/victim-org/repos
```

#### Proof of Concept

**Reproduction Steps:**
1. Trigger provisioning job via `/projects/init` or `/provision`
2. Connect to Redis: `redis-cli`
3. List jobs: `KEYS bull:*:*`
4. Inspect job: `HGETALL bull:github:1`
5. Observe plaintext `accessToken`, `apiToken`, `cloudflareApiToken` in JSON

**Expected Behavior:**
- Job data should contain only references to credentials (e.g., `userId`, `projectId`)
- Workers should fetch encrypted credentials from database at execution time
- Credentials should never be persisted in queue storage

#### Remediation

**Priority:** P0 - Immediate

**Recommended Fix:**

**Option 1: Worker-Side Decryption (Recommended)**
1. Modify orchestrator to pass only `projectId` and `userId` in job data
2. Update workers to fetch encrypted credentials from database
3. Workers decrypt credentials at execution time using encryption key access
4. Add job cleanup: `removeOnComplete: 100, removeOnFail: 200`

**Option 2: Job Payload Encryption**
1. Encrypt entire job payload before adding to queue
2. Workers decrypt payload using shared secret
3. Still add job cleanup options

**Code Changes (Option 1):**

```typescript
// orchestrator.ts - Only pass references
const orgJobData: VerifyOrgJobData = {
  operation: GitHubOperationType.VERIFY_ORG,
  userId: config.userId,
  projectId: config.projectId,
  orgName: config.githubOrg,
  // Remove: accessToken field
};

// github-worker.ts - Fetch and decrypt at runtime
async function processVerifyOrg(job: Job<VerifyOrgJobData>) {
  const { userId, projectId } = job.data;

  // Fetch encrypted token from database
  const encryptedToken = await getGitHubToken(userId);
  if (!encryptedToken) {
    throw new Error('GitHub token not found for user');
  }

  // Decrypt token
  const encryptionKey = process.env.GITHUB_ENCRYPTION_KEY!;
  const accessToken = await decrypt(encryptedToken, encryptionKey);

  // Use token for API call
  const client = createGitHubClient(accessToken);
  // ...
}
```

**Queue Configuration:**
```typescript
// queues.ts
export const githubQueue = new Queue('github', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100,  // Keep last 100 completed jobs
    removeOnFail: 200,      // Keep last 200 failed jobs
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});
```

**Verification:**
- Inspect Redis jobs and confirm no plaintext tokens present
- Verify workers successfully fetch and decrypt credentials
- Confirm job cleanup removes old jobs from Redis
- Test provisioning flow end-to-end with new architecture

#### Additional Security Measures

1. **Rotate Exposed Credentials:** Assume any credentials currently in Redis are compromised
2. **Audit Redis Access:** Review who has access to production Redis instance
3. **Network Isolation:** Ensure Redis is not accessible from public internet
4. **Redis Authentication:** Enable `requirepass` with strong password
5. **Bull Board Security:** If using Bull Board, ensure it's behind authentication

#### References

- OWASP: https://owasp.org/Top10/A02_2021-Cryptographic_Failures/
- CWE-312: https://cwe.mitre.org/data/definitions/312.html
- BullMQ Security: https://docs.bullmq.io/guide/jobs/job-data

---

### [HIGH-01] Unauthenticated SSE Stream Exposes Project Data

**CVSS 3.1 Score:** 7.5 (High)
**OWASP Category:** A01:2021 – Broken Access Control
**CWE:** CWE-306 (Missing Authentication for Critical Function)

#### Description

The Server-Sent Events (SSE) endpoint `/events/stream/:projectId` is publicly accessible without authentication or authorization. Any party that obtains or guesses a project ID can subscribe to real-time provisioning events containing sensitive infrastructure metadata.

#### Location

- **File:** `packages/api/src/routes/events.ts`
- **Lines:** 6-153
- **Function:** `GET /events/stream/:projectId`

#### Technical Details

```typescript
// Line 30: No preHandler middleware (no auth required)
server.get<{ Params: { projectId: string } }>(
  '/events/stream/:projectId',
  async (request, reply) => {
    // No authentication check
    // No project ownership verification
    // No rate limiting
```

The endpoint:
1. Accepts any `projectId` in the URL
2. Opens SSE connection without authentication
3. Streams real-time events from Redis pub/sub
4. Exposes domain names, zone IDs, status updates, and error details

**Event Data Exposed:**
```json
{
  "type": "status",
  "service": "domain",
  "status": "complete",
  "message": "Domain provisioned successfully",
  "data": {
    "domainName": "victim-company.com",
    "zoneId": "abc123def456",
    "nameservers": ["ns1.cloudflare.com", "ns2.cloudflare.com"]
  },
  "timestamp": "2026-03-13T10:30:00Z"
}
```

#### Impact

- **Information Disclosure:** Leakage of domain names, DNS configuration, provisioning status
- **Enumeration Attack:** Attackers can iterate through project IDs to discover active projects
- **Denial of Service:** Unlimited SSE connections can exhaust server resources
- **Timing Attacks:** Observe when specific companies are provisioning infrastructure
- **Competitive Intelligence:** Monitor competitor infrastructure changes

#### Attack Scenario

```bash
# Scenario 1: Direct access with known project ID
curl -N http://api.forj.sh/events/stream/0d4c1c2f-9175-4d9a-b302-2cfa9cb5b021
# Receive real-time updates for another user's project

# Scenario 2: Project ID enumeration
for id in $(cat uuid-wordlist.txt); do
  timeout 5 curl -N http://api.forj.sh/events/stream/$id 2>&1 | grep -q "Connected" && echo "Found: $id"
done

# Scenario 3: DoS via unlimited connections
for i in {1..1000}; do
  curl -N http://api.forj.sh/events/stream/any-project-id &
done
# Server runs out of file descriptors or memory
```

#### Proof of Concept

**Reproduction Steps:**
1. Obtain a valid `projectId` (e.g., from `/projects/init` response or logs)
2. `curl -N http://localhost:3000/events/stream/<projectId>`
3. Observe SSE events stream without authentication
4. No 401, no ownership check, no rate limit

**Expected Behavior:**
- Endpoint should require `requireAuth` middleware
- Endpoint should verify user owns the project before subscribing
- Endpoint should rate limit SSE connections per IP and per user
- Non-existent or unauthorized projects should return 404 (not 403 to prevent enumeration)

#### Remediation

**Priority:** P0 - Immediate

**Recommended Fix:**
1. Add `requireAuth` middleware to verify JWT
2. Add `verifyProjectOwnership` check before subscribing to events
3. Implement IP-based rate limiting for SSE connections
4. Return 404 for unauthorized projects (prevent enumeration)
5. Consider using opaque, hard-to-guess stream tokens instead of project IDs

**Code Changes:**
```typescript
import { requireAuth } from '../middleware/auth.js';
import { ipRateLimit } from '../middleware/ip-rate-limit.js';
import { verifyProjectOwnership } from '../lib/authorization.js';

server.get<{ Params: { projectId: string } }>(
  '/events/stream/:projectId',
  {
    preHandler: [
      requireAuth,  // Verify JWT
      ipRateLimit('sse-stream', { maxRequests: 10, windowMs: 60000 })  // Max 10 streams per IP per minute
    ]
  },
  async (request, reply) => {
    const { projectId } = request.params;
    const userId = request.user!.userId;

    // Verify project exists and user owns it
    const ownsProject = await verifyProjectOwnership(projectId, userId, request.log);
    if (!ownsProject) {
      // Return 404 instead of 403 to prevent project ID enumeration
      return reply.status(404).send({
        success: false,
        error: 'Project not found',
      });
    }

    // Set SSE headers and continue...
  }
);
```

**Verification:**
- Unauthenticated requests return 401
- Requests for other users' projects return 404
- Rate limiting prevents >10 connections per minute
- Authenticated user with valid project can stream events

#### Additional Security Measures

1. **Stream Tokens:** Generate one-time stream tokens per project instead of using project IDs
2. **Connection Limits:** Enforce max concurrent connections per user
3. **Event Filtering:** Only stream events relevant to subscribed services
4. **Audit Logging:** Log all SSE connection attempts for security monitoring

#### References

- OWASP: https://owasp.org/Top10/A01_2021-Broken_Access_Control/
- CWE-306: https://cwe.mitre.org/data/definitions/306.html

---

### [HIGH-02] Non-Atomic API Key Rotation

**CVSS 3.1 Score:** 6.5 (Medium, escalated to High due to lockout risk)
**OWASP Category:** A04:2021 – Insecure Design
**CWE:** CWE-662 (Improper Synchronization)

#### Description

The API key rotation method performs three separate database operations (fetch metadata, revoke old key, create new key) without transactional atomicity. If the operation fails after revoking the old key but before creating the new key, the user is left without any valid API key and potentially locked out of automated workflows.

#### Location

- **File:** `packages/api/src/lib/api-key-service.ts`
- **Lines:** 340-377
- **Function:** `rotateApiKey()`

#### Technical Details

```typescript
// Line 340-377: Three separate operations, no transaction
async rotateApiKey(keyId: string, userId: string): Promise<RotateApiKeyResult> {
  // TODO: Wrap in database transaction for true atomicity
  // Currently, if createApiKey fails after revokeApiKey succeeds, the user
  // is left without a valid key. This should be refactored to use a single
  // database transaction with rollback capability.

  // Operation 1: Fetch existing key (separate query)
  const existingKey = await this.getApiKey(keyId, userId);
  if (!existingKey) {
    throw new ApiKeyNotFoundError();
  }

  // Operation 2: Revoke old key (UPDATE query)
  const revoked = await this.revokeApiKey(keyId, userId);
  if (!revoked) {
    throw new Error('Failed to revoke old API key');
  }

  // Operation 3: Create new key (INSERT query)
  // ⚠️ If this fails, user has no valid key!
  const newKey = await this.createApiKey({
    userId,
    scopes: existingKey.scopes as ApiKeyScope[],
    name: existingKey.name || undefined,
    expiresAt: existingKey.expires_at || undefined,
    environment,
  });

  return newKey;
}
```

**Failure Scenarios:**
1. Database timeout during `createApiKey` after successful `revokeApiKey`
2. Constraint violation in INSERT (e.g., name conflict, database full)
3. Network interruption between operations
4. Application crash after revoke but before create
5. Rate limiting or database connection pool exhaustion

#### Impact

- **Account Lockout:** Users lose access to API key-authenticated workflows
- **Service Disruption:** CI/CD pipelines, automation scripts fail immediately
- **Recovery Complexity:** Manual intervention required to restore access
- **No Rollback:** Old key is permanently revoked, cannot be restored
- **Silent Failure:** User may not realize rotation failed until automation breaks

#### Attack Scenario

```bash
# Scenario 1: Intentional DoS by triggering rotation failures
# Attacker with stolen API key repeatedly calls rotation endpoint
# during high database load, causing failures that lock out legitimate user

curl -X POST http://api.forj.sh/api-keys/rotate \
  -H "Authorization: Bearer $STOLEN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"keyId":"key_123"}'

# If database times out during CREATE, user is locked out
# Attacker retains knowledge that old key was revoked

# Scenario 2: Race condition during concurrent rotations
# User clicks "Rotate" multiple times in UI
# First request revokes key, second request fails because key already revoked
# Neither completes successfully, user ends up with no key
```

#### Proof of Concept

**Reproduction Steps:**
1. Create an API key for a test user
2. Simulate database latency or connection pool exhaustion
3. Call `/api-keys/rotate` endpoint
4. Force failure during `createApiKey` (e.g., kill database connection)
5. Observe old key is revoked but no new key created
6. User has zero valid API keys

**Expected Behavior:**
- If rotation fails at any step, old key should remain valid
- Either both operations succeed (revoke + create) or neither does
- User always has exactly one valid key after rotation (or the same key if rotation failed)

#### Remediation

**Priority:** P1 - High (implement before launch)

**Recommended Fix:**

Wrap the entire rotation logic in a database transaction with proper rollback on failure.

**Code Changes:**
```typescript
async rotateApiKey(keyId: string, userId: string): Promise<RotateApiKeyResult> {
  // Start a database transaction
  const client = await this.db.connect();

  try {
    await client.query('BEGIN');

    // Operation 1: Fetch existing key (within transaction)
    const result = await client.query<ApiKeyRecord>(
      `SELECT * FROM api_keys WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [keyId, userId]
    );

    const existingKey = result.rows[0];
    if (!existingKey) {
      throw new ApiKeyNotFoundError();
    }

    if (existingKey.revoked_at) {
      throw new ApiKeyRevokedError();
    }

    // Infer environment from key_hint
    const environment: 'live' | 'test' = existingKey.key_hint.startsWith('forj_liv')
      ? 'live'
      : 'test';

    // Operation 2: Revoke old key (within transaction)
    await client.query(
      `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`,
      [keyId]
    );

    // Operation 3: Create new key (within transaction)
    const newKey = await this.generateApiKey(environment);
    const keyHash = await this.hashApiKey(newKey);
    const keyHint = newKey.substring(0, KEY_HINT_LENGTH);

    const insertResult = await client.query<ApiKeyRecord>(
      `
      INSERT INTO api_keys (user_id, key_hash, key_hint, scopes, name, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        userId,
        keyHash,
        keyHint,
        JSON.stringify(existingKey.scopes),
        existingKey.name,
        existingKey.expires_at,
      ]
    );

    const newRecord = insertResult.rows[0];

    // Commit transaction - all operations succeed atomically
    await client.query('COMMIT');

    logger.info({
      msg: 'API key rotated successfully',
      oldKeyId: keyId,
      newKeyId: newRecord.id,
      userId,
    });

    return {
      keyId: newRecord.id,
      key: newKey,
      scopes: newRecord.scopes as ApiKeyScope[],
      name: newRecord.name || undefined,
      expiresAt: newRecord.expires_at || undefined,
      createdAt: newRecord.created_at,
    };

  } catch (error) {
    // Rollback transaction on any error - old key remains valid
    await client.query('ROLLBACK');

    logger.error({
      error,
      keyId,
      userId,
      msg: 'API key rotation failed - transaction rolled back',
    });

    throw error;

  } finally {
    // Release database connection
    client.release();
  }
}
```

**Key Changes:**
1. Use `db.connect()` to get dedicated client for transaction
2. Wrap all operations in `BEGIN...COMMIT` block
3. Use `FOR UPDATE` lock to prevent concurrent modifications
4. Execute all queries through the same client (transaction)
5. `ROLLBACK` on any failure to restore original state
6. Release connection in `finally` block

**Verification:**
- Test successful rotation (old key revoked, new key created)
- Test rollback when new key creation fails (old key remains valid)
- Test concurrent rotation attempts (second fails with clear error)
- Test database connection loss during rotation (transaction aborts, old key valid)

#### Additional Security Measures

1. **Rate Limiting:** Limit rotation to once per 5 minutes per key
2. **Audit Logging:** Record all rotation attempts (success and failure)
3. **Idempotency:** Consider rotation tokens to prevent duplicate operations
4. **User Notification:** Email user when API key is rotated

#### References

- OWASP: https://owasp.org/Top10/A04_2021-Insecure_Design/
- CWE-662: https://cwe.mitre.org/data/definitions/662.html
- PostgreSQL Transactions: https://www.postgresql.org/docs/current/tutorial-transactions.html

---

### [MEDIUM-01] IP Rate Limiting Bypass via Spoofed Headers

**CVSS 3.1 Score:** 5.3 (Medium)
**OWASP Category:** A07:2021 – Identification and Authentication Failures
**CWE:** CWE-290 (Authentication Bypass by Spoofing)

#### Description

The IP rate limiting middleware blindly trusts the `X-Forwarded-For` header without verifying the request originated from a trusted proxy. Attackers can set arbitrary IP addresses in this header to bypass per-IP rate limits, enabling credential stuffing, DoS attacks, and mass resource creation.

#### Location

- **File:** `packages/api/src/middleware/ip-rate-limit.ts`
- **Lines:** 25-38
- **Function:** `getClientIp()`

#### Technical Details

```typescript
// Line 25-38: No proxy trust verification
export function getClientIp(request: FastifyRequest): string {
  // Check X-Forwarded-For header (set by reverse proxies)
  const forwardedFor = request.headers['x-forwarded-for'];

  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
    // The first IP is the original client
    const ips = typeof forwardedFor === 'string' ? forwardedFor.split(',') : forwardedFor;
    const clientIp = ips[0].trim();
    return clientIp;  // ⚠️ Returns attacker-controlled value
  }

  // Fall back to request.ip (direct connection or trusted proxy)
  return request.ip;
}
```

**Problem:** The code trusts `X-Forwarded-For` even when:
- Request comes directly from the internet (no proxy)
- Proxy doesn't strip client-provided headers
- Fastify `trustProxy` is not configured

**Attack Vector:**
```bash
# Attacker rotates through fake IPs to bypass rate limit
for i in {1..100}; do
  curl http://api.forj.sh/auth/cli \
    -H "X-Forwarded-For: 203.0.113.$i" \
    -H 'Content-Type: application/json' \
    -d '{"deviceId":"spam","cliVersion":"0.1"}'
done

# Each request treated as different IP
# Rate limiter never triggers 429
```

#### Impact

- **Rate Limit Evasion:** Per-IP limits become ineffective
- **Credential Stuffing:** Attackers can test thousands of credentials
- **Resource Abuse:** Mass API key creation, project provisioning
- **DoS Amplification:** Can bypass limits designed to prevent DoS
- **Brute Force:** Password/token guessing attacks succeed

**Affected Endpoints:**
- `POST /auth/cli` (IP rate limited to prevent abuse)
- `POST /domains/register` (should be IP rate limited)
- `POST /provision` (should be IP rate limited)
- Any endpoint using `ipRateLimit` middleware

#### Attack Scenario

```bash
# Scenario 1: Bypass auth endpoint rate limit (5 req/15min)
for i in $(seq 1 100); do
  curl -s http://api.forj.sh/auth/cli \
    -H "X-Forwarded-For: 1.2.3.$i" \
    -H 'Content-Type: application/json' \
    -d '{"deviceId":"bot-$i","cliVersion":"0.1"}' | jq -r '.data.token' >> tokens.txt
done
# Generates 100 JWT tokens despite 5 req/15min limit

# Scenario 2: Credential stuffing with stolen credentials
while IFS=: read -r email password; do
  curl -s http://api.forj.sh/auth/login \
    -H "X-Forwarded-For: $(shuf -i 1-255 -n 1).$(shuf -i 1-255 -n 1).$(shuf -i 1-255 -n 1).$(shuf -i 1-255 -n 1)" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}"
done < credentials.txt
# Each attempt appears to come from different IP
```

#### Proof of Concept

**Reproduction Steps:**
1. Configure IP rate limit on `/auth/cli` (5 requests per 15 minutes)
2. Send 20 requests with different `X-Forwarded-For` headers:
   ```bash
   for i in {1..20}; do
     curl -s http://localhost:3000/auth/cli \
       -H "X-Forwarded-For: 203.0.113.$i" \
       -H 'Content-Type: application/json' \
       -d '{"deviceId":"test","cliVersion":"0.1"}'
   done
   ```
3. Observe no 429 responses despite exceeding limit
4. Check Redis: each "IP" has its own counter

**Expected Behavior:**
- When not behind trusted proxy, use `request.ip` only
- When behind Cloudflare/Vercel, trust last hop in `X-Forwarded-For` or use `CF-Connecting-IP`
- Rate limiter should track actual source IP, not spoofed header

#### Remediation

**Priority:** P2 - Medium (implement before launch)

**Recommended Fix:**

Configure Fastify's `trustProxy` setting and only honor forwarded headers from trusted proxies.

**Code Changes:**

```typescript
// server.ts - Configure trust proxy
const server = Fastify({
  logger: true,
  trustProxy: process.env.TRUST_PROXY === 'true',
  // Or whitelist specific proxy IPs:
  // trustProxy: ['127.0.0.1', '10.0.0.0/8'],
});

// ip-rate-limit.ts - Only trust forwarded headers when configured
export function getClientIp(request: FastifyRequest): string {
  // Only trust X-Forwarded-For if Fastify trustProxy is enabled
  // When trustProxy is true, request.ip already contains the correct client IP
  // from the X-Forwarded-For chain
  return request.ip;
}
```

**Alternative for Cloudflare:**
```typescript
export function getClientIp(request: FastifyRequest): string {
  // If behind Cloudflare, use CF-Connecting-IP header (cannot be spoofed)
  const cfConnectingIp = request.headers['cf-connecting-ip'];
  if (cfConnectingIp && typeof cfConnectingIp === 'string') {
    return cfConnectingIp;
  }

  // Fall back to Fastify's request.ip (respects trustProxy config)
  return request.ip;
}
```

**Environment Configuration:**
```bash
# .env
TRUST_PROXY=true  # Enable when behind Cloudflare, Vercel, or nginx
TRUSTED_PROXY_IPS=127.0.0.1,10.0.0.0/8  # Optional: whitelist specific IPs
```

**Verification:**
- Test rate limiting works with spoofed `X-Forwarded-For` in direct connections
- Test rate limiting honors `X-Forwarded-For` when behind Cloudflare
- Verify `request.ip` contains correct client IP in both scenarios
- Test 429 responses occur after exceeding limit from single IP

#### Additional Security Measures

1. **Multiple Rate Limit Layers:** Combine IP, user, and API key rate limiting
2. **CAPTCHA:** Add CAPTCHA to sensitive endpoints after multiple failures
3. **Geoblocking:** Block requests from high-risk countries (if applicable)
4. **Behavioral Analysis:** Monitor for suspicious patterns (same User-Agent, timing)

#### References

- OWASP: https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/
- CWE-290: https://cwe.mitre.org/data/definitions/290.html
- Fastify Trust Proxy: https://fastify.dev/docs/latest/Reference/Server/#trustproxy

---

### [MEDIUM-02] Shared Master Encryption Key for Multiple Services

**CVSS 3.1 Score:** 5.9 (Medium)
**OWASP Category:** A02:2021 – Cryptographic Failures
**CWE:** CWE-320 (Key Management Errors)

#### Description

The platform uses a single `CLOUDFLARE_ENCRYPTION_KEY` environment variable to encrypt both Cloudflare and GitHub tokens. This violates the principle of security isolation and prevents granular key rotation. A compromise of this single key exposes all third-party credentials stored in the database.

#### Location

- **File:** `packages/api/src/lib/encryption.ts` (encryption primitives)
- **File:** `packages/api/src/routes/auth-github.ts`
- **Lines:** 19-21 (TODO comment), 158, 346
- **File:** `packages/api/src/routes/auth-cloudflare.ts` (same key)

#### Technical Details

```typescript
// auth-github.ts:19-21
// ENCRYPTION:
// - Tokens are encrypted using AES-256-GCM before storage
// - Encryption key: CLOUDFLARE_ENCRYPTION_KEY environment variable (shared credential encryption key)
// - Format: salt:iv:authTag:ciphertext (all base64)
// - TODO: Consider using separate GITHUB_ENCRYPTION_KEY for better security isolation

// auth-github.ts:158 - Encrypts GitHub token
const encryptionKey = process.env.CLOUDFLARE_ENCRYPTION_KEY;
const encryptedToken = await encrypt(accessToken, encryptionKey);

// auth-cloudflare.ts - Same key for Cloudflare tokens
const encryptionKey = process.env.CLOUDFLARE_ENCRYPTION_KEY;
const encryptedToken = await encrypt(apiToken, encryptionKey);
```

**Current State:**
- Single encryption key for both GitHub and Cloudflare tokens
- Key named `CLOUDFLARE_ENCRYPTION_KEY` despite being used for multiple services
- No separation between service credentials
- Key rotation requires re-encrypting all tokens simultaneously

#### Impact

- **Blast Radius:** Single key compromise exposes all third-party credentials
- **Rotation Complexity:** Cannot rotate GitHub key without rotating Cloudflare key
- **Service Isolation:** No security boundary between different infrastructure providers
- **Compliance:** May violate separation-of-duties requirements for high-security environments
- **Forensics:** Cannot determine scope of compromise (which service's key was exposed)

**Compromise Scenarios:**
1. Key leaked via environment variable exposure (logs, error messages)
2. Developer laptop compromise with `.env` file
3. CI/CD secrets exposure
4. Insider threat with access to production environment

#### Attack Scenario

```bash
# Attacker obtains CLOUDFLARE_ENCRYPTION_KEY via any means
# (e.g., stolen .env file, log exposure, compromised CI/CD)

STOLEN_KEY="base64-encoded-key=="

# Connect to production database
psql $DATABASE_URL

# Extract all encrypted tokens
SELECT user_id, github_token_encrypted, cloudflare_token_encrypted FROM users;

# Decrypt ALL credentials with single key
node -e "
const { decrypt } = require('./packages/api/src/lib/encryption');
const key = process.env.STOLEN_KEY;

// Decrypt GitHub token
const githubToken = await decrypt(encryptedGitHubToken, key);

// Decrypt Cloudflare token
const cloudflareToken = await decrypt(encryptedCloudflareToken, key);

console.log('GitHub:', githubToken);
console.log('Cloudflare:', cloudflareToken);
"
```

#### Proof of Concept

**Reproduction Steps:**
1. Review `auth-github.ts` and `auth-cloudflare.ts`
2. Observe both use `process.env.CLOUDFLARE_ENCRYPTION_KEY`
3. Create test user with both GitHub and Cloudflare tokens
4. Decrypt both tokens using same encryption key
5. Confirm single key decrypts credentials for multiple services

**Expected Behavior:**
- GitHub tokens encrypted with `GITHUB_ENCRYPTION_KEY`
- Cloudflare tokens encrypted with `CLOUDFLARE_ENCRYPTION_KEY`
- Namecheap credentials (if stored) encrypted with `NAMECHEAP_ENCRYPTION_KEY`
- Each service has independent key rotation capability

#### Remediation

**Priority:** P2 - Medium (implement before launch)

**Recommended Fix:**

Implement service-specific encryption keys with migration path for existing data.

**Code Changes:**

**1. Update Environment Variables**
```bash
# .env.example
# Service-specific encryption keys (32-byte base64-encoded)
GITHUB_ENCRYPTION_KEY=$(openssl rand -base64 32)
CLOUDFLARE_ENCRYPTION_KEY=$(openssl rand -base64 32)
NAMECHEAP_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

**2. Update GitHub Token Encryption**
```typescript
// auth-github.ts
const encryptionKey = process.env.GITHUB_ENCRYPTION_KEY;  // Changed
if (!encryptionKey) {
  throw new Error('GITHUB_ENCRYPTION_KEY not configured');
}

// ... rest of code uses GITHUB_ENCRYPTION_KEY
```

**3. Keep Cloudflare Token Encryption**
```typescript
// auth-cloudflare.ts
const encryptionKey = process.env.CLOUDFLARE_ENCRYPTION_KEY;  // Unchanged
// Already correct naming
```

**4. Create Migration Script**
```typescript
// scripts/migrate-encryption-keys.ts
/**
 * Re-encrypt existing tokens with service-specific keys
 *
 * Usage: node scripts/migrate-encryption-keys.ts
 */

import { decrypt, encrypt } from '../packages/api/src/lib/encryption.js';
import { getDb } from '../packages/api/src/lib/db.js';

async function migrateEncryptionKeys() {
  const db = getDb();
  const oldKey = process.env.CLOUDFLARE_ENCRYPTION_KEY_OLD!;  // Existing shared key
  const githubKey = process.env.GITHUB_ENCRYPTION_KEY!;
  const cloudflareKey = process.env.CLOUDFLARE_ENCRYPTION_KEY!;

  // Get all users with encrypted tokens
  const result = await db.query(`
    SELECT id, github_token_encrypted, cloudflare_token_encrypted
    FROM users
    WHERE github_token_encrypted IS NOT NULL
       OR cloudflare_token_encrypted IS NOT NULL
  `);

  for (const user of result.rows) {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Re-encrypt GitHub token with new key
    if (user.github_token_encrypted) {
      const decrypted = await decrypt(user.github_token_encrypted, oldKey);
      const reencrypted = await encrypt(decrypted, githubKey);
      updates.push(`github_token_encrypted = $${paramIndex++}`);
      values.push(reencrypted);
    }

    // Re-encrypt Cloudflare token with new key (or keep same key)
    if (user.cloudflare_token_encrypted) {
      const decrypted = await decrypt(user.cloudflare_token_encrypted, oldKey);
      const reencrypted = await encrypt(decrypted, cloudflareKey);
      updates.push(`cloudflare_token_encrypted = $${paramIndex++}`);
      values.push(reencrypted);
    }

    if (updates.length > 0) {
      values.push(user.id);
      await db.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
      console.log(`✓ Migrated user ${user.id}`);
    }
  }

  console.log(`Migration complete: ${result.rows.length} users processed`);
}

migrateEncryptionKeys().catch(console.error);
```

**5. Update Deployment Process**
```bash
# Deploy checklist:
# 1. Generate new service-specific keys
# 2. Add to environment as GITHUB_ENCRYPTION_KEY, keep old as CLOUDFLARE_ENCRYPTION_KEY_OLD
# 3. Deploy updated code
# 4. Run migration script
# 5. Remove CLOUDFLARE_ENCRYPTION_KEY_OLD from environment
# 6. Verify all tokens decrypt successfully
```

**Verification:**
- Generate separate encryption keys for each service
- Run migration script to re-encrypt existing tokens
- Verify GitHub tokens encrypted with `GITHUB_ENCRYPTION_KEY`
- Verify Cloudflare tokens encrypted with `CLOUDFLARE_ENCRYPTION_KEY`
- Test token decryption in auth flows
- Confirm old shared key no longer in use

#### Additional Security Measures

1. **Key Rotation Schedule:** Rotate service keys every 90 days
2. **Key Versioning:** Add key version to encrypted data for seamless rotation
3. **Hardware Security Module (HSM):** Consider HSM for production key storage
4. **Secrets Management:** Use AWS Secrets Manager, HashiCorp Vault, or similar
5. **Audit Logging:** Log all encryption/decryption operations

#### References

- OWASP: https://owasp.org/Top10/A02_2021-Cryptographic_Failures/
- CWE-320: https://cwe.mitre.org/data/definitions/320.html
- NIST Key Management: https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final

---

### [LOW-01] Placeholder Contact Information Violates ICANN Policy

**CVSS 3.1 Score:** 2.0 (Low - Informational)
**OWASP Category:** N/A (Regulatory/Compliance Issue)
**CWE:** N/A

#### Description

Domain registrations currently use hardcoded placeholder data ("Forj User", generic addresses) for registrant contact information instead of collecting and validating real user data. This violates ICANN's Whois Accuracy Policy and can lead to domain suspension or legal issues.

#### Location

- **File:** Referenced in audit but implementation TBD
- **Expected Location:** `packages/api/src/routes/projects.ts` or provisioning flow

#### Impact

- **ICANN Violations:** Accurate Whois data is required by ICANN contracts
- **Domain Suspension:** Registrar (Namecheap) may suspend domains with fake data
- **Legal Liability:** User may face legal issues for inaccurate registration data
- **Trust Issues:** Damages "production-ready" promise if domains get suspended
- **Operational Risk:** Manual intervention required to fix after the fact

#### Remediation

**Priority:** P3 - Low (can be addressed post-launch)

**Recommended Fix:**
1. Update `ProjectInitRequest` type to require contact information
2. Add validation for ICANN-compliant contact data (real names, addresses, phone)
3. Update CLI prompts to collect registrant information
4. Remove placeholder "Forj User" data
5. Add terms of service requiring accurate data

**Implementation Timeline:**
- Can be implemented post-launch during first major update
- Consider making optional at launch with clear disclaimer
- Add to terms: "User responsible for providing accurate contact data"

---

## Remediation Roadmap

### Phase 1: Critical Fixes (Blocks Launch) - 5-8 Days

**Goal:** Eliminate authentication bypass and credential exposure vulnerabilities

| Stack | Vulnerability | Priority | Estimated Time |
|-------|--------------|----------|----------------|
| Stack 1 | CRITICAL-01: Mock Authentication | P0 | 1 day |
| Stack 2 | CRITICAL-02: Domain Registration Auth | P0 | 1 day |
| Stack 3 | HIGH-01: SSE Stream Auth | P0 | 1 day |
| Stack 4 | CRITICAL-03: Plaintext Credentials | P0 | 2-3 days |
| Stack 5 | HIGH-02: API Key Rotation | P1 | 1 day |

**Success Criteria:**
- All CRITICAL and HIGH findings remediated
- Passing security regression tests
- No plaintext credentials in Redis
- All endpoints properly authenticated and authorized

### Phase 2: Pre-Launch Hardening - 2-3 Days

**Goal:** Implement defense-in-depth and proper security isolation

| Stack | Vulnerability | Priority | Estimated Time |
|-------|--------------|----------|----------------|
| Stack 6 | MEDIUM-01: IP Rate Limiting | P2 | 1 day |
| Stack 7 | MEDIUM-02: Shared Encryption Key | P2 | 1-2 days |

**Success Criteria:**
- Rate limiting effective against spoofing
- Service-specific encryption keys implemented
- Migration script tested and documented

### Phase 3: Post-Launch (Optional)

| Stack | Vulnerability | Priority | Estimated Time |
|-------|--------------|----------|----------------|
| Stack 8 | LOW-01: Contact Information | P3 | 1-2 days |

**Success Criteria:**
- ICANN-compliant contact data collection
- Terms of service require accurate data
- CLI prompts collect all required fields

---

## Testing Requirements

### Security Regression Test Suite

Each remediation must include tests covering:

1. **Positive Tests:** Authorized actions succeed
2. **Negative Tests:** Unauthorized actions fail
3. **Boundary Tests:** Edge cases and limits
4. **Attack Simulations:** Reproduce original vulnerability
5. **Integration Tests:** End-to-end flows work correctly

### Required Test Coverage

| Vulnerability | Test Requirements |
|--------------|-------------------|
| CRITICAL-01 | Mock auth disabled in prod, real auth works, protected endpoints reject invalid tokens |
| CRITICAL-02 | Unauthorized domain registration fails, payment verification required, ownership check enforced |
| CRITICAL-03 | Redis contains no plaintext tokens, workers fetch credentials, provisioning succeeds |
| HIGH-01 | Unauthenticated SSE fails, unauthorized project access fails, rate limiting works |
| HIGH-02 | Atomic rotation succeeds, rollback on failure works, concurrent rotation handled |
| MEDIUM-01 | Spoofed headers ignored, Cloudflare headers trusted, rate limiting effective |
| MEDIUM-02 | Service-specific keys work, migration script tested, rotation independent |

---

## Deployment Checklist

Before production deployment, verify:

- [ ] All CRITICAL findings remediated
- [ ] All HIGH findings remediated
- [ ] Security regression tests passing
- [ ] Penetration test conducted on credential handling
- [ ] Redis secured with authentication and network isolation
- [ ] Environment variables audited (no secrets in code)
- [ ] Error messages sanitized (no credential leakage)
- [ ] Logging configured (audit trail for security events)
- [ ] Monitoring configured (alerts for rate limit violations, auth failures)
- [ ] Incident response plan documented
- [ ] Security contact email configured
- [ ] Responsible disclosure policy published

---

## Long-Term Security Roadmap

### 90-Day Post-Launch

1. **Bug Bounty Program:** Launch public bug bounty on HackerOne/Bugcrowd
2. **Third-Party Audit:** Commission professional security audit
3. **Compliance Certifications:** SOC 2 Type 1 (if targeting enterprise)
4. **Key Rotation:** Implement automated encryption key rotation

### 180-Day Post-Launch

1. **WAF Deployment:** Cloudflare WAF or AWS WAF
2. **DDoS Protection:** Cloudflare advanced DDoS protection
3. **Intrusion Detection:** Deploy SIEM for security monitoring
4. **Penetration Testing:** Quarterly external pentests

---

## Appendix A: OWASP Top 10 Coverage

| OWASP Category | Status | Findings |
|----------------|--------|----------|
| A01: Broken Access Control | ❌ FAIL | CRITICAL-01, CRITICAL-02, HIGH-01 |
| A02: Cryptographic Failures | ❌ FAIL | CRITICAL-03, MEDIUM-02 |
| A03: Injection | ✅ PASS | No SQL injection found (parameterized queries) |
| A04: Insecure Design | ⚠️ PARTIAL | HIGH-02 |
| A05: Security Misconfiguration | ⚠️ PARTIAL | MEDIUM-01 |
| A06: Vulnerable Components | ✅ PASS | Dependencies audited |
| A07: Authentication Failures | ❌ FAIL | CRITICAL-01, MEDIUM-01 |
| A08: Software/Data Integrity | ✅ PASS | Stripe webhooks verified |
| A09: Logging Failures | ✅ PASS | Comprehensive logging implemented |
| A10: SSRF | ✅ PASS | No SSRF vectors identified |

**Overall OWASP Compliance:** 40% (4/10 passing)

After remediation: Target 100% compliance

---

## Appendix B: Threat Model

### Attack Vectors

**External Attacker (Unauthenticated):**
- ✅ Can mint JWTs via `/auth/cli` (CRITICAL-01)
- ✅ Can register domains without payment (CRITICAL-02)
- ✅ Can access SSE streams (HIGH-01)
- ✅ Can bypass rate limits (MEDIUM-01)

**External Attacker (Authenticated):**
- ✅ Can access other users' projects if IDs discovered (CRITICAL-02)
- ⚠️ Can trigger API key rotation failures (HIGH-02)

**Compromised Redis:**
- ✅ Full credential theft (GitHub, Cloudflare, Namecheap) (CRITICAL-03)

**Insider Threat:**
- ✅ Database access reveals encrypted credentials
- ✅ Single encryption key exposes all services (MEDIUM-02)

### Trust Boundaries

1. **Public Internet ↔ API Server:** Authentication required
2. **API Server ↔ Redis:** Credentials should not cross this boundary in plaintext
3. **API Server ↔ Workers:** Workers fetch own credentials
4. **Workers ↔ External APIs:** Credentials decrypted just-in-time

---

## Appendix C: Compliance Matrix

| Requirement | Status | Notes |
|------------|--------|-------|
| **GDPR** | ⚠️ PARTIAL | PII in job queue (contact data), needs retention policy |
| **CCPA** | ⚠️ PARTIAL | Same as GDPR |
| **PCI DSS** | ✅ N/A | No credit card handling (Stripe processes) |
| **SOC 2** | ❌ FAIL | Multiple control failures (auth, encryption, monitoring) |
| **ISO 27001** | ❌ FAIL | Information security controls insufficient |
| **ICANN** | ❌ FAIL | Placeholder contact data (LOW-01) |

---

## Appendix D: Glossary

**AES-256-GCM:** Advanced Encryption Standard with 256-bit keys using Galois/Counter Mode (authenticated encryption)

**BullMQ:** Redis-based job queue for background task processing

**ICANN:** Internet Corporation for Assigned Names and Numbers (domain registration policy authority)

**IDOR:** Insecure Direct Object Reference (accessing resources without authorization check)

**JWT:** JSON Web Token (authentication token standard)

**SSE:** Server-Sent Events (unidirectional real-time streaming protocol)

**Whois:** Domain registration contact information database

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-03-13 | Claude Code | Initial security audit synthesis |

---

**END OF REPORT**

*This report is confidential and intended solely for the Forj development team. Do not distribute outside the organization without authorization.*
