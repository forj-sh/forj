# Security Review - Phase 6

**Review Date**: March 14, 2026 (Updated after security audit implementation)
**Reviewer**: Engineering Team + AI Code Review (Gemini Code Assist, GitHub Copilot)
**Scope**: Phase 6 implementation (Auth + Credential Security + Security Audit Fixes)

---

## Executive Summary

Phase 6 completed a comprehensive security audit and implemented critical fixes across authentication, rate limiting, credential management, and proxy configuration. All HIGH and CRITICAL severity vulnerabilities identified in Phase 5 have been resolved.

**Overall Security Posture**: ✅ **STRONG - Ready for production launch**

- ✅ Strong authentication and authorization controls (JWT + API keys with scopes)
- ✅ Secure credential handling for API tokens (AES-256-GCM encryption)
- ✅ Input validation on all endpoints
- ✅ **FIXED**: Per-user and per-IP rate limiting on all API routes
- ✅ **FIXED**: Mock authentication endpoint properly gated
- ✅ **FIXED**: Proxy trust configuration prevents IP spoofing
- ✅ **FIXED**: API key rotation with zero-downtime atomicity
- ⚠️ Missing audit logging for sensitive operations (deferred to post-launch)
- ⚠️ Missing production monitoring and alerting (Phase 7 pre-launch task)

**Recommendation**: Complete Phase 7 pre-launch checklist (monitoring, penetration testing) before public launch.

---

## Security Controls Implemented

### 1. Authentication & Authorization ✅

#### JWT Authentication
- **Implementation**: `packages/api/src/middleware/auth.ts`
- **Algorithm**: HS256 with strong secret
- **Token Expiration**: 30 days (configurable)
- **Protected Routes**: All domain, provisioning, and DNS endpoints
- **Strength**: ✅ Strong

**Evidence:**
```typescript
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token);
  request.user = payload;
}
```

#### Authorization (IDOR Prevention)
- **Implementation**: `packages/api/src/middleware/auth.ts`
- **Method**: Ownership verification via project lookup
- **Coverage**: All job status endpoints
- **Strength**: ✅ Strong

**Evidence:**
```typescript
export async function verifyProjectOwnership(
  userId: string,
  projectId: string
): Promise<boolean> {
  const project = await db.query('SELECT user_id FROM projects WHERE id = $1', [projectId]);
  return project.rows[0]?.user_id === userId;
}
```

#### GitHub OAuth Device Flow (RFC 8628)
- **Implementation**: `packages/shared/src/github/oauth.ts`
- **Flow**: Device authorization grant (no client secret exposed)
- **Scopes**: Minimal (`admin:org` for repo management only)
- **Token Storage**: CLI config file (`~/.forj/config.json`)
- **Strength**: ✅ Strong

**Risks**:
- CLI config file is not encrypted (plaintext tokens on disk)
- No token rotation mechanism

**Recommendations**:
1. Encrypt CLI config file with user's system keychain
2. Implement token refresh flow
3. Add token revocation on CLI logout

### 2. API Security ✅

#### Stripe Webhook Verification
- **Implementation**: `packages/api/src/routes/stripe-webhooks.ts`
- **Method**: HMAC signature verification using Stripe SDK
- **Coverage**: All webhook events
- **Strength**: ✅ Strong

**Evidence:**
```typescript
const signature = request.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(
  rawBody,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET
);
// Throws error if signature invalid - prevents webhook forgery
```

#### Server-Side Pricing Validation
- **Implementation**: `packages/api/src/routes/checkout.ts`
- **Method**: PricingCache lookup, client prices ignored
- **Coverage**: All Stripe checkout sessions
- **Strength**: ✅ Strong

**Evidence:**
```typescript
// Client-provided price is IGNORED
const actualPrice = await pricingCache.getPrice(tld, years);
const lineItems = [{
  price_data: {
    unit_amount: Math.round(actualPrice * 100), // Server-side price only
    // ...
  }
}];
```

#### Input Validation
- **Coverage**: All API endpoints
- **Method**: TypeScript types + runtime validation
- **Strength**: ⚠️ Moderate (no schema validation library)

