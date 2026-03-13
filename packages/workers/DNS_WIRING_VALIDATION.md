# DNS Wiring Implementation Validation

**Stack 5: DNS wiring implementation**

Date: March 12, 2026
Status: ✅ Complete

## Implementation Summary

The DNS worker (`dns-worker.ts`) implements complete DNS record provisioning via Cloudflare API.

### Supported Record Types

#### 1. MX Records (Email)
- ✅ Google Workspace (default: `ASPMX.L.GOOGLE.COM` with priority 1, plus 4 backup servers)
- ✅ Microsoft 365 (default: `<domain-prefix>.mail.protection.outlook.com` with priority 0)
- ✅ Custom MX records (user-provided array of `{priority, value}`)
- ✅ Automatic domain prefix replacement for Microsoft 365

#### 2. SPF Records (Email Authentication)
- ✅ Google Workspace default: `v=spf1 include:_spf.google.com ~all`
- ✅ Microsoft 365 default: `v=spf1 include:spf.protection.outlook.com ~all`
- ✅ Custom SPF records (user-provided string)
- ✅ Fallback to `v=spf1 ~all` if no provider specified

#### 3. DKIM Records (Email Signing - Google Workspace)
- ✅ Supports multiple DKIM selectors
- ✅ Creates TXT records at `<selector>._domainkey.<domain>`
- ✅ Placeholder implementation (user must update with actual keys from Google Admin Console)
- ✅ Only runs when `emailProvider === GOOGLE_WORKSPACE` and selectors provided

#### 4. DMARC Records (Email Policy)
- ✅ Always created for all email providers
- ✅ TXT record at `_dmarc.<domain>`
- ✅ Default policy: `v=DMARC1; p=none; rua=mailto:dmarc@<domain>; ruf=mailto:dmarc@<domain>; fo=1`
- ✅ Generates reporting email from domain

#### 5. CNAME Records (Service Integration)
- ✅ GitHub Pages: `www.<domain>` → `<githubOrg>.github.io`
- ✅ Vercel: `app.<domain>` → `<vercelDomain>`
- ✅ Custom CNAMEs: User-provided array of `{name, value}`

## Worker State Machine

DNS worker transitions through these states:

```
QUEUED
  ↓
WIRING_MX → MX records created
  ↓
WIRING_SPF → SPF TXT record created
  ↓
WIRING_DKIM (optional) → DKIM TXT records created (Google Workspace only)
  ↓
WIRING_DMARC → DMARC TXT record created
  ↓
WIRING_CNAME (optional) → CNAME records created
  ↓
WIRING_COMPLETE ✅
```

Each state transition:
- Validated by `isValidDNSStateTransition()`
- Publishes SSE event for real-time progress
- Updates job progress in BullMQ

## Event Publishing

Worker emits these SSE events (consumed by CLI via `/events/stream/:projectId`):

- `MX_WIRING_STARTED` / `MX_WIRING_COMPLETE`
- `SPF_WIRING_STARTED` / `SPF_WIRING_COMPLETE`
- `DKIM_WIRING_STARTED` / `DKIM_WIRING_COMPLETE` (conditional)
- `DMARC_WIRING_STARTED` / `DMARC_WIRING_COMPLETE`
- `CNAME_WIRING_STARTED` / `CNAME_WIRING_COMPLETE` (conditional)
- `WIRING_COMPLETE` (final success event with `recordsCreated` count)
- `WIRING_FAILED` (error event)

## Cloudflare API Integration

All DNS records created via `CloudflareClient.createDNSRecord()`:

```typescript
{
  type: 'MX' | 'TXT' | 'CNAME',
  name: string,         // FQDN or subdomain
  content: string,      // Record value
  priority?: number,    // MX priority
  ttl: 1,              // Auto (Cloudflare manages)
  proxied: false,      // No CDN proxy (DNS only)
}
```

## Error Handling

- All errors wrapped in `CloudflareApiError`
- Retryable errors (network, rate limits) → BullMQ retry (uses default BullMQ retry configuration)
- Non-retryable errors (auth, validation) → Permanent failure
- State machine prevents invalid transitions
- Each failure publishes `WIRING_FAILED` event with error details

## Verification Handler

`handleVerifyRecords()` validates DNS propagation:

- Uses Node.js `dns.promises` for real DNS queries
- Verifies MX, TXT (SPF), CNAME records against expected values
- Retries on failure (DNS propagation can take time)
- Publishes `VERIFICATION_STARTED`, `VERIFICATION_COMPLETE`, or `VERIFICATION_FAILED` events

## Example Job Data

```typescript
{
  operation: DNSOperationType.WIRE_RECORDS,
  userId: "user-abc123",
  projectId: "proj-xyz789",
  domain: "example.com",
  zoneId: "cloudflare-zone-id",
  cloudflareApiToken: "cf-token-xyz",
  emailProvider: EmailProvider.GOOGLE_WORKSPACE,
  githubOrg: "example-org",
  // Optional:
  customMXRecords: [{ priority: 10, value: "mail.custom.com" }],
  customSPF: "v=spf1 include:custom.com ~all",
  dkimSelectors: ["google", "google2"],
  vercelDomain: "example.vercel.app",
  customCNAMEs: [{ name: "blog.example.com", value: "blog.host.com" }],
}
```

## Testing Readiness

✅ Build passes (TypeScript strict mode)
✅ Worker instantiated in `start-workers.ts`
✅ Event publishing wired to Redis pub/sub
✅ State machine validated
✅ Cloudflare API client integration complete

**Ready for end-to-end testing with sandbox Cloudflare zone.**

## Future Enhancements (Post-MVP)

- Auto-fetch DKIM keys from Google Workspace API
- DNS health monitoring (periodic verification)
- Auto-repair for detected DNS issues
- Support for additional email providers (Fastmail, ProtonMail, etc.)
- DNSSEC support
- CAA records for SSL certificate authority restrictions
