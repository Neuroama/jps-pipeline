const {
  debounce,
  computeStats,
  computeCountyCounts,
  computeTypeCounts,
  checkDuplicateProperty,
  computeSpread,
  validatePin,
} = require('../js/logic');

// ========== debounce ==========

describe('debounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('delays function execution', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('resets delay on subsequent calls', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);
    debounced();
    jest.advanceTimersByTime(50);
    debounced();
    jest.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('passes arguments to debounced function', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);
    debounced('a', 'b');
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('a', 'b');
  });

  test('only fires once for rapid calls', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);
    for (let i = 0; i < 10; i++) debounced();
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ========== computeStats ==========

describe('computeStats', () => {
  const properties = [
    { stage: 'Ready to Blast' },
    { stage: 'Ready to Blast' },
    { stage: 'New' },
    { stage: 'On Hold' },
    { stage: 'Too High' },
    { stage: 'Sold' },
    { stage: 'Sold' },
  ];

  test('counts each stage correctly', () => {
    const stats = computeStats(properties);
    expect(stats.ready).toBe(2);
    expect(stats.new).toBe(1);
    expect(stats.hold).toBe(1);
    expect(stats.high).toBe(1);
    expect(stats.sold).toBe(2);
    expect(stats.total).toBe(7);
  });

  test('returns all zeros for empty array', () => {
    const stats = computeStats([]);
    expect(stats.ready).toBe(0);
    expect(stats.new).toBe(0);
    expect(stats.hold).toBe(0);
    expect(stats.high).toBe(0);
    expect(stats.sold).toBe(0);
    expect(stats.total).toBe(0);
  });

  test('handles single-stage properties', () => {
    const stats = computeStats([{ stage: 'New' }, { stage: 'New' }]);
    expect(stats.new).toBe(2);
    expect(stats.ready).toBe(0);
    expect(stats.total).toBe(2);
  });
});

// ========== computeCountyCounts ==========

describe('computeCountyCounts', () => {
  test('counts counties and sorts by count descending', () => {
    const props = [
      { county: 'Delaware' },
      { county: 'Delaware' },
      { county: 'Delaware' },
      { county: 'Butler' },
      { county: 'Cambria' },
      { county: 'Cambria' },
    ];
    const result = computeCountyCounts(props);
    expect(result[0]).toEqual(['Delaware', 3]);
    expect(result[1]).toEqual(['Cambria', 2]);
    expect(result[2]).toEqual(['Butler', 1]);
  });

  test('skips properties without county', () => {
    const props = [
      { county: 'Delaware' },
      { county: null },
      { county: undefined },
      { county: '' },
    ];
    const result = computeCountyCounts(props);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(['Delaware', 1]);
  });

  test('returns empty array for empty input', () => {
    expect(computeCountyCounts([])).toEqual([]);
  });
});

// ========== computeTypeCounts ==========

describe('computeTypeCounts', () => {
  test('counts property types', () => {
    const props = [
      { type: 'SFH' },
      { type: 'SFH' },
      { type: 'MFH' },
      { type: 'Lot' },
    ];
    const result = computeTypeCounts(props);
    const map = Object.fromEntries(result);
    expect(map['SFH']).toBe(2);
    expect(map['MFH']).toBe(1);
    expect(map['Lot']).toBe(1);
  });

  test('returns empty array for empty input', () => {
    expect(computeTypeCounts([])).toEqual([]);
  });
});

// ========== checkDuplicateProperty ==========

describe('checkDuplicateProperty', () => {
  const properties = [
    { address: '105 Mohawk St', city: 'Bruin' },
    { address: '177-179 Pine St', city: 'Johnstown' },
    { address: '1317 W. 3rd St', city: 'Chester' },
  ];

  test('finds exact duplicate', () => {
    const dup = checkDuplicateProperty(properties, '105 Mohawk St', 'Bruin');
    expect(dup).not.toBeNull();
    expect(dup.address).toBe('105 Mohawk St');
  });

  test('finds partial address match in same city', () => {
    const dup = checkDuplicateProperty(properties, '105 Mohawk', 'Bruin');
    expect(dup).not.toBeNull();
  });

  test('is case-insensitive', () => {
    const dup = checkDuplicateProperty(properties, '105 MOHAWK ST', 'bruin');
    expect(dup).not.toBeNull();
  });

  test('returns null for different city', () => {
    const dup = checkDuplicateProperty(properties, '105 Mohawk St', 'Chester');
    expect(dup).toBeNull();
  });

  test('returns null for non-matching address', () => {
    const dup = checkDuplicateProperty(properties, '999 Unknown Ave', 'Bruin');
    expect(dup).toBeNull();
  });

  test('returns null for empty address', () => {
    expect(checkDuplicateProperty(properties, '', 'Bruin')).toBeNull();
  });

  test('returns null for empty city', () => {
    expect(checkDuplicateProperty(properties, '105 Mohawk St', '')).toBeNull();
  });
});

// ========== computeSpread ==========

describe('computeSpread', () => {
  test('computes spread with all values', () => {
    expect(computeSpread(275000, 189000, 40000)).toBe(46000);
  });

  test('computes spread without rehab', () => {
    expect(computeSpread(200000, 100000, 0)).toBe(100000);
  });

  test('computes spread with null rehab', () => {
    expect(computeSpread(200000, 100000, null)).toBe(100000);
  });

  test('returns null when arv is missing', () => {
    expect(computeSpread(null, 100000, 40000)).toBeNull();
  });

  test('returns null when asking is missing', () => {
    expect(computeSpread(200000, null, 40000)).toBeNull();
  });

  test('returns null when both missing', () => {
    expect(computeSpread(null, null, null)).toBeNull();
  });

  test('can return negative spread', () => {
    expect(computeSpread(100000, 150000, 20000)).toBe(-70000);
  });
});

// ========== validatePin ==========

describe('validatePin', () => {
  test('returns valid for correct PIN', () => {
    const result = validatePin('2365', '2365');
    expect(result.valid).toBe(true);
  });

  test('returns error for wrong PIN', () => {
    const result = validatePin('1111', '2365');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Wrong PIN');
  });

  test('returns error for short input', () => {
    const result = validatePin('23', '2365');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Enter 4 digits');
  });

  test('returns error for empty input', () => {
    const result = validatePin('', '2365');
    expect(result.valid).toBe(false);
  });

  test('returns error for null input', () => {
    const result = validatePin(null, '2365');
    expect(result.valid).toBe(false);
  });
});
