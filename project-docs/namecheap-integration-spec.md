# Namecheap API Integration Spec — Domain Worker

> **Purpose**: Complete technical specification for the Forj domain registration worker, based on the official Namecheap API documentation. This is a handoff document for the dev agent building `packages/workers/domain-worker.ts` and `packages/shared/namecheap-client.ts`.
>
> **Last updated**: March 2026 | **API docs source**: https://www.namecheap.com/support/api/methods/

---

## Table of Contents

1. [Overview & Scope](#1-overview--scope)
2. [Namecheap API Fundamentals](#2-namecheap-api-fundamentals)
3. [API Methods Required for Forj](#3-api-methods-required-for-forj)
4. [TypeScript Client Design](#4-typescript-client-design)
5. [Domain Worker State Machine](#5-domain-worker-state-machine)
6. [Error Handling Strategy](#6-error-handling-strategy)
7. [Sandbox vs Production](#7-sandbox-vs-production)
8. [Security Considerations](#8-security-considerations)
9. [Testing Plan](#9-testing-plan)
10. [Implementation Checklist](#10-implementation-checklist)

---

## 1. Overview & Scope

The domain worker is responsible for domain availability checking, price lookup, registration, nameserver configuration (pointing to Cloudflare), and renewal. Forj acts as a **reseller** — we buy domains wholesale via Namecheap's API and sell at market rate via Stripe.

### What This Worker Does

1. **Check availability** — given a list of candidate domains, return which are available and at what price
2. **Get pricing** — fetch current wholesale pricing for TLDs so we can calculate margins
3. **Register domain** — purchase a domain using Forj's Namecheap reseller account, with registrant contact info from the user
4. **Set nameservers** — point the newly registered domain to Cloudflare's nameservers (handed off from Cloudflare worker)
5. **Get domain info** — verify registration status post-purchase
6. **Renew domain** — handle annual renewals triggered by Stripe subscription
7. **Check balance** — verify Forj's Namecheap account has sufficient funds before attempting registration

### What This Worker Does NOT Do

- DNS record management (that's the Cloudflare worker + DNS wiring worker)
- Domain transfer from other registrars (V2+)
- SSL certificate provisioning (handled by Cloudflare/Vercel)
- WHOIS privacy toggling (enabled by default at registration time)

---

## 2. Namecheap API Fundamentals

### Transport

All API calls are **HTTP GET** requests with parameters as query strings. Responses are **XML**. There is no JSON mode.

```
https://{service_url}/xml.response?ApiUser={api_user}&ApiKey={api_key}&UserName={username}&Command={command}&ClientIp={client_ip}&{method_params}
```

### Service URLs

| Environment | URL |
|---|---|
| **Sandbox** | `https://api.sandbox.namecheap.com/xml.response` |
| **Production** | `https://api.namecheap.com/xml.response` |

### Global Request Parameters (Required on EVERY call)

| Parameter | Type | Description |
|---|---|---|
| `ApiUser` | String | Forj's Namecheap API username |
| `ApiKey` | String | Forj's Namecheap API key |
| `UserName` | String | Same as `ApiUser` (for reseller accounts, this is the reseller username) |
| `ClientIp` | String | **IPv4 only** — the IP of Forj's API server (must be whitelisted in Namecheap dashboard) |
| `Command` | String | The API method to execute (e.g., `namecheap.domains.check`) |

### Response Envelope

Every response follows this XML structure:

```xml
<!-- Success -->
<ApiResponse Status="OK">
  <Errors/>
  <Warnings/>
  <RequestedCommand>namecheap.domains.check</RequestedCommand>
  <CommandResponse Type="namecheap.domains.check">
    <!-- method-specific data -->
  </CommandResponse>
  <Server>PHX01APIEXT02</Server>
  <GMTTimeDifference>--4:00</GMTTimeDifference>
  <ExecutionTime>1.358</ExecutionTime>
</ApiResponse>

<!-- Error -->
<ApiResponse Status="ERROR">
  <Errors>
    <Error Number="2011169">Only 50 domains are allowed in a single check command</Error>
  </Errors>
</ApiResponse>
```

### Global Error Codes

These can appear on ANY call:

| Code | Meaning | Action |
|---|---|---|
| `1010101` | `APIUser` parameter missing | Bug — fix the client |
| `1010102` / `1011102` | `APIKey` parameter missing | Bug — fix the client |
| `1010104` | `Command` parameter missing | Bug — fix the client |
| `1010105` / `1011105` | `ClientIP` parameter missing | Bug — fix the client |
| `1030408` | Unsupported authentication type | Check credentials format |
| `1050900` | Unknown error validating `APIUser` | Retry, then escalate |
| `1011150` | `RequestIP` is invalid | Server IP not whitelisted — check Namecheap dashboard |
| `1017150` | `RequestIP` disabled or locked | IP was blocked — contact Namecheap support |
| `1017105` | `ClientIP` disabled or locked | IP was blocked — contact Namecheap support |
| `1017101` | `ApiUser` disabled or locked | Account issue — check Namecheap dashboard |
| `1017410` | Too many declined payments | Account funding issue |
| `1017411` | Too many login attempts | Rate limited — implement exponential backoff |
| `1019103` | `UserName` not available | Account doesn't exist |
| `1016103` | `UserName` unauthorized | Permissions issue |
| `1017103` | `UserName` disabled or locked | Account issue |

### Rate Limits

Namecheap does not publish explicit rate limits, but the API FAQ recommends:
- No more than **20 requests per minute** for availability checks
- No more than **50 domains per single check call**
- Batch operations where possible

**Implementation**: Use a token bucket rate limiter (20 tokens/min, burst of 5).

---

## 3. API Methods Required for Forj

### 3.1 `namecheap.domains.check` — Check Domain Availability

**Purpose**: Check if one or more domains are available for registration. This is the first thing that fires when a user types a desired domain in the CLI.

**Request Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `DomainList` | String | Yes | Comma-separated list of domains to check (max 50) |

**Example Request**:
```
Command=namecheap.domains.check&DomainList=acme.com,acme.io,getacme.com
```

**Response** — `<DomainCheckResult>` element per domain:

| Attribute | Type | Description |
|---|---|---|
| `Domain` | String | The domain that was checked |
| `Available` | Boolean | `"true"` if the domain can be registered |
| `ErrorNo` | String | `"0"` if no error |
| `Description` | String | Error description if any |
| `IsPremiumName` | Boolean | Whether this is a premium-priced domain |
| `PremiumRegistrationPrice` | Decimal | Registration price if premium (0 if not premium) |
| `PremiumRenewalPrice` | Decimal | Renewal price if premium |
| `PremiumRestorePrice` | Decimal | Restore price if premium |
| `PremiumTransferPrice` | Decimal | Transfer price if premium |
| `IcannFee` | Decimal | ICANN fee (usually $0.18 for .com) |
| `EapFee` | Decimal | Early Access Program fee (Namecheap does NOT support EAP registration via API) |

**Error Codes**:

| Code | Description |
|---|---|
| `2011169` | Only 50 domains allowed per check call |
| `3031510` | Error response from upstream provider |
| `3011511` | Unknown response from upstream provider |

**Forj Usage**:
- Called when user enters desired domain name in CLI
- Generate candidate list: `{name}.com`, `{name}.io`, `{name}.sh`, `{name}.dev`, `get{name}.com`, `{name}app.com`, `{name}hq.com`
- Batch into single call (up to 50)
- Return sorted by availability + price to CLI for user selection

### 3.2 `namecheap.users.getPricing` — Get TLD Pricing

**Purpose**: Fetch current wholesale pricing for domain TLDs. Used to calculate Forj's margin (wholesale cost vs. what we charge via Stripe).

**Request Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ProductType` | String | Yes | Must be `"DOMAIN"` |
| `ProductCategory` | String | No | Use `"DOMAINS"` to filter to domain products |
| `ActionName` | String | No | `"REGISTER"`, `"RENEW"`, `"REACTIVATE"`, or `"TRANSFER"` |
| `ProductName` | String | No | Specific TLD (e.g., `"COM"`, `"IO"`, `"DEV"`) |

**Response** — nested structure:

| Field | Description |
|---|---|
| `ProductType Name` | Always `"DOMAIN"` for our use case |
| `ProductCategory Name` | Category of the product |
| `Product Name` | The TLD (e.g., `COM`) |
| `Duration` | Registration duration |
| `DurationType` | Duration type (e.g., `YEAR`) |
| `Price` | **Final price** (best of regular/user/special/promo) — this is our wholesale cost |
| `RegularPrice` | Standard list price |
| `YourPrice` | Account-specific negotiated price |
| `AdditionalCost` | Any extra fees (e.g., ICANN fee) |
| `YourAdditonalCost` | Account-specific additional cost |
| `CouponPrice` | Price after coupon |
| `Currency` | Currency code |

**Forj Usage**:
- Cache pricing on startup and refresh every 6 hours
- Use `Price` + `AdditionalCost` as our wholesale cost
- Forj retail price = wholesale cost + service margin (~15-20%)
- Show user the retail price during domain selection in CLI
- Store price snapshot at time of purchase for audit trail

### 3.3 `namecheap.domains.create` — Register a Domain

**Purpose**: This is the money call. Registers a domain under Forj's reseller account, charged against Forj's Namecheap balance.

**Request Parameters**:

Core parameters:

| Parameter | Type | Max | Required | Description |
|---|---|---|---|---|
| `DomainName` | String | 70 | Yes | Domain to register (e.g., `getacme.com`) |
| `Years` | Number | 2 | Yes | Registration period (default: 2, but use 1 for Forj) |
| `PromotionCode` | String | 20 | No | Coupon code |
| `Nameservers` | String | — | No | Comma-separated custom nameservers (set to Cloudflare's) |
| `AddFreeWhoisguard` | String | 10 | No | `"yes"` to add free WHOIS privacy (default: `"no"`) |
| `WGEnabled` | String | 10 | No | `"yes"` to enable WHOIS privacy (default: `"no"`) |
| `IsPremiumDomain` | Boolean | 10 | No | Set `true` if registering a premium domain |
| `PremiumPrice` | Currency | 20 | No | Required if `IsPremiumDomain` is true |
| `EapFee` | Currency | 20 | No | EAP fee (not supported by Namecheap API currently) |

Contact parameters (4 contact types, each with identical fields):

The API requires **4 sets of contacts**: `Registrant`, `Tech`, `Admin`, and `AuxBilling`. Each contact set requires the following fields (prefix each field name with the contact type, e.g., `RegistrantFirstName`, `TechFirstName`, etc.):

| Field suffix | Type | Max | Required | Description |
|---|---|---|---|---|
| `FirstName` | String | 255 | Yes | First name |
| `LastName` | String | 255 | Yes | Last name |
| `Address1` | String | 255 | Yes | Street address line 1 |
| `Address2` | String | 255 | No | Street address line 2 |
| `City` | String | 50 | Yes | City |
| `StateProvince` | String | 50 | Yes | State/Province |
| `StateProvinceChoice` | String | 50 | No | State/Province choice |
| `PostalCode` | String | 50 | Yes | Postal code |
| `Country` | String | 50 | Yes | Country code (2-letter ISO) |
| `Phone` | String | 50 | Yes | Phone in format `+NNN.NNNNNNNNNN` |
| `PhoneExt` | String | 50 | No | Phone extension |
| `Fax` | String | 50 | No | Fax in format `+NNN.NNNNNNNNNN` |
| `EmailAddress` | String | 255 | Yes | Email address |
| `OrganizationName` | String | 255 | No | Organization name |
| `JobTitle` | String | 255 | No | Job title |

There is also an optional `Billing` contact set (all fields optional) and an `IdnCode` field for internationalized domain names.

**Extended Attributes**: Required for certain TLDs (`.us`, `.eu`, `.ca`, `.co.uk`, `.org.uk`, `.me.uk`, `.nu`, `.com.au`, `.net.au`, `.org.au`, `.es`, `.nom.es`, `.com.es`, `.org.es`, `.de`, `.fr`). See https://www.namecheap.com/support/api/extended-attributes/ for TLD-specific requirements.

**Response** — `<DomainCreateResult>`:

| Field | Description |
|---|---|
| `Domain` | The domain that was registered |
| `Registered` | `"True"` or `"False"` |
| `ChargedAmount` | Amount charged to Namecheap account balance |
| `DomainID` | Unique domain ID in Namecheap system |
| `OrderID` | Unique order ID |
| `TransactionID` | Unique transaction ID |
| `WhoisguardEnable` | Whether WHOIS privacy was enabled |
| `NonRealTimeDomain` | `"True"` if registration is queued (not instant) |

**Error Codes**:

| Code | Description | Forj Action |
|---|---|---|
| `2033409` | Auth/order error — order not found for username | Retry once, then fail with support escalation |
| `2033407` / `2033270` | WHOIS privacy conflict — can't enable when AddWhoisguard=NO | Fix params: set both `AddFreeWhoisguard=yes` and `WGEnabled=yes` |
| `2015182` | Phone format invalid — must be `+NNN.NNNNNNNNNN` | Validate/reformat phone before sending |
| `2011170` | Invalid promotion code | Remove coupon and retry |
| `2011280` | TLD not supported | Fail gracefully — suggest alternative TLDs |
| `2030280` | TLD not supported in API | Fail gracefully — TLD unavailable via API |
| `2015167` | Invalid years | Fix param — use `1` for Forj |
| `2011168` | Nameservers invalid | Validate Cloudflare NS format before sending |
| `2011322` | Extended attributes invalid | Check extended attributes for TLD |
| `2010323` | Missing billing contact fields | Ensure all required contacts populated |
| `2528166` | Order creation failed | Retry with backoff, check balance |
| `3019166` / `4019166` | Domain not available | Race condition — domain taken between check and create. Report to user. |
| `3031166` | Error from upstream provider | Retry with backoff |
| `3031900` | Unknown upstream response | Retry once, then fail with manual review flag |

**Forj Usage**:
- Called after user confirms domain selection and Stripe payment succeeds
- **Always set `Years=1`** (annual renewals via Stripe subscription)
- **Always set `AddFreeWhoisguard=yes` and `WGEnabled=yes`** (privacy by default)
- **Set `Nameservers` to Cloudflare nameservers** if Cloudflare worker has already created the zone; otherwise, leave blank and use `domains.dns.setCustom` after Cloudflare zone creation
- **Use Forj's company info for Tech, Admin, AuxBilling contacts**; use the customer's info for Registrant
- Store `DomainID`, `OrderID`, `TransactionID` in project state JSONB

### 3.4 `namecheap.domains.dns.setCustom` — Set Custom Nameservers

**Purpose**: Point a domain's nameservers to Cloudflare. Called after domain registration if nameservers weren't set during `domains.create`, or whenever the Cloudflare worker provides updated NS records.

**Request Parameters**:

| Parameter | Type | Max | Required | Description |
|---|---|---|---|---|
| `SLD` | String | 70 | Yes | Second-level domain (e.g., `getacme` for `getacme.com`) |
| `TLD` | String | 10 | Yes | Top-level domain (e.g., `com`) |
| `Nameservers` | String | 1200 | Yes | Comma-separated nameserver list (e.g., `ns1.cloudflare.com,ns2.cloudflare.com`) |

**Response**:

| Field | Description |
|---|---|
| `Domain` | The domain name |
| `Updated` | `"True"` or `"False"` |

**Error Codes**:

| Code | Description |
|---|---|
| `2019166` | Domain not found |
| `2016166` | Domain not associated with your account |
| `2030166` | Edit permission not supported |
| `3031510` | Upstream provider error |
| `3050900` | Unknown upstream error |
| `4022288` | Unable to get nameserver list |

**Forj Usage**:
- Parse domain into SLD + TLD (e.g., `getacme.com` → `SLD=getacme`, `TLD=com`)
- Cloudflare worker provides assigned nameservers after zone creation
- Typical Cloudflare NS: `{name1}.ns.cloudflare.com,{name2}.ns.cloudflare.com`
- Retry up to 3 times with exponential backoff on failure

### 3.5 `namecheap.domains.getInfo` — Get Domain Details

**Purpose**: Verify domain registration status and current configuration. Used for post-registration verification and `forj status` command.

**Request Parameters**:

| Parameter | Type | Max | Required | Description |
|---|---|---|---|---|
| `DomainName` | String | 70 | Yes | Domain name to query |
| `HostName` | String | 255 | No | Hosted domain name (optional) |

**Response**:

| Field | Description |
|---|---|
| `Status` | `OK`, `Locked`, or `Expired` |
| `ID` | Domain ID |
| `DomainName` | Domain name |
| `OwnerName` | Account that owns the domain |
| `IsOwner` | Whether API user owns the domain |
| `IsPremium` | Whether it's a premium domain |

**Error Codes**:

| Code | Description |
|---|---|
| `5019169` | Unknown exception |
| `2030166` | Invalid domain |
| `4011103` | Domain/user not available or access denied |

**Forj Usage**:
- Called after `domains.create` to verify registration completed
- Called by `forj status` to check current domain state
- Poll after `NonRealTimeDomain=True` responses until status is `OK`

### 3.6 `namecheap.domains.renew` — Renew Domain

**Purpose**: Renew a domain for another year. Triggered by Stripe subscription renewal webhook.

**Request Parameters**:

| Parameter | Type | Max | Required | Description |
|---|---|---|---|---|
| `DomainName` | String | 70 | Yes | Domain to renew |
| `Years` | Number | 2 | Yes | Years to renew (use `1`) |
| `PromotionCode` | String | 20 | No | Coupon code |
| `IsPremiumDomain` | Boolean | 10 | No | Whether domain is premium |
| `PremiumPrice` | Currency | 20 | No | Renewal price if premium |

**Response**:

| Field | Description |
|---|---|
| `DomainName` | Domain that was renewed |
| `DomainID` | Domain ID |
| `Renew` | `"True"` or `"False"` |
| `ChargedAmount` | Amount charged |
| `OrderID` | Order ID |
| `TransactionID` | Transaction ID |

**Error Codes**:

| Code | Description |
|---|---|
| `2033409` | Auth/order error |
| `2011170` | Invalid promotion code |
| `2011280` | Invalid TLD |
| `2528166` | Order creation failed |

**Forj Usage**:
- Always `Years=1`
- Triggered by Stripe webhook for annual subscription renewal
- If renewal fails, retry 3 times over 72 hours before alerting user
- Store `ChargedAmount` for reconciliation with Stripe charge

### 3.7 `namecheap.users.getBalances` — Check Account Balance

**Purpose**: Verify Forj's Namecheap account has enough funds before attempting a domain registration.

**Request**: No additional parameters beyond globals.

**Response**:

| Field | Description |
|---|---|
| `Currency` | Currency code |
| `AvailableBalance` | Funds available for purchases |
| `AccountBalance` | Total account balance |
| `EarnedAmount` | Marketplace earnings |
| `WithdrawableAmount` | Amount available for withdrawal |
| `FundsRequiredForAutoRenew` | Reserved for auto-renewals |

**Error Codes**:

| Code | Description |
|---|---|
| `4022312` | Balance info not available |

**Forj Usage**:
- Check before every `domains.create` call
- Alert Forj ops team when `AvailableBalance` drops below $100 (configurable threshold)
- Block registrations if balance is insufficient for the domain price
- Monitor as a health metric

### 3.8 `namecheap.domains.getList` — List Domains

**Purpose**: List all domains in Forj's account. Used for operational monitoring and reconciliation.

**Request Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ListType` | String | No | `ALL`, `EXPIRING`, or `EXPIRED` (default: `ALL`) |
| `SearchTerm` | String | No | Keyword to search |
| `Page` | Number | No | Page number (default: 1) |
| `PageSize` | Number | No | 10-100 per page (default: 20) |
| `SortBy` | String | No | `NAME`, `NAME_DESC`, `EXPIREDATE`, `EXPIREDATE_DESC`, `CREATEDATE`, `CREATEDATE_DESC` |

**Response** — array of `<Domain>` elements:

| Attribute | Description |
|---|---|
| `ID` | Domain ID |
| `Name` | Domain name |
| `User` | Account username |
| `Created` | Creation date |
| `Expires` | Expiration date |
| `IsExpired` | Whether domain is expired |
| `IsLocked` | Whether domain is locked |
| `AutoRenew` | Whether auto-renew is enabled |
| `WhoisGuard` | WHOIS privacy status |
| `IsPremium` | Whether it's premium |
| `IsOurDNS` | Whether using Namecheap DNS |

**Forj Usage**:
- Operational dashboard: list all domains managed by Forj
- Expiry monitoring: `ListType=EXPIRING` to catch domains nearing expiry without Stripe renewal
- Reconciliation: compare Namecheap domain list against Forj database

---

## 4. TypeScript Client Design

### 4.1 File Structure

```
packages/shared/
  src/
    namecheap/
      client.ts           # NamecheapClient class — HTTP + XML parsing
      types.ts            # TypeScript interfaces for all request/response types
      errors.ts           # Custom error classes with error code mapping
      xml-parser.ts       # XML response parsing utilities
      rate-limiter.ts     # Token bucket rate limiter
      index.ts            # Public exports
```

### 4.2 Client Interface

```typescript
interface NamecheapConfig {
  apiUser: string;
  apiKey: string;
  userName: string;
  clientIp: string;
  sandbox: boolean;  // toggles between sandbox/production URLs
}

interface NamecheapClient {
  // Domain availability
  checkDomains(domains: string[]): Promise<DomainCheckResult[]>;

  // Pricing
  getTldPricing(tld?: string, action?: 'REGISTER' | 'RENEW'): Promise<TldPricing[]>;

  // Registration
  createDomain(params: DomainCreateParams): Promise<DomainCreateResult>;

  // Nameserver management
  setCustomNameservers(sld: string, tld: string, nameservers: string[]): Promise<boolean>;

  // Domain info
  getDomainInfo(domainName: string): Promise<DomainInfo>;

  // Renewal
  renewDomain(params: DomainRenewParams): Promise<DomainRenewResult>;

  // Account
  getBalances(): Promise<AccountBalances>;

  // Domain listing
  listDomains(params?: DomainListParams): Promise<DomainListResult>;
}
```

### 4.3 Key Types

```typescript
interface DomainCheckResult {
  domain: string;
  available: boolean;
  isPremium: boolean;
  premiumRegistrationPrice: number;
  premiumRenewalPrice: number;
  icannFee: number;
  errorNo: string;
  description: string;
}

interface DomainCreateParams {
  domainName: string;
  years: number; // Always 1 for Forj
  nameservers?: string[]; // Cloudflare NS
  addFreeWhoisguard: boolean; // Always true
  wgEnabled: boolean; // Always true
  isPremiumDomain?: boolean;
  premiumPrice?: number;
  registrant: ContactInfo; // Customer's info
  tech: ContactInfo; // Forj's info
  admin: ContactInfo; // Forj's info
  auxBilling: ContactInfo; // Forj's info
}

interface ContactInfo {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string; // ISO 2-letter
  phone: string; // Format: +NNN.NNNNNNNNNN
  phoneExt?: string;
  fax?: string;
  emailAddress: string;
  organizationName?: string;
  jobTitle?: string;
}

interface DomainCreateResult {
  domain: string;
  registered: boolean;
  chargedAmount: number;
  domainId: number;
  orderId: number;
  transactionId: number;
  whoisguardEnabled: boolean;
  nonRealTimeDomain: boolean;
}

interface DomainRenewResult {
  domainName: string;
  domainId: number;
  renewed: boolean;
  chargedAmount: number;
  orderId: number;
  transactionId: number;
}

interface AccountBalances {
  currency: string;
  availableBalance: number;
  accountBalance: number;
  fundsRequiredForAutoRenew: number;
}

interface TldPricing {
  tld: string;
  action: string;
  duration: number;
  durationType: string;
  wholesalePrice: number; // Price field — our cost
  retailPrice: number; // RegularPrice field — MSRP
  icannFee: number;
  currency: string;
}
```

### 4.4 XML Parsing Strategy

Use `fast-xml-parser` (npm) — lightweight, zero-dependency XML parser that converts to JS objects:

```typescript
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  // Parse Namecheap's boolean strings
  tagValueProcessor: (tagName, tagValue) => {
    if (tagValue === 'true' || tagValue === 'True') return true;
    if (tagValue === 'false' || tagValue === 'False') return false;
    return tagValue;
  }
});

function parseResponse<T>(xml: string): ApiResponse<T> {
  const parsed = parser.parse(xml);
  const apiResponse = parsed.ApiResponse;

  if (apiResponse.Status === 'ERROR') {
    const errors = Array.isArray(apiResponse.Errors.Error)
      ? apiResponse.Errors.Error
      : [apiResponse.Errors.Error];
    throw new NamecheapApiError(errors);
  }

  return {
    status: apiResponse.Status,
    command: apiResponse.RequestedCommand,
    data: apiResponse.CommandResponse,
    executionTime: parseFloat(apiResponse.ExecutionTime),
  };
}
```

### 4.5 Rate Limiter

```typescript
class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(maxPerMinute: number = 20, burst: number = 5) {
    this.maxTokens = burst;
    this.tokens = burst;
    this.refillRate = maxPerMinute / 60000;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      const waitMs = (1 - this.tokens) / this.refillRate;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      this.refill();
    }
    this.tokens -= 1;
  }
}
```

---

## 5. Domain Worker State Machine

The domain worker runs as a BullMQ job. Its state is tracked in the project's `services.domain` JSONB column.

### State Transitions

```
pending
  → checking_availability   (user selected domain, checking one more time)
  → available               (domain is available, awaiting payment)
  → payment_received        (Stripe payment confirmed)
  → checking_balance        (verifying Namecheap account funds)
  → registering             (domains.create call in progress)
  → setting_nameservers     (domains.dns.setCustom call — if not set during create)
  → verifying               (domains.getInfo to confirm registration)
  → complete                (domain registered and verified)
  → failed                  (terminal failure — requires manual intervention)
```

### Worker Job Payload

```typescript
interface DomainWorkerPayload {
  projectId: string;
  domainName: string;
  registrantContact: ContactInfo;
  cloudflareNameservers?: string[]; // Set by Cloudflare worker if it ran first
  stripePaymentIntentId: string;
  isPremium: boolean;
  premiumPrice?: number;
  retryCount: number;
}
```

### Retry Strategy

| Error Type | Max Retries | Backoff | Example |
|---|---|---|---|
| Network/timeout | 5 | Exponential (1s, 2s, 4s, 8s, 16s) | Connection refused |
| Upstream provider error (`3031xxx`) | 3 | Exponential (5s, 15s, 45s) | Enom error |
| Domain unavailable (`3019166`) | 0 | N/A — terminal | Race condition, domain taken |
| Insufficient balance | 0 | N/A — alert ops | Forj account underfunded |
| Invalid params (`2015xxx`, `2011xxx`) | 0 | N/A — bug | Fix code, don't retry |

---

## 6. Error Handling Strategy

### Error Classification

```typescript
enum NamecheapErrorCategory {
  AUTH = 'AUTH',               // 1010xxx, 1017xxx — credential/IP issues
  VALIDATION = 'VALIDATION',  // 2011xxx, 2015xxx — bad input params
  PAYMENT = 'PAYMENT',        // 2033xxx, 2528xxx — billing/order issues
  AVAILABILITY = 'AVAILABILITY', // 3019xxx, 4019xxx — domain taken
  PROVIDER = 'PROVIDER',      // 3031xxx, 3050xxx — upstream provider errors
  UNKNOWN = 'UNKNOWN',        // 5019xxx — catch-all
}

class NamecheapApiError extends Error {
  constructor(
    public readonly errors: Array<{ number: string; message: string }>,
    public readonly category: NamecheapErrorCategory,
  ) {
    super(`Namecheap API error [${category}]: ${errors.map(e => e.message).join('; ')}`);
  }
}
```

### Error → User Message Mapping

| Category | SSE Event | User-Facing Message |
|---|---|---|
| AUTH | `domain:error` | "Infrastructure error — our team has been notified." |
| VALIDATION | `domain:error` | "Invalid input — please check your contact details." |
| PAYMENT | `domain:error` | "Payment processing error — please try again." |
| AVAILABILITY | `domain:unavailable` | "Domain is no longer available — it was just registered by someone else." |
| PROVIDER | `domain:retrying` | "Waiting on domain registrar — retrying automatically." |
| UNKNOWN | `domain:error` | "Unexpected error — our team has been notified." |

---

## 7. Sandbox vs Production

### Environment Switching

The only difference is the base URL and credentials. Use environment variables:

```bash
# .env
NAMECHEAP_API_USER=forj_reseller
NAMECHEAP_API_KEY=your_api_key_here
NAMECHEAP_USERNAME=forj_reseller
NAMECHEAP_CLIENT_IP=203.0.113.10        # Forj server's static IP
NAMECHEAP_SANDBOX=true                   # false for production
```

### Sandbox Notes

- Create a separate account at `sandbox.namecheap.com` (different from production)
- Sandbox accounts have fake balance — no real charges
- Domain registrations in sandbox don't actually register domains
- Sandbox has no restrictions on API access (no $50 minimum)
- **Test all flows in sandbox before any production call**

### Production Requirements

To enable API access on production:
- Account balance ≥ $50, OR
- 20+ domains in account, OR
- Contact Namecheap support to request access

---

## 8. Security Considerations

### Credential Storage

- Namecheap API key stored in environment variables, never in code
- In production: use a secrets manager (Railway secrets, AWS SSM, etc.)
- Rotate API key quarterly via Namecheap dashboard
- **API key rotation immediately invalidates the old key** — coordinate deploys

### IP Whitelisting

- Namecheap requires explicit IP whitelisting (IPv4 only)
- Only Forj's production API server IP should be whitelisted
- If deploying to Railway/Render: use a static IP proxy (e.g., QuotaGuard) or use a dedicated VPS with static IP for Namecheap calls
- **This is a hard requirement** — calls from non-whitelisted IPs are silently rejected

### Contact Info Handling

- Registrant contact data (customer PII) is used only for the `domains.create` call
- Do NOT persist raw contact data after registration succeeds
- Store only: domain name, domain ID, registration date, expiry date
- WHOIS privacy is always enabled, shielding customer data from public WHOIS

### Financial Controls

- Every `domains.create` call must be preceded by a successful Stripe payment
- Log `ChargedAmount` from every registration/renewal for reconciliation
- Alert on any mismatch between Stripe charge and Namecheap charge
- Monthly reconciliation: Namecheap balance movements vs. Stripe payments received

---

## 9. Testing Plan

### Unit Tests

| Test | What It Verifies |
|---|---|
| XML parser handles success response | Correct parsing of `Status="OK"` responses |
| XML parser handles error response | Throws `NamecheapApiError` with correct code |
| XML parser handles multiple `DomainCheckResult` | Array of results from batch check |
| Contact info flattening | `ContactInfo` object → `RegistrantFirstName`, `RegistrantLastName` etc. params |
| Phone number formatting | Various input formats → `+NNN.NNNNNNNNNN` |
| Domain SLD/TLD splitting | `getacme.com` → `SLD=getacme`, `TLD=com`; handles `co.uk` etc. |
| Rate limiter blocks excess calls | >20 calls/min are queued |
| Error categorization | Error codes map to correct `NamecheapErrorCategory` |

### Integration Tests (Sandbox)

| Test | Steps |
|---|---|
| Full registration flow | `check` → `getPricing` → `create` → `getInfo` → verify status |
| Nameserver update | `create` → `setCustom` → `getInfo` → verify NS |
| Domain renewal | `create` → `renew` → `getInfo` → verify new expiry |
| Balance check | `getBalances` → verify fields parse correctly |
| Unavailable domain | `check` known-taken domain → verify `Available=false` |
| Batch check (50 domains) | `check` with 50 domains → verify all results returned |
| Invalid params | `create` with bad phone → verify error code `2015182` |
| Premium domain detection | `check` premium domain → verify `IsPremiumName=true` and pricing |

### E2E Tests

| Test | Steps |
|---|---|
| CLI → domain registration | Simulate `forj init` → select domain → mock Stripe → verify Namecheap create called |
| Renewal webhook | Simulate Stripe renewal webhook → verify `domains.renew` called |
| Balance alert | Set low balance threshold → verify ops alert triggers |

---

## 10. Implementation Checklist

### Phase 1: Client Library (`packages/shared/namecheap/`)

- [ ] Set up `fast-xml-parser` dependency
- [ ] Implement `NamecheapClient` class with config (sandbox/prod toggle)
- [ ] Implement XML response parser with error handling
- [ ] Implement `checkDomains()` method
- [ ] Implement `getTldPricing()` method
- [ ] Implement `createDomain()` method with contact info flattening
- [ ] Implement `setCustomNameservers()` method with SLD/TLD splitting
- [ ] Implement `getDomainInfo()` method
- [ ] Implement `renewDomain()` method
- [ ] Implement `getBalances()` method
- [ ] Implement `listDomains()` method
- [ ] Implement token bucket rate limiter
- [ ] Implement error classification (`NamecheapErrorCategory`)
- [ ] Implement phone number formatter (`+NNN.NNNNNNNNNN`)
- [ ] Write unit tests for all parsing and utility functions
- [ ] Run integration tests against sandbox

### Phase 2: Domain Worker (`packages/workers/domain-worker.ts`)

- [ ] Define BullMQ job type (`DomainWorkerPayload`)
- [ ] Implement state machine transitions
- [ ] Implement pre-registration balance check
- [ ] Implement domain registration with Cloudflare NS passthrough
- [ ] Implement post-registration verification polling
- [ ] Implement nameserver update (for when Cloudflare worker runs after domain worker)
- [ ] Implement SSE event emission for each state transition
- [ ] Implement retry logic per error category
- [ ] Implement renewal job handler (triggered by Stripe webhook)
- [ ] Wire up ops alerts (low balance, registration failures)
- [ ] Write integration tests against sandbox

### Phase 3: API Endpoints (`packages/api/`)

- [ ] `POST /api/domains/check` — availability check endpoint (calls `checkDomains`)
- [ ] `GET /api/domains/pricing` — cached TLD pricing endpoint (calls `getTldPricing`)
- [ ] `GET /api/domains/:domainName/status` — domain status endpoint (calls `getDomainInfo`)
- [ ] `POST /api/domains/register` — triggers domain worker job
- [ ] `POST /api/webhooks/stripe` — handles renewal webhook → triggers renewal job
- [ ] Implement pricing cache (6-hour TTL)

### Phase 4: Production Readiness

- [ ] Set up Namecheap production account with $50+ balance
- [ ] Enable API access and whitelist production server IP
- [ ] Configure static IP for production server (QuotaGuard or dedicated proxy)
- [ ] Set up monitoring: balance alerts, registration failure alerts
- [ ] Set up monthly reconciliation report (Namecheap charges vs. Stripe revenue)
- [ ] Load test against sandbox (simulate 50 concurrent registrations)
- [ ] Security review: PII handling, credential rotation procedure

---

## Appendix A: Existing Node.js Libraries

Several community libraries exist but are **not recommended** for Forj's use case:

| Library | npm | Notes |
|---|---|---|
| `namecheap-api` | [npm](https://www.npmjs.com/package/namecheap-api) | JS, not TypeScript, limited maintenance |
| `namecheap-ts` | [GitHub](https://github.com/abdulrahmanKanakri/namecheap-ts) | TypeScript wrapper, small community |
| `namecheap` | [npm](https://www.npmjs.com/package/namecheap) | Outdated, minimal features |

**Recommendation**: Build a custom client in `packages/shared/namecheap/`. The API surface we need is small (8 methods), the transport is simple (HTTP GET + XML parsing), and a custom client gives us full control over error handling, retries, rate limiting, and type safety. Total effort: ~1 day for the client library.

## Appendix B: Domain Candidate Generation

When a user enters a project name (e.g., `acme`), Forj should generate and batch-check these candidate domains:

```typescript
function generateCandidates(name: string): string[] {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return [
    // Exact match — premium TLDs first
    `${sanitized}.com`,
    `${sanitized}.io`,
    `${sanitized}.dev`,
    `${sanitized}.sh`,
    `${sanitized}.co`,
    `${sanitized}.app`,
    // Prefixed variations
    `get${sanitized}.com`,
    `try${sanitized}.com`,
    `use${sanitized}.com`,
    // Suffixed variations
    `${sanitized}app.com`,
    `${sanitized}hq.com`,
    `${sanitized}.xyz`,
    `${sanitized}.tech`,
  ];
}
```

Sort results for CLI display: available first, then by price ascending, then by TLD preference (`.com` > `.io` > `.dev` > `.sh` > others).

## Appendix C: Phone Number Formatting

Namecheap requires `+NNN.NNNNNNNNNN` format. Common inputs and expected outputs:

| Input | Output |
|---|---|
| `+1.4155551234` | `+1.4155551234` (already correct) |
| `4155551234` | `+1.4155551234` (assume US if no country code) |
| `+44 20 7946 0958` | `+44.2079460958` |
| `(415) 555-1234` | `+1.4155551234` |

Use `libphonenumber-js` for parsing and reformatting.
