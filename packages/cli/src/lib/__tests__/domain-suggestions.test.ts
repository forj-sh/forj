import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeName,
  generatePhase1,
  generatePhase2,
  getTier,
  sortResults,
  type DomainResult,
} from '../domain-suggestions.js';

describe('sanitizeName', () => {
  it('lowercases and strips invalid chars', () => {
    assert.equal(sanitizeName('NewTech'), 'newtech');
    assert.equal(sanitizeName('My App!'), 'myapp');
    assert.equal(sanitizeName('  hello  '), 'hello');
  });

  it('strips known TLDs if present', () => {
    assert.equal(sanitizeName('newtech.com'), 'newtech');
    assert.equal(sanitizeName('newtech.io'), 'newtech');
    assert.equal(sanitizeName('newtech.ai'), 'newtech');
  });

  it('preserves hyphens but strips leading/trailing', () => {
    assert.equal(sanitizeName('my-app'), 'my-app');
    assert.equal(sanitizeName('-my-app-'), 'my-app');
  });

  it('does not strip unknown TLDs', () => {
    assert.equal(sanitizeName('newtech.banana'), 'newtechbanana');
  });

  it('returns empty for invalid input', () => {
    assert.equal(sanitizeName(''), '');
    assert.equal(sanitizeName('!!!'), '');
  });
});

describe('generatePhase1', () => {
  it('generates exactly 8 candidates for a valid name', () => {
    const candidates = generatePhase1('newtech');
    assert.equal(candidates.length, 8);
  });

  it('includes exact name on Tier 1 TLDs', () => {
    const candidates = generatePhase1('newtech');
    assert.ok(candidates.includes('newtech.com'));
    assert.ok(candidates.includes('newtech.io'));
    assert.ok(candidates.includes('newtech.co'));
    assert.ok(candidates.includes('newtech.ai'));
    assert.ok(candidates.includes('newtech.xyz'));
  });

  it('includes .com prefix variants', () => {
    const candidates = generatePhase1('newtech');
    assert.ok(candidates.includes('getnewtech.com'));
    assert.ok(candidates.includes('trynewtech.com'));
    assert.ok(candidates.includes('usenewtech.com'));
  });

  it('handles name with TLD', () => {
    const candidates = generatePhase1('newtech.com');
    assert.ok(candidates.includes('newtech.com'));
    assert.ok(candidates.includes('newtech.io'));
  });

  it('returns empty for too-short input', () => {
    assert.deepEqual(generatePhase1('a'), []);
    assert.deepEqual(generatePhase1(''), []);
  });

  it('has no duplicates', () => {
    const candidates = generatePhase1('newtech');
    assert.equal(candidates.length, new Set(candidates).size);
  });
});

describe('generatePhase2', () => {
  it('includes secondary TLDs', () => {
    const candidates = generatePhase2('newtech');
    assert.ok(candidates.includes('newtech.sh'));
    assert.ok(candidates.includes('newtech.dev'));
    assert.ok(candidates.includes('newtech.app'));
    assert.ok(candidates.includes('newtech.run'));
  });

  it('includes .com suffix variants', () => {
    const candidates = generatePhase2('newtech');
    assert.ok(candidates.includes('newtechapp.com'));
    assert.ok(candidates.includes('newtechhq.com'));
    assert.ok(candidates.includes('newtechlabs.com'));
  });

  it('does not overlap with Phase 1', () => {
    const phase1 = new Set(generatePhase1('newtech'));
    const phase2 = generatePhase2('newtech');
    for (const d of phase2) {
      assert.ok(!phase1.has(d), `${d} should not be in both phases`);
    }
  });
});

describe('getTier', () => {
  it('classifies exact Tier 1 matches', () => {
    assert.equal(getTier('newtech.com', 'newtech'), 1);
    assert.equal(getTier('newtech.io', 'newtech'), 1);
    assert.equal(getTier('newtech.ai', 'newtech'), 1);
  });

  it('classifies .com variants as Tier 2', () => {
    assert.equal(getTier('getnewtech.com', 'newtech'), 2);
    assert.equal(getTier('newtechapp.com', 'newtech'), 2);
  });

  it('classifies .xyz as Tier 1', () => {
    assert.equal(getTier('newtech.xyz', 'newtech'), 1);
  });

  it('classifies secondary TLDs as Tier 3', () => {
    assert.equal(getTier('newtech.sh', 'newtech'), 3);
    assert.equal(getTier('newtech.dev', 'newtech'), 3);
  });
});

describe('sortResults', () => {
  it('puts exact .com first even if unavailable', () => {
    const results: DomainResult[] = [
      { name: 'newtech.io', price: '29.00', available: true, tier: 1 },
      { name: 'newtech.com', price: '9.95', available: false, tier: 1 },
    ];
    const sorted = sortResults(results, 'newtech');
    assert.equal(sorted[0].name, 'newtech.com');
  });

  it('sorts available before unavailable within same tier', () => {
    const results: DomainResult[] = [
      { name: 'newtech.io', price: '29.00', available: false, tier: 1 },
      { name: 'newtech.ai', price: '39.00', available: true, tier: 1 },
    ];
    const sorted = sortResults(results, 'newtech');
    assert.equal(sorted[0].name, 'newtech.ai');
  });

  it('sorts Tier 1 before Tier 2 before Tier 3', () => {
    const results: DomainResult[] = [
      { name: 'newtech.sh', price: '5.00', available: true, tier: 3 },
      { name: 'getnewtech.com', price: '9.95', available: true, tier: 2 },
      { name: 'newtech.io', price: '29.00', available: true, tier: 1 },
    ];
    const sorted = sortResults(results, 'newtech');
    assert.equal(sorted[0].name, 'newtech.io');
    assert.equal(sorted[1].name, 'getnewtech.com');
    assert.equal(sorted[2].name, 'newtech.sh');
  });

  it('sorts by price within same tier', () => {
    const results: DomainResult[] = [
      { name: 'newtech.ai', price: '39.00', available: true, tier: 1 },
      { name: 'newtech.io', price: '29.00', available: true, tier: 1 },
    ];
    const sorted = sortResults(results, 'newtech');
    assert.equal(sorted[0].name, 'newtech.io');
    assert.equal(sorted[1].name, 'newtech.ai');
  });
});
