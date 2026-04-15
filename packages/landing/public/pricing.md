# forj pricing

> Machine-readable pricing for agents and humans. Single SKU, no tiers, no subscription.

## Summary

forj charges a flat **$1.00 USD service fee per project**, plus the wholesale cost of the domain you register (passed through at cost, including ICANN fee). There are no tiers, no seats, no usage limits, and no recurring charges.

One command, one charge, unlimited projects.

## Price

| Item | Amount | Notes |
|---|---|---|
| forj service fee | **$1.00 USD** | Flat, per project. Never changes with volume or tier. |
| Domain registration | wholesale + ICANN fee | Pass-through from Namecheap. Varies by TLD. |
| GitHub org + repo | $0.00 | Included |
| Cloudflare zone + DNS | $0.00 | Included |
| Nameserver wiring | $0.00 | Included |

**Total per project = `$1.00 + domain_wholesale + icann_fee`**

## Machine-readable pricing

- Live JSON endpoint: `https://api.forj.sh/v1/pricing`
- Returns: service fee, per-TLD wholesale prices, ICANN fee, currency
- No authentication required
- HTTP cache: `Cache-Control: public, max-age=300` (5 minutes)
- Upstream cache: forj caches Namecheap pricing server-side for 1 hour; the response's `generatedAt` is the response time, not the pricing refresh time

Example response shape:

```json
{
  "success": true,
  "data": {
    "currency": "USD",
    "serviceFee": {
      "amount": 1.00,
      "per": "project",
      "description": "Flat forj fee per project. No tiers, no subscription, unlimited projects."
    },
    "included": [
      "Domain registration (wholesale + ICANN fee pass-through)",
      "GitHub organization and repository",
      "Cloudflare DNS zone",
      "Nameserver wiring (Namecheap → Cloudflare)"
    ],
    "domains": {
      "com": { "wholesale": 10.28, "icannFee": 0.18, "total": 11.46, "currency": "USD" },
      "io":  { "wholesale": 39.50, "icannFee": 0.18, "total": 40.68, "currency": "USD" },
      "dev": { "wholesale": 14.00, "icannFee": 0.18, "total": 15.18, "currency": "USD" }
    },
    "notes": {
      "premiumDomains": "Premium domains are priced by the registry. Call POST /domains/check for a live quote.",
      "payment": "Payment via Stripe Checkout. Autonomous agent payment is not yet supported.",
      "humanReadable": "https://forj.sh/pricing.md",
      "llmsTxt": "https://forj.sh/llms.txt"
    },
    "generatedAt": "2026-04-05T00:00:00Z"
  }
}
```

Each domain entry's `total` = `wholesale + icannFee + serviceFee.amount` — the exact amount an agent will be charged at Stripe Checkout.

Premium domains (short, common words) are priced separately by the registry. Call `POST /domains/check` with authentication to get the live quoted price for a specific domain before purchase.

## How agents pay

forj uses Stripe Checkout for payment. As of today, checkout requires a browser redirect — an agent running `npx forj-cli init <name>` will receive a checkout URL that a human must open to complete payment. Autonomous agent payment (delegated payment methods, prepaid balances) is on the roadmap but not yet available.

If you are building an agent that needs to provision infrastructure via forj without a human in the loop, contact us at hello@forj.sh — we want to hear about your use case.

## Agent-friendly features

- **Flat pricing** — no negotiation, no sales calls, no tier decisions
- **`--json` / non-interactive mode** — CLI supports machine-readable I/O for agent orchestration
- **API key authentication** — programmatic access without device-flow interaction
- **`llms.txt`** — agent discovery at https://forj.sh/llms.txt
- **This page** — https://forj.sh/pricing.md

## Contact

- Website: https://forj.sh
- GitHub: https://github.com/forj-sh
- npm: https://www.npmjs.com/package/forj-cli
- Email: hello@forj.sh
