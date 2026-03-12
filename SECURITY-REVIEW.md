# Security Review - Phase 5

**Review Date**: March 11, 2026
**Reviewer**: Engineering Team
**Scope**: Phase 5 implementation (GitHub + Cloudflare + DNS automation)

---

## Executive Summary

Phase 5 introduces significant new attack surface through third-party API integrations (GitHub, Cloudflare) and automated DNS record management. This review identifies implemented security measures, outstanding vulnerabilities, and recommendations for production deployment.

**Overall Security Posture**: ⚠️ **GOOD with gaps**

- ✅ Strong authentication and authorization controls
- ✅ Secure credential handling for API tokens
- ✅ Input validation on all endpoints
- ⚠️ Missing rate limiting on API endpoints
- ⚠️ Missing audit logging for sensitive operations
- ⚠️ Missing production monitoring and alerting

**Recommendation**: Address rate limiting and audit logging before public launch.

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

## Vulnerabilities Identified

### 🔴 HIGH: Missing API Rate Limiting

**Description**: API endpoints lack per-user and per-IP rate limiting.

**Attack Scenario**:
1. Attacker obtains valid JWT token (stolen or compromised account)
2. Attacker floods `/provision` endpoint with requests
3. System creates hundreds of BullMQ jobs, overwhelming workers
4. Legitimate users experience degraded service
5. Forj incurs costs for domain registrations (if payment bypassed)

**Impact**: HIGH - DDoS, financial loss, service degradation

**Mitigation**:
```typescript
// Add to packages/api/src/middleware/rate-limit.ts
import rateLimit from '@fastify/rate-limit';

server.register(rateLimit, {
  max: 100, // requests
  timeWindow: '1 hour',
  keyGenerator: (request) => request.user?.userId || request.ip,
  errorResponseBuilder: (request, context) => ({
    success: false,
    error: 'Rate limit exceeded',
    retryAfter: context.ttl,
  }),
});
```

**Priority**: 🔴 Critical - implement before public launch

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
- [ ] Set up error tracking (Sentry)
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

**Reviewed By**: Engineering Team
**Date**: March 11, 2026
**Next Review**: Before Phase 7 production launch

**Status**: ⚠️ **Conditional approval** - implement rate limiting and audit logging before public launch.