**Gaps**:
- No Zod/Joi schema validation (relying on TypeScript only)
- Missing regex validation for domain names
- No sanitization of user inputs before database insertion

**Recommendations**:
1. Add Zod schema validation on all endpoints
2. Implement domain name regex validation
3. Add SQL injection prevention (parameterized queries only)

### 3. Rate Limiting ⚠️

#### Implemented: Namecheap API Rate Limiting
- **Implementation**: `packages/shared/src/namecheap/rate-limiter.ts`
- **Method**: Redis-backed sliding window (Lua script)
- **Limit**: 20 requests/min (Namecheap API limit)
- **Strength**: ✅ Strong

**Evidence:**
```typescript
export class RateLimiter {
  async checkLimit(userId: string): Promise<{ allowed: boolean; resetAt?: number }> {
    const result = await this.redis.eval(slidingWindowScript, /* ... */);
    return { allowed: result === 1, resetAt: Date.now() + 60000 };
  }
}
```

#### Missing: API Endpoint Rate Limiting
- **Status**: ❌ Not implemented
- **Risk**: HIGH - API abuse, DDoS attacks
- **Affected Endpoints**: All public endpoints

**Recommendations**:
1. Implement per-user rate limiting (100 requests/hour)
2. Implement per-IP rate limiting (1000 requests/hour)
3. Implement burst protection (10 requests/second)
4. Use Fastify rate-limit plugin or custom middleware

### 4. Credential Management ⚠️

#### Cloudflare Token Encryption
- **Implementation**: `packages/shared/src/cloudflare/auth.ts`
- **Method**: AES-256-GCM with random IV
- **Storage**: Database with encrypted blob
- **Strength**: ✅ Strong

**Evidence:**
```typescript
export function encryptToken(token: string, secret: string): EncryptedToken {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encrypted: encrypted.toString('hex'), iv: iv.toString('hex'), authTag: authTag.toString('hex') };
}
```

#### GitHub Token Storage
- **Implementation**: `packages/cli/src/lib/config.ts`
- **Method**: Plaintext in `~/.forj/config.json`
- **Storage**: Local filesystem
- **Strength**: ⚠️ Moderate

**Risks**:
- Tokens are plaintext on disk
- No file permission restrictions (world-readable on some systems)
- No token rotation

**Recommendations**:
1. Use system keychain (Keytar library)
2. Set restrictive file permissions (chmod 600)
3. Implement token refresh flow

#### Namecheap API Key Storage
- **Implementation**: Environment variables
- **Method**: Encrypted at rest (platform-dependent)
- **Strength**: ✅ Strong (assuming secure env var storage)

**Recommendations**:
1. Use secret management service (AWS Secrets Manager, HashiCorp Vault)
2. Rotate API keys quarterly
3. Audit API key access logs

### 5. Error Handling ✅

#### Error Sanitization
- **Implementation**: `packages/shared/src/namecheap/errors.ts`
- **Method**: API key redaction in error messages
- **Coverage**: All Namecheap API errors
- **Strength**: ✅ Strong

**Evidence:**
```typescript
function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/ApiKey=[\w-]+/gi, 'ApiKey=[REDACTED]')
    .replace(/ApiUser=[\w-]+/gi, 'ApiUser=[REDACTED]');
}
```

**Recommendations**:
1. Extend sanitization to GitHub and Cloudflare errors
2. Add PII detection and redaction
3. Implement structured logging with sensitive field masking

---

## Vulnerabilities Identified and Fixed (Phase 6 Security Audit)

### ✅ FIXED: 🔴 CRITICAL-01 - Mock Authentication Endpoint Exposed in Production

**Description**: Mock authentication endpoint `/auth/cli` was registered in production environments, bypassing real authentication.

**Attack Scenario**:
1. Attacker discovers `/auth/cli` endpoint in production
2. Attacker generates unlimited JWT tokens without real authentication
3. Attacker gains full API access without valid credentials
4. System completely compromised

**Impact**: CRITICAL - Complete authentication bypass

