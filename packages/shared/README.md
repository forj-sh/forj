# @forj/shared

Shared types, utilities, and constants used across Forj packages.

## Status

🚧 **Coming Soon** — Implementation planned for V1 MVP (Week 1-2)

## Planned Exports

### Types
- `Project` - Project state schema
- `ServiceStatus` - Service state machine types
- `ProvisioningEvent` - SSE event schemas
- `DomainRecord` - DNS record types
- `GitHubConfig` - GitHub configuration types
- `CloudflareConfig` - Cloudflare configuration types

### Utilities
- `validateEmail` - Email validation with Zod
- `validateDomain` - Domain name validation
- `encryptCredentials` - AES-256-GCM encryption
- `decryptCredentials` - AES-256-GCM decryption

### Constants
- Service endpoints
- DNS record templates (SPF, DKIM, DMARC)
- Error codes and messages

## Tech Stack (Planned)

- TypeScript
- Zod (runtime validation)
- Node crypto (encryption)
