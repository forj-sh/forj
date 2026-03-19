/**
 * Domain suggestion engine
 *
 * Generates candidate domains from a project name. Exposes pure
 * generator functions — the caller (CLI init flow) decides when
 * to run Phase 1 vs Phase 2 based on availability results.
 *
 * All generation is local — the API is only used for batch availability checks.
 */

// Phase 1: high-value candidates (one API call)
const TIER_1_TLDS: readonly string[] = ['com', 'io', 'co', 'ai', 'xyz'];
const TIER_1_PREFIXES: readonly string[] = ['get', 'try', 'use'];

// Phase 2: expanded candidates (second API call, only if needed)
const TIER_2_TLDS: readonly string[] = ['sh', 'dev', 'app', 'run'];
const TIER_2_PREFIXES: readonly string[] = ['with', 'go'];
const TIER_2_SUFFIXES: readonly string[] = ['app', 'hq', 'labs'];

/** All known TLDs used for stripping input like "newtech.com" */
const ALL_KNOWN_TLDS: readonly string[] = [...TIER_1_TLDS, ...TIER_2_TLDS];

/**
 * Sanitize a project name into a valid domain label.
 * Strips known TLDs if present (e.g. "newtech.com" → "newtech"),
 * lowercases, and removes invalid characters.
 * Unknown TLDs (e.g. "newtech.banana") are not stripped.
 */
export function sanitizeName(input: string): string {
  let name = input.trim().toLowerCase();

  // Strip known TLD if user typed "newtech.com"
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex > 0) {
    const possibleTld = name.slice(dotIndex + 1);
    if (ALL_KNOWN_TLDS.includes(possibleTld)) {
      name = name.slice(0, dotIndex);
    }
  }

  // Keep only alphanumeric and hyphens, strip leading/trailing hyphens
  return name.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
}

/**
 * Generate Phase 1 candidates (7 domains).
 * Exact name on premium TLDs + top .com prefix variants.
 */
export function generatePhase1(name: string): string[] {
  const clean = sanitizeName(name);
  if (!clean || clean.length < 2) return [];

  const candidates: string[] = [];

  // Exact name on Tier 1 TLDs
  for (const tld of TIER_1_TLDS) {
    candidates.push(`${clean}.${tld}`);
  }

  // Top .com prefix variants
  for (const prefix of TIER_1_PREFIXES) {
    candidates.push(`${prefix}${clean}.com`);
  }

  return [...new Set(candidates)];
}

/**
 * Generate Phase 2 candidates (~10 domains).
 * Secondary TLDs + more .com variants.
 */
export function generatePhase2(name: string): string[] {
  const clean = sanitizeName(name);
  if (!clean || clean.length < 2) return [];

  const candidates: string[] = [];

  // Exact name on secondary TLDs
  for (const tld of TIER_2_TLDS) {
    candidates.push(`${clean}.${tld}`);
  }

  // More .com prefix variants
  for (const prefix of TIER_2_PREFIXES) {
    candidates.push(`${prefix}${clean}.com`);
  }

  // .com suffix variants
  for (const suffix of TIER_2_SUFFIXES) {
    candidates.push(`${clean}${suffix}.com`);
  }

  return [...new Set(candidates)];
}

export type DomainResult = {
  name: string;
  price: string;
  available: boolean;
  tier: 1 | 2 | 3;
  registrar?: string;
};

/**
 * Classify a domain into a tier for sorting.
 * Tier 1: exact name on premium TLD
 * Tier 2: .com variant (prefix/suffix)
 * Tier 3: exact name on secondary TLD
 */
export function getTier(domain: string, baseName: string): 1 | 2 | 3 {
  const clean = sanitizeName(baseName);
  const normalized = domain.toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  if (dotIndex < 0) return 3;

  const label = normalized.slice(0, dotIndex);
  const tld = normalized.slice(dotIndex + 1);

  // Exact match on Tier 1 TLD
  if (label === clean && TIER_1_TLDS.includes(tld)) {
    return 1;
  }

  // .com variant (prefix or suffix)
  if (tld === 'com' && label !== clean) {
    return 2;
  }

  return 3;
}

/**
 * Sort domain results by desirability.
 * 1. Exact .com always first (even if taken — user needs to see it)
 * 2. Available before unavailable (within remaining results)
 * 3. Lower tier before higher tier
 * 4. Lower price within same tier
 */
export function sortResults(domains: DomainResult[], baseName: string): DomainResult[] {
  const clean = sanitizeName(baseName);

  return [...domains].sort((a, b) => {
    // Exact .com always first
    const aIsExactCom = a.name === `${clean}.com`;
    const bIsExactCom = b.name === `${clean}.com`;
    if (aIsExactCom && !bIsExactCom) return -1;
    if (!aIsExactCom && bIsExactCom) return 1;

    // Available before unavailable
    if (a.available && !b.available) return -1;
    if (!a.available && b.available) return 1;

    // Lower tier number first
    if (a.tier !== b.tier) return a.tier - b.tier;

    // Within same tier, sort by price ascending
    return parseFloat(a.price) - parseFloat(b.price);
  });
}
