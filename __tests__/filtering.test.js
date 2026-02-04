const { getFiltered } = require('../js/logic');

const sampleProperties = [
  { id: '1', address: '105 Mohawk St', city: 'Bruin', county: 'Butler', type: 'SFH', stage: 'Ready to Blast', asking: 29900, beds: 2, baths: 2, notes: 'No heat', dateAdded: '2026-01-21T06:34:05.343Z' },
  { id: '2', address: '177-179 Pine St', city: 'Johnstown', county: 'Cambria', type: 'MFH', stage: 'Ready to Blast', asking: 24900, beds: null, baths: null, notes: 'Newer sewer line', dateAdded: '2026-01-22T06:34:05.343Z' },
  { id: '3', address: '1317 W. 3rd St', city: 'Chester', county: 'Delaware', type: 'SFH', stage: 'New', asking: 99900, beds: 4, baths: 1, notes: '', dateAdded: '2026-01-23T06:34:05.343Z' },
  { id: '4', address: '708 Jeffrey St', city: 'Chester', county: 'Delaware', type: 'SFH', stage: 'Too High', asking: 99900, beds: 3, baths: 1, notes: '', dateAdded: '2026-01-24T06:34:05.343Z' },
  { id: '5', address: '173 Beechwood Ave', city: 'Clifton Heights', county: 'Delaware', type: 'Lot', stage: 'On Hold', asking: 29900, beds: null, baths: null, notes: 'Buildable lot', dateAdded: '2026-01-25T06:34:05.343Z' },
  { id: '6', address: '800 3rd Ave', city: 'Hyde Park', county: 'Westmoreland', type: 'SFH', stage: 'Sold', asking: 59900, beds: 3, baths: 1, notes: 'Electric heat', dateAdded: '2026-01-26T06:34:05.343Z' },
];

describe('getFiltered', () => {
  // Stage filters
  test('returns all properties with "all" filter', () => {
    const result = getFiltered(sampleProperties, { currentFilter: 'all' });
    expect(result).toHaveLength(6);
  });

  test('filters by "ready" stage', () => {
    const result = getFiltered(sampleProperties, { currentFilter: 'ready' });
    expect(result).toHaveLength(2);
    result.forEach(p => expect(p.stage).toBe('Ready to Blast'));
  });

  test('filters by "new" stage', () => {
    const result = getFiltered(sampleProperties, { currentFilter: 'new' });
    expect(result).toHaveLength(1);
    expect(result[0].stage).toBe('New');
  });

  test('filters by "hold" stage', () => {
    const result = getFiltered(sampleProperties, { currentFilter: 'hold' });
    expect(result).toHaveLength(1);
    expect(result[0].stage).toBe('On Hold');
  });

  test('filters by "high" stage', () => {
    const result = getFiltered(sampleProperties, { currentFilter: 'high' });
    expect(result).toHaveLength(1);
    expect(result[0].stage).toBe('Too High');
  });

  test('filters by "sold" stage', () => {
    const result = getFiltered(sampleProperties, { currentFilter: 'sold' });
    expect(result).toHaveLength(1);
    expect(result[0].stage).toBe('Sold');
  });

  // County filter
  test('filters by county', () => {
    const result = getFiltered(sampleProperties, { countyFilter: 'Delaware' });
    expect(result).toHaveLength(3);
    result.forEach(p => expect(p.county).toBe('Delaware'));
  });

  test('returns empty for nonexistent county', () => {
    const result = getFiltered(sampleProperties, { countyFilter: 'Nonexistent' });
    expect(result).toHaveLength(0);
  });

  // Type filter
  test('filters by type', () => {
    const result = getFiltered(sampleProperties, { typeFilter: 'SFH' });
    expect(result).toHaveLength(4);
    result.forEach(p => expect(p.type).toBe('SFH'));
  });

  test('filters by Lot type', () => {
    const result = getFiltered(sampleProperties, { typeFilter: 'Lot' });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Lot');
  });

  // Search term
  test('searches by address', () => {
    const result = getFiltered(sampleProperties, { searchTerm: 'mohawk' });
    expect(result).toHaveLength(1);
    expect(result[0].address).toBe('105 Mohawk St');
  });

  test('searches by city', () => {
    const result = getFiltered(sampleProperties, { searchTerm: 'chester' });
    expect(result).toHaveLength(2);
  });

  test('searches by county', () => {
    const result = getFiltered(sampleProperties, { searchTerm: 'delaware' });
    expect(result).toHaveLength(3);
  });

  test('searches by notes', () => {
    const result = getFiltered(sampleProperties, { searchTerm: 'buildable' });
    expect(result).toHaveLength(1);
    expect(result[0].notes).toBe('Buildable lot');
  });

  test('search is case-insensitive', () => {
    const result = getFiltered(sampleProperties, { searchTerm: 'CHESTER' });
    expect(result).toHaveLength(2);
  });

  // Combined filters
  test('combines stage and county filters', () => {
    const result = getFiltered(sampleProperties, { currentFilter: 'ready', countyFilter: 'Butler' });
    expect(result).toHaveLength(1);
    expect(result[0].address).toBe('105 Mohawk St');
  });

  test('combines stage and type filters', () => {
    const result = getFiltered(sampleProperties, { currentFilter: 'new', typeFilter: 'SFH' });
    expect(result).toHaveLength(1);
  });

  test('combines all filters with no results', () => {
    const result = getFiltered(sampleProperties, { currentFilter: 'sold', countyFilter: 'Butler' });
    expect(result).toHaveLength(0);
  });

  // Sorting
  test('sorts by dateAdded descending by default', () => {
    const result = getFiltered(sampleProperties);
    expect(result[0].id).toBe('6'); // most recent
    expect(result[result.length - 1].id).toBe('1'); // oldest
  });

  test('sorts by dateAdded ascending', () => {
    const result = getFiltered(sampleProperties, { sortField: 'dateAdded', sortDirection: 'asc' });
    expect(result[0].id).toBe('1');
    expect(result[result.length - 1].id).toBe('6');
  });

  test('sorts by city ascending', () => {
    const result = getFiltered(sampleProperties, { sortField: 'city', sortDirection: 'asc' });
    expect(result[0].city).toBe('Bruin');
  });

  test('sorts by asking ascending', () => {
    const result = getFiltered(sampleProperties, { sortField: 'asking', sortDirection: 'asc' });
    expect(result[0].asking).toBe(24900);
  });

  test('sorts by asking descending', () => {
    const result = getFiltered(sampleProperties, { sortField: 'asking', sortDirection: 'desc' });
    expect(result[0].asking).toBe(99900);
  });

  test('handles null sort values by pushing them to end', () => {
    const result = getFiltered(sampleProperties, { sortField: 'beds', sortDirection: 'asc' });
    // null beds should sort to end when ascending
    const lastTwo = result.slice(-2);
    lastTwo.forEach(p => expect(p.beds).toBeNull());
  });

  // Edge cases
  test('returns empty array for empty properties', () => {
    const result = getFiltered([]);
    expect(result).toHaveLength(0);
  });

  test('does not mutate original array', () => {
    const original = [...sampleProperties];
    getFiltered(sampleProperties, { sortField: 'asking', sortDirection: 'asc' });
    expect(sampleProperties).toEqual(original);
  });
});
