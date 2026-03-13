# Provisioning Orchestrator Validation

**Stack 7: Provisioning orchestrator updates**

Date: March 12, 2026
Status: ✅ Complete

## Implementation Summary

The provisioning orchestrator (`packages/api/src/lib/orchestrator.ts`) coordinates the full infrastructure provisioning pipeline with parallel execution where possible.

## Orchestration Flow

```
Phase 1: Domain Registration (Namecheap)
  ↓
Phase 2: GitHub + Cloudflare (Parallel)
  ├─→ GitHub Org Verification
  │   └─→ GitHub Repo Creation
  └─→ Cloudflare Zone Creation
      └─→ Nameserver Update (Namecheap → Cloudflare)
          └─→ Nameserver Verification
              └─→ DNS Record Wiring
                  └─→ DNS Record Verification
```

## Phase Details

### Phase 1: Domain Registration
- **Operation**: Register domain via Namecheap API
- **Worker**: Domain worker
- **Blocking**: Yes - Phases 2+ wait for domain to be registered
- **Retry**: 3 attempts, exponential backoff (5s delay)

### Phase 2: Parallel Execution

#### GitHub Track
1. **Org Verification**: Verify GitHub org exists via API
   - Worker: GitHub worker
   - Retry: 3 attempts, exponential backoff (2s delay)
2. **Repo Creation**: Create repository under verified org
   - Worker: GitHub worker
   - Retry: 3 attempts, exponential backoff (2s delay)
   - Defaults: Private repo, auto-init with README, squash merge only

#### Cloudflare Track
1. **Zone Creation**: Create Cloudflare DNS zone
   - Worker: Cloudflare worker
   - Retry: 3 attempts, exponential backoff (2s delay)
   - **Note**: Requires `accountId` (added in Stack 7)
2. **Nameserver Update**: Update domain NS records to Cloudflare
   - Worker: Cloudflare worker (auto-queued after zone creation)
   - Uses Namecheap API to set custom nameservers
   - Retry: 3 attempts, exponential backoff (5s delay)
3. **Nameserver Verification**: Verify NS propagation via DNS queries
   - Worker: Cloudflare worker
   - Retry: 10 attempts, exponential backoff (30s delay)
   - **Note**: DNS propagation can take time
4. **DNS Wiring**: Configure MX, SPF, DKIM, DMARC, CNAME records
   - Worker: DNS worker (auto-queued after NS verification)
   - Retry: 3 attempts, exponential backoff (5s delay)
   - **Note**: Field renamed from `apiToken` to `cloudflareApiToken` (Stack 7)
5. **DNS Verification**: Verify DNS record propagation
   - Worker: DNS worker
   - Retry: 10 attempts, exponential backoff (60s delay)
   - **Note**: Field renamed from `apiToken` to `cloudflareApiToken` (Stack 7)

## Configuration Interface

```typescript
interface ProvisioningConfig {
  userId: string;
  projectId: string;
  domain: string;

  // Service credentials
  namecheapApiUser: string;
  namecheapApiKey: string;
  namecheapUsername: string;
  githubToken: string;
  cloudflareApiToken: string;
  cloudflareAccountId: string;  // ✅ Added in Stack 7

  // Domain registration
  years: number;
  contactInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address1: string;
    city: string;
    stateProvince: string;
    postalCode: string;
    country: string;
  };

  // GitHub configuration
  githubOrg: string;
  repoName?: string;
  repoDescription?: string;

  // Email configuration
  emailProvider?: EmailProvider;
  customMXRecords?: Array<{ priority: number; value: string }>;
  customSPF?: string;
  dkimSelectors?: string[];

  // Optional services
  vercelDomain?: string;
  customCNAMEs?: Array<{ name: string; value: string }>;
}
```

## Stack 7 Updates

### 1. Added Cloudflare Account ID
**Location**: `ProvisioningConfig` interface

**Change**:
```typescript
cloudflareAccountId: string;  // NEW FIELD
```

**Reason**: Cloudflare zone creation requires account ID (enforced by CloudflareWorker line 131-133)

### 2. Pass Account ID to Zone Creation
**Location**: `setupCloudflare()` method

**Change**:
```typescript
const jobData: CreateZoneJobData = {
  operation: CloudflareOperationType.CREATE_ZONE,
  userId: config.userId,
  projectId: config.projectId,
  domain: config.domain,
  apiToken: config.cloudflareApiToken,
  accountId: config.cloudflareAccountId,  // NEW FIELD
};
```

### 3. Fixed DNS Wiring Job Data Field Name
**Location**: `wireDNS()` method

**Change**:
```typescript
// Before:
apiToken: config.cloudflareApiToken,

// After:
cloudflareApiToken: config.cloudflareApiToken,
```

**Reason**: `BaseDNSJobData` interface expects `cloudflareApiToken`, not `apiToken`

### 4. Fixed DNS Verification Job Data Field Name
**Location**: `verifyDNS()` method

**Change**:
```typescript
// Before:
apiToken: config.cloudflareApiToken,

// After:
cloudflareApiToken: config.cloudflareApiToken,
```

**Reason**: `BaseDNSJobData` interface expects `cloudflareApiToken`, not `apiToken`

## Job Tracking

The orchestrator returns job IDs for monitoring:

```typescript
interface ProvisioningJobs {
  domainRegistration: string;
  githubOrgVerify: string;
  githubRepoCreate: string;
  cloudflareZone: string;
}
```

**Note**: Only these 4 job IDs are returned immediately from the orchestrator. Subsequent jobs (nameserver update/verification, DNS wiring/verification) are auto-queued by workers and tracked via SSE events, so they don't appear in this return value.

## Progress Monitoring

Users monitor provisioning progress via SSE endpoint:
```
GET /events/stream/:projectId
```

Events are published to Redis channel:
```
project:{projectId}:events
```

All workers publish events to this channel for real-time progress updates.

## Error Handling

- **Retryable errors**: BullMQ retries with exponential backoff
- **Non-retryable errors**: Job fails permanently, user notified via SSE
- **State validation**: Each worker validates state transitions before updating
- **Idempotency**: All operations handle "already exists" cases gracefully

## Testing Readiness

✅ Build passes (TypeScript strict mode)
✅ All job data interfaces correctly typed
✅ Cloudflare account ID required field added
✅ DNS worker field names corrected
✅ Ready for integration testing

**Next Steps**:
- Wire orchestrator into API routes (Stack 8)
- Create end-to-end integration test (Stack 9)