**Fix Implemented** (PR #82 - Stack 1):
- Added `ENABLE_MOCK_AUTH` environment variable (defaults to `false`)
- Conditional route registration: only enabled when `!isProduction && mockAuthEnabled`
- Rate limiter no longer runs on disabled routes (performance improvement)
- Hermetic unit tests using `server.inject()` instead of external fetch

**Status**: ✅ RESOLVED

---

### ✅ FIXED: 🔴 HIGH-01 - Missing API Rate Limiting

**Description**: API endpoints lacked per-user and per-IP rate limiting.

**Attack Scenario**:
1. Attacker obtains valid JWT token (stolen or compromised account)
2. Attacker floods `/provision` endpoint with requests
3. System creates hundreds of BullMQ jobs, overwhelming workers
4. Legitimate users experience degraded service
5. Forj incurs costs for domain registrations (if payment bypassed)

**Impact**: HIGH - DDoS, financial loss, service degradation

**Fix Implemented** (PR #67-69 - Stacks 5-7):
- Redis-backed sliding window rate limiter (Lua scripts for atomicity)
- Per-user rate limiting: 10-100 req/hour (route-specific)
- Per-IP rate limiting: 5-60 req/hour (DDoS protection)
- Rate limit headers: `X-UserRateLimit-*` and `X-IpRateLimit-*`
- Applied to all protected routes with tiered limits

**Status**: ✅ RESOLVED

---

### ✅ FIXED: 🔴 HIGH-02 - IP Spoofing via Forged Proxy Headers

**Description**: `getClientIp()` unconditionally trusted `cf-connecting-ip` header even when `TRUST_PROXY=false`, allowing rate limit bypass.

**Attack Scenario**:
1. Attacker sends direct connection with forged `CF-Connecting-IP` header
2. Rate limiting uses spoofed IP instead of real IP
3. Attacker bypasses per-IP rate limits
4. DDoS protection ineffective

**Impact**: HIGH - Rate limit bypass, DDoS vulnerability

**Fix Implemented** (PR #87 - Stack 6):
- Gate `cf-connecting-ip` trust on `request.ips` (only populated when `trustProxy` enabled)
- When `TRUST_PROXY=false`, all proxy headers ignored
- Updated documentation to clarify proxy trust behavior
- Prevents header spoofing in development/testing environments

**Status**: ✅ RESOLVED

---

### ✅ FIXED: 🟡 MEDIUM-01 - Database Query Redundancy and Information Leakage

**Description**: Domain routes made 2 separate database queries (ownership + payment check), leaking information via different error codes.

**Attack Scenario**:
1. Attacker queries `/domains/jobs/:jobId` with different project IDs
2. 403 response means "exists but not yours", 404 means "doesn't exist"
3. Attacker enumerates valid project IDs
4. Information leakage aids targeted attacks

**Impact**: MEDIUM - Information disclosure

**Fix Implemented** (PR #83 - Stack 2):
- Combined 2 queries into 1 using SQL column aliases
- Single `getProjectWithPayment()` query with camelCase properties
- Unified 403/404 response: "Forbidden - you do not own this project or it does not exist"
- 50% reduction in database round-trips

**Status**: ✅ RESOLVED

---

### ✅ FIXED: 🟡 MEDIUM-02 - Missing SSE Stream Authentication

**Description**: SSE streaming endpoint `/events/stream/:projectId` lacked authentication, allowing unauthorized access to real-time provisioning events.

**Attack Scenario**:
1. Attacker enumerates project IDs
2. Attacker opens SSE stream without authentication
3. Attacker monitors competitor provisioning activity
4. Information leakage (domain names, services, timing)

**Impact**: MEDIUM - Information disclosure

**Fix Implemented** (PR #84 - Stack 3):
- Added `requireAuth` middleware to SSE endpoint
- Added `verifyProjectOwnership` authorization check
- Documented reliability trade-offs (fail-open behavior)
- SSE streams now require valid JWT + project ownership

**Status**: ✅ RESOLVED

---

### ✅ FIXED: 🟡 MEDIUM-03 - Plaintext Credentials in Job Queue

**Description**: GitHub and Cloudflare tokens stored in Redis job data as plaintext.

**Attack Scenario**:
1. Attacker gains read access to Redis (misconfiguration, breach)
2. Attacker dumps BullMQ job data
3. Attacker extracts GitHub tokens with `admin:org` scope
4. Attacker can create/delete repositories

**Impact**: MEDIUM - Credential theft, unauthorized repository access

**Fix Implemented** (PR #85 - Stack 4):
- Removed `accessToken` and `apiToken` from all job data structures
- Workers now fetch encrypted credentials from database at execution time
- Documented as BREAKING CHANGE (workers must be updated)
- Redis job data no longer contains sensitive credentials

**Status**: ✅ RESOLVED

---

### ✅ FIXED: 🟡 MEDIUM-04 - API Key Rotation Implementation Bugs

**Description**: `rotateApiKey()` implementation had 5 critical bugs that would cause runtime failures.

**Bugs**:
1. Called non-existent methods `generateApiKey()` and `hashApiKey()`
2. Incorrect `keyHint` calculation (included prefix)
3. Double-encoding scopes with `JSON.stringify()`
4. Return object didn't match `RotateApiKeyResult` interface
5. Rollback error handling could mask original errors

**Impact**: MEDIUM - Feature completely broken, zero-downtime rotation impossible

**Fix Implemented** (PR #86 - Stack 5):
- Fixed method names: `generateKey(prefix)`, `hashKey(newKey)`
- Fixed keyHint calculation to exclude prefix
- Removed `JSON.stringify()` (PostgreSQL handles arrays natively)
- Fixed return object to match interface (added `userId`, renamed `keyId` → `id`)
- Wrapped rollback in try-catch to prevent masking original errors

**Status**: ✅ RESOLVED

---

### ✅ FIXED: 🟢 LOW-01 - Insecure Example Encryption Keys

**Description**: `.env.example` used deterministic base64 strings (`AAAA...`, `BBBB...`) that could be accidentally copy/pasted into production.

**Impact**: LOW - Configuration error risk

**Fix Implemented** (PR #88 - Stack 7):
- Replaced with obviously invalid placeholders: `REPLACE_ME_openssl_rand_base64_32`
- Prevents accidental production use (validation will fail immediately)
- Generation instructions still included in comments

**Status**: ✅ RESOLVED

---

### ✅ FIXED: 🟢 LOW-02 - Missing Encryption Key Validation in getGitHubToken()

**Description**: `getGitHubToken()` checked if key exists but not if it's valid format, leading to late failures.

**Impact**: LOW - Configuration debugging difficulty

**Fix Implemented** (PR #88 - Stack 7):
- Added `isValidEncryptionKey()` check for consistency
- Fails fast with clear error message
- Consistent with `/auth/github/poll` route validation

**Status**: ✅ RESOLVED

### 🟡 MEDIUM: CLI Config File Not Encrypted

**Description**: GitHub and Cloudflare tokens stored in plaintext in `~/.forj/config.json`.

**Attack Scenario**:
1. Attacker gains read access to user's filesystem (malware, supply chain attack)
2. Attacker reads `~/.forj/config.json`
3. Attacker steals GitHub token with `admin:org` scope
4. Attacker can create/delete repositories in user's organization

**Impact**: MEDIUM - token theft, unauthorized repository access

**Mitigation**:
```typescript
// Use keytar for system keychain integration
import keytar from 'keytar';

export async function setGitHubToken(token: string): Promise<void> {
  await keytar.setPassword('forj-cli', 'github-token', token);
}

export async function getGitHubToken(): Promise<string | null> {
  return await keytar.getPassword('forj-cli', 'github-token');
}
```

**Priority**: 🟡 Medium - implement in Phase 6

### 🟡 MEDIUM: No Audit Logging

**Description**: Sensitive operations (provisioning, DNS changes) are not logged for audit purposes.

**Attack Scenario**:
1. Compromised account provisions malicious infrastructure
2. Attacker wires DNS to phishing site
3. Security team has no audit trail to investigate breach
4. Cannot determine when compromise occurred or what was affected

**Impact**: MEDIUM - security incident response, compliance

**Mitigation**:
```typescript
// Add to packages/api/src/lib/audit-log.ts
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (user_id, action, resource_type, resource_id, metadata, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
    [event.userId, event.action, event.resourceType, event.resourceId, event.metadata, event.ipAddress]
  );
}

// Usage in provisioning route
await logAuditEvent({
  userId: config.userId,
  action: 'provision.start',
  resourceType: 'project',
  resourceId: config.projectId,
  metadata: { domain: config.domain, services: ['domain', 'github', 'cloudflare'] },
  ipAddress: request.ip,
});
```

**Priority**: 🟡 Medium - implement in Phase 6

### 🟢 LOW: No Input Schema Validation

**Description**: Relying on TypeScript types for input validation, no runtime schema validation.

**Attack Scenario**:
1. Attacker crafts malicious API request with unexpected types
2. TypeScript types don't catch runtime type mismatches
3. Invalid data reaches database or external APIs
4. Potential SQL injection or API abuse

**Impact**: LOW - data integrity, potential injection attacks

**Mitigation**:
```typescript
// Add Zod schema validation
import { z } from 'zod';

const ProvisioningConfigSchema = z.object({
  userId: z.string().uuid(),
  projectId: z.string().uuid(),
  domain: z.string().regex(/^[a-z0-9-]+\.[a-z]{2,}$/),
  namecheapApiUser: z.string().min(1),
  githubToken: z.string().startsWith('ghp_'),
  // ... rest of schema
});

// In route handler
const config = ProvisioningConfigSchema.parse(request.body);
```

**Priority**: 🟢 Low - implement in Phase 6

---

## Third-Party API Security

### GitHub API
- **Authentication**: OAuth Device Flow (RFC 8628) ✅
- **Scopes**: `admin:org` (minimal required) ✅
- **Rate Limiting**: 5000 req/hour per token ✅
- **Token Storage**: CLI config (plaintext) ⚠️

**Risks**:
- Token theft from CLI config file
- No token rotation or refresh

### Cloudflare API
- **Authentication**: API token (user-generated) ✅
- **Permissions**: Zone.Zone.Read, Zone.DNS.Edit (minimal) ✅
- **Rate Limiting**: 1200 req/5min per token ✅
- **Token Storage**: Encrypted in database ✅

**Risks**:
- User may create over-privileged tokens
- No token rotation mechanism

**Recommendations**:
1. Add token permission validation on CLI auth flow
2. Guide users to create least-privilege tokens
3. Implement token health checks (verify permissions on each use)

### Namecheap API
- **Authentication**: API key + username + client IP ✅
- **Rate Limiting**: 20 req/min (enforced) ✅
- **Sandbox Mode**: Available for testing ✅
- **Token Storage**: Environment variables ✅

**Risks**:
- API keys long-lived (no expiration)
- Client IP whitelisting is effective (TCP handshake prevents spoofing), but could be bypassed if server's outbound IP is compromised or if using shared IP environment

**Recommendations**:
1. Rotate API keys quarterly
2. Monitor for unusual API usage patterns
3. Implement secondary authentication for high-value operations

---

## Production Deployment Checklist

### Pre-Deployment

- [ ] Generate strong JWT_SECRET (min 256 bits): `openssl rand -base64 32`
- [ ] Configure Stripe webhook secret in production
- [ ] Set `NAMECHEAP_SANDBOX=false` for production API
- [ ] Review and restrict CORS configuration
- [ ] Enable HTTPS only (no HTTP endpoints)
- [ ] Set secure cookie flags (httpOnly, secure, sameSite)
- [ ] Configure database connection pooling limits
- [ ] Set Redis max memory and eviction policy
- [ ] Review all environment variables for sensitive data

### Security Hardening

- [ ] **Implement API rate limiting** (🔴 CRITICAL)
- [ ] Implement per-IP rate limiting
- [ ] Add input schema validation (Zod)
- [ ] Add SQL injection prevention checks
- [ ] Configure Content Security Policy headers
- [ ] Enable HSTS (Strict-Transport-Security)
- [ ] Configure X-Frame-Options, X-Content-Type-Options
- [ ] Set up Cloudflare WAF rules
- [ ] Implement DDoS protection
- [ ] Add bot detection (Cloudflare Turnstile)

### Monitoring & Logging

- [ ] **Implement audit logging** (🟡 IMPORTANT)
- [x] **Set up error tracking (Sentry)** ✅ COMPLETE (March 14, 2026)
  - [x] Sentry SDK installed in all 3 packages (API, Workers, CLI)
  - [x] Privacy-first data scrubbing (API keys, tokens, credentials, PII)
  - [x] CLI opt-in telemetry with user consent required
  - [x] Debug endpoints tested (`/debug-sentry`, `/debug-sentry/handled`, `/debug-sentry/message`)
  - [x] Performance monitoring (10% sample rate for API/Workers, 5% for CLI)
  - [ ] Sentry alerts configured for production
- [ ] Configure application metrics (Prometheus)
- [ ] Set up log aggregation (Datadog, LogDNA)
- [ ] Create alerts for failed jobs
- [ ] Create alerts for high error rates
- [ ] Create alerts for rate limit violations
- [ ] Monitor Namecheap API balance
- [ ] Monitor Redis memory usage
- [ ] Monitor database connection pool

### Incident Response

- [ ] Document security incident response plan
- [ ] Create runbook for credential rotation
- [ ] Set up security contact email (security@forj.sh)
- [ ] Configure GitHub security advisories
- [ ] Set up vulnerability disclosure program
- [ ] Document data breach notification procedures

---

## Compliance Considerations

### GDPR (if serving EU users)
- **Data Collection**: Email, domain contact info, IP addresses
- **Legal Basis**: Contract performance (service provisioning)
- **Data Storage**: Neon Postgres (EU region option available)
- **User Rights**: Right to access, deletion, data portability

**TODO**:
- [ ] Add privacy policy
- [ ] Implement user data export endpoint
- [ ] Implement user data deletion endpoint
- [ ] Add cookie consent banner
- [ ] Document data processing agreements with third parties

### PCI DSS (payment processing)
- **Scope**: Limited (using Stripe as payment processor)
- **Responsibilities**: No credit card data stored by Forj
- **Compliance**: Stripe is PCI Level 1 certified

**TODO**:
- [ ] Complete Stripe SAQ-A questionnaire
- [ ] Document cardholder data flow
- [ ] Implement logging for payment events

### SOC 2 (enterprise customers)
**Not applicable for V1 launch** - consider for V3 enterprise tier

---

## Penetration Testing Recommendations

Before public launch, conduct penetration testing focused on:

1. **Authentication & Authorization**
   - JWT token theft and replay attacks
   - IDOR vulnerabilities in job status endpoints
   - OAuth flow manipulation (GitHub Device Flow)

2. **API Security**
   - Stripe webhook forgery attempts
   - Rate limit bypass techniques
   - Input validation bypass (SQL injection, XSS)

3. **Business Logic**
   - Pricing manipulation attacks
   - Provisioning flow race conditions
   - DNS record hijacking attempts

4. **Infrastructure**
   - Redis security (authentication, network exposure)
   - Database security (connection string exposure)
   - Environment variable leakage

**Recommended Testing Provider**: Cure53, Trail of Bits, or Bishop Fox

---

## Security Contacts

- **Security Issues**: security@forj.sh
- **Vulnerability Reports**: https://github.com/forj-sh/forj/security/advisories
- **Bug Bounty**: Coming in Phase 7 (post-launch)

---

## Review Sign-Off

**Initial Review**: Engineering Team (March 11, 2026)
**Security Audit**: AI Code Review - Gemini Code Assist + GitHub Copilot (March 13-14, 2026)
**Fixes Verified**: Engineering Team (March 14, 2026)
**Next Review**: Pre-launch penetration testing (Phase 7)

**Status**: ✅ **APPROVED for production** - All CRITICAL and HIGH severity vulnerabilities resolved. Complete Phase 7 pre-launch checklist (monitoring setup, penetration testing) before public launch.

---

## Phase 6 Security Audit Summary

**Total Vulnerabilities Fixed**: 8 (1 CRITICAL, 2 HIGH, 4 MEDIUM, 2 LOW)
**PRs Merged**: #82-88 (7 stacked PRs)
**Lines Changed**: ~500 lines across 15 files
**Review Method**: Automated AI code review + manual verification

**Key Improvements**:
1. ✅ Mock authentication endpoint properly gated (CRITICAL)
2. ✅ Per-user and per-IP rate limiting implemented (HIGH)
3. ✅ IP spoofing prevention via proxy trust configuration (HIGH)
4. ✅ Database query optimization and information leakage prevention (MEDIUM)
5. ✅ SSE stream authentication and authorization (MEDIUM)
6. ✅ Credentials removed from Redis job queue (MEDIUM)
7. ✅ API key rotation bugs fixed (MEDIUM)
8. ✅ Encryption key validation and secure examples (LOW)

**Remaining Pre-Launch Tasks** (Phase 7):
- [x] Set up production monitoring (Sentry) ✅ COMPLETE (March 14, 2026)
- [ ] Configure Sentry alerting for critical failures
- [ ] Set up log aggregation (Datadog, Logtail)
- [ ] Conduct penetration testing (focus on credential handoff flow)
- [ ] Load testing for rate limit tuning
- [ ] Production deployment validation

---

## Phase 7 Update: Sentry Monitoring Implementation (March 14, 2026)

### Overview

Comprehensive error tracking and monitoring infrastructure implemented across all 3 components (API, Workers, CLI) using Sentry.io with privacy-first design and extensive data scrubbing.

### Implementation Details

**1. API Server (`forj-api`)**
- **SDK**: `@sentry/node` ^10.43.0
- **Integration**: Fastify error handler (`Sentry.setupFastifyErrorHandler`)
- **Instrumentation**: `src/instrument.ts` (imported before all other modules)
- **DSN**: `SENTRY_DSN_API` environment variable
- **Sample Rate**: 10% of transactions (configurable via `SENTRY_TRACES_SAMPLE_RATE`)
- **Features**:
  - Automatic route tracking
  - Performance monitoring
  - Request context (user IDs, project IDs)
  - Database query tracking via OpenTelemetry
  - Git commit SHA release tracking

**2. Workers (`forj-workers`)**
- **SDK**: `@sentry/node` ^10.43.0
- **Instrumentation**: `src/instrument.ts` (loaded after dotenv config)
- **DSN**: `SENTRY_DSN_WORKERS` environment variable
- **Sample Rate**: 10% of transactions
- **Features**:
  - BullMQ job failure tracking
  - Job context (queue name, job ID, attempt count)
  - Custom `captureJobError()` helper for structured error reporting
  - Scrubbed job data in error context

**3. CLI (`forj-cli`)**
- **SDK**: `@sentry/node` ^10.43.0
- **Integration**: Opt-in telemetry (user consent required)
- **Configuration**: `~/.forj/telemetry.json` (enabled flag + anonymous ID)
- **DSN**: `SENTRY_DSN_CLI` environment variable (baked into build)
- **Sample Rate**: 5% of CLI commands (lower to reduce noise)
- **Features**:
  - `forj telemetry enable` - Opt-in with clear disclosure
  - `forj telemetry disable` - Instant opt-out
  - `forj telemetry status` - Check current status
  - Anonymous user IDs (never linked to real identity)
  - Command context tracking (command name, flags)
  - Custom `captureCliError()` helper

### Privacy & Security Controls

**Data Scrubbing (All Components)**:
- ✅ Forj API keys (`forj_live_*`, `forj_test_*`) → `forj_[REDACTED]`
- ✅ JWT tokens → `[JWT_REDACTED]`
- ✅ Bearer tokens → `Bearer [REDACTED]`
- ✅ Cloudflare API tokens (40 chars) → `[CF_TOKEN_REDACTED]`
- ✅ GitHub tokens (`ghp_*`, `gho_*`) → `[GITHUB_TOKEN_REDACTED]`
- ✅ Stripe keys (`sk_live_*`, `sk_test_*`) → `sk_[REDACTED]`
- ✅ Namecheap API keys (32-char hex) → `[NC_API_KEY_REDACTED]`
- ✅ Generic passwords/secrets in JSON → `[REDACTED]`

**CLI-Specific Scrubbing**:
- ✅ Email addresses → `[EMAIL_REDACTED]`
- ✅ Domain names → `[DOMAIN_REDACTED]`
- ✅ IP addresses → `[IP_REDACTED]`
- ✅ User file paths → `~` (replaces home directory)
- ✅ Usernames → `[USER]`

**Additional Safeguards**:
- ✅ `sendDefaultPii: false` (never send IP, user agent, etc.)
- ✅ Authorization headers stripped from API errors
- ✅ Cookie headers removed
- ✅ Custom headers (`X-API-Key`) removed

### Testing & Verification

**Debug Endpoints (Development Only)**:
```bash
# Unhandled error test
curl http://localhost:3000/debug-sentry
# Response: 500 Internal Server Error
# Sentry: Error captured with stack trace

# Handled error test
curl http://localhost:3000/debug-sentry/handled
# Response: {"success":false,"error":"Handled error sent to Sentry"}
# Sentry: Exception captured manually

# Message logging test
curl http://localhost:3000/debug-sentry/message
# Response: {"success":true,"message":"Test message sent to Sentry"}
# Sentry: Info message captured
```

**Verified**:
- ✅ API errors sent to Sentry (unhandled and handled)
- ✅ Sensitive data scrubbed from error messages
- ✅ Request context included in error reports
- ✅ Performance transactions tracked

### Production Configuration

**Environment Variables**:
```bash
# API
SENTRY_DSN_API=https://<key>@<org-id>.ingest.us.sentry.io/<project-id>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# Workers
SENTRY_DSN_WORKERS=https://<key>@<org-id>.ingest.us.sentry.io/<project-id>

# CLI (baked into build)
SENTRY_DSN_CLI=https://<key>@<org-id>.ingest.us.sentry.io/<project-id>

# Optional
GIT_COMMIT_SHA=$(git rev-parse HEAD)  # For release tracking
```

**Sentry Dashboard**:
- Organization: `forj-sh`
- Projects: `forj-api`, `forj-workers`, `forj-cli`
- URL: `https://sentry.io/organizations/forj-sh/`

### Remaining Tasks

- [ ] Configure Sentry alerts in production:
  - [ ] High error rate (> 5% in 5 minutes)
  - [ ] Failed BullMQ jobs (> 10 in 1 hour)
  - [ ] Critical errors (any error with `level: 'fatal'`)
  - [ ] Rate limit violations (> 100 in 1 hour)
- [ ] Set up Slack integration for critical alerts
- [ ] Create Sentry dashboard for key metrics
- [ ] Document incident response workflow with Sentry
- [ ] Test error reporting in production environment

### Security Assessment

**Strengths**:
- ✅ Comprehensive data scrubbing prevents credential leakage
- ✅ CLI telemetry requires explicit user consent (privacy-first)
- ✅ Sample rates reduce costs while maintaining visibility
- ✅ Release tracking enables error correlation with deployments
- ✅ Debug endpoints only enabled in development

**Risks**:
- ⚠️ Sentry has access to error messages (potential PII leakage if scrubbing fails)
- ⚠️ CLI anonymous IDs stored on user's machine (low risk)
- ⚠️ Sentry SDK vulnerabilities could affect error reporting

**Mitigations**:
- ✅ Extensive regex-based scrubbing with multiple layers
- ✅ `beforeSend` hook inspects all events before transmission
- ✅ CLI telemetry can be disabled instantly by user
- ✅ Regular SDK updates via Dependabot

**Recommendation**: ✅ **APPROVED** - Monitoring infrastructure ready for production use. Complete alert configuration before public launch.
