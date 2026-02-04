const { generateUUID, getDaysSinceAdded, formatDate, formatCurrency, normalizeProperties } = require('../js/logic');

describe('generateUUID', () => {
  test('returns a string', () => {
    expect(typeof generateUUID()).toBe('string');
  });

  test('returns UUID-like format', () => {
    const uuid = generateUUID();
    // Either crypto.randomUUID format or our fallback format
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('generates unique values', () => {
    const uuids = new Set();
    for (let i = 0; i < 100; i++) {
      uuids.add(generateUUID());
    }
    expect(uuids.size).toBe(100);
  });
});

describe('getDaysSinceAdded', () => {
  test('returns null for null input', () => {
    expect(getDaysSinceAdded(null)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(getDaysSinceAdded(undefined)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(getDaysSinceAdded('')).toBeNull();
  });

  test('returns 0 for today', () => {
    const today = new Date().toISOString();
    expect(getDaysSinceAdded(today)).toBe(0);
  });

  test('returns correct days for past date', () => {
    const daysAgo = 10;
    const pastDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    expect(getDaysSinceAdded(pastDate)).toBe(daysAgo);
  });

  test('returns positive number for future date (uses abs)', () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(getDaysSinceAdded(futureDate)).toBe(5);
  });

  test('handles ISO date strings', () => {
    const result = getDaysSinceAdded('2026-01-21T06:34:05.343Z');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe('formatDate', () => {
  test('returns "-" for null', () => {
    expect(formatDate(null)).toBe('-');
  });

  test('returns "-" for undefined', () => {
    expect(formatDate(undefined)).toBe('-');
  });

  test('returns "-" for empty string', () => {
    expect(formatDate('')).toBe('-');
  });

  test('formats ISO date string', () => {
    const result = formatDate('2026-01-21T06:34:05.343Z');
    // Should contain month, day, year
    expect(result).toMatch(/Jan\s+21,\s+2026/);
  });

  test('formats another date', () => {
    const result = formatDate('2025-12-25T00:00:00.000Z');
    expect(result).toMatch(/Dec\s+2[45],\s+2025/); // may be 24 or 25 depending on timezone
  });
});

describe('formatCurrency', () => {
  test('formats positive number', () => {
    expect(formatCurrency(99900)).toBe('$99,900');
  });

  test('formats zero', () => {
    // zero is falsy, so formatCurrency returns '-'
    expect(formatCurrency(0)).toBe('-');
  });

  test('returns "-" for null', () => {
    expect(formatCurrency(null)).toBe('-');
  });

  test('returns "-" for undefined', () => {
    expect(formatCurrency(undefined)).toBe('-');
  });

  test('returns "-" for empty string', () => {
    expect(formatCurrency('')).toBe('-');
  });

  test('formats large number with commas', () => {
    expect(formatCurrency(1000000)).toBe('$1,000,000');
  });

  test('formats small number', () => {
    expect(formatCurrency(100)).toBe('$100');
  });
});

describe('normalizeProperties', () => {
  test('sets missing arv to empty string', () => {
    const props = [{ arv: null, rehab: 5000, notes: 'test' }];
    normalizeProperties(props);
    expect(props[0].arv).toBe('');
  });

  test('sets missing rehab to empty string', () => {
    const props = [{ arv: 100000, rehab: null, notes: 'test' }];
    normalizeProperties(props);
    expect(props[0].rehab).toBe('');
  });

  test('sets missing notes to empty string', () => {
    const props = [{ arv: 100000, rehab: 5000, notes: null }];
    normalizeProperties(props);
    expect(props[0].notes).toBe('');
  });

  test('preserves existing values', () => {
    const props = [{ arv: 200000, rehab: 40000, notes: 'Great deal' }];
    normalizeProperties(props);
    expect(props[0].arv).toBe(200000);
    expect(props[0].rehab).toBe(40000);
    expect(props[0].notes).toBe('Great deal');
  });

  test('handles empty array', () => {
    const props = [];
    normalizeProperties(props);
    expect(props).toEqual([]);
  });

  test('normalizes multiple properties', () => {
    const props = [
      { arv: null, rehab: null, notes: null },
      { arv: 100000, rehab: null, notes: 'test' },
    ];
    normalizeProperties(props);
    expect(props[0].arv).toBe('');
    expect(props[0].rehab).toBe('');
    expect(props[0].notes).toBe('');
    expect(props[1].arv).toBe(100000);
    expect(props[1].rehab).toBe('');
    expect(props[1].notes).toBe('test');
  });
});
