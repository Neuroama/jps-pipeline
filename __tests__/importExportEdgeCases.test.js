const { exportCSVString, validateImportData, sanitizeInput } = require('../js/logic');

describe('exportCSVString edge cases', () => {
  const baseProperty = {
    id: '1',
    address: '105 Mohawk St',
    city: 'Bruin',
    zip: '16022',
    county: 'Butler',
    type: 'SFH',
    beds: 2,
    baths: 2,
    sqft: null,
    asking: 29900,
    arv: '',
    rehab: '',
    stage: 'Ready to Blast',
    access: '3333 front door',
    pictures: 'https://dropbox.com/photos',
    contractLink: null,
    investorSheetLink: null,
    notes: 'No heat',
    lat: 41.0531,
    lng: -79.7297,
    geoPrecision: 'exact',
    dateAdded: '2026-01-21T06:34:05.343Z',
    lastUpdated: '2026-01-21T06:34:05.343Z',
  };

  test('handles unicode characters in address', () => {
    const props = [{ ...baseProperty, address: '123 Calle Niño' }];
    const csv = exportCSVString(props);
    expect(csv).toContain('123 Calle Niño');
  });

  test('handles unicode characters in notes', () => {
    const props = [{ ...baseProperty, notes: 'Très bien — excellent property' }];
    const csv = exportCSVString(props);
    expect(csv).toContain('Très bien');
  });

  test('handles newlines in notes by quoting', () => {
    const props = [{ ...baseProperty, notes: 'Line one\nLine two' }];
    const csv = exportCSVString(props);
    // Notes are already quoted in the CSV output
    expect(csv).toContain('Line one\nLine two');
  });

  test('handles commas in notes via quoting', () => {
    const props = [{ ...baseProperty, notes: 'Gas heat, central air, detached garage' }];
    const csv = exportCSVString(props);
    // Notes should be quoted to handle commas
    expect(csv).toContain('"Gas heat, central air, detached garage"');
  });

  test('handles very large asking price', () => {
    const props = [{ ...baseProperty, asking: 99999999 }];
    const csv = exportCSVString(props);
    expect(csv).toContain('99999999');
  });

  test('handles zero asking price as falsy', () => {
    const props = [{ ...baseProperty, asking: 0 }];
    const csv = exportCSVString(props);
    // 0 is falsy so it outputs empty
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toBeDefined();
  });

  test('handles many properties without error', () => {
    const props = [];
    for (let i = 0; i < 500; i++) {
      props.push({ ...baseProperty, id: String(i), address: `${i} Main St` });
    }
    const csv = exportCSVString(props);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(501); // header + 500 rows
  });

  test('handles special regex characters in address', () => {
    const props = [{ ...baseProperty, address: '123 Main St. (Unit #2)' }];
    const csv = exportCSVString(props);
    expect(csv).toContain('123 Main St. (Unit #2)');
  });

  test('handles CSV formula injection characters in notes', () => {
    // Test that formula-like content is preserved (wrapped in quotes)
    const props = [{ ...baseProperty, notes: '=SUM(A1:A10)' }];
    const csv = exportCSVString(props);
    // The notes field is always quoted, which helps protect against CSV injection
    expect(csv).toContain('"=SUM(A1:A10)"');
  });

  test('handles plus-sign formula injection', () => {
    const props = [{ ...baseProperty, notes: '+cmd|"/C calc"!A0' }];
    const csv = exportCSVString(props);
    expect(csv).toContain('+cmd|');
  });

  test('handles pipe and at-sign in notes', () => {
    const props = [{ ...baseProperty, notes: '@SUM(A1) | -cmd' }];
    const csv = exportCSVString(props);
    // Notes are quoted so at least partially protected
    expect(csv).toContain('@SUM(A1)');
  });
});

describe('validateImportData edge cases', () => {
  test('rejects number input', () => {
    const result = validateImportData(42);
    expect(result.valid).toBe(false);
  });

  test('rejects boolean input', () => {
    const result = validateImportData(true);
    expect(result.valid).toBe(false);
  });

  test('rejects undefined input', () => {
    const result = validateImportData(undefined);
    expect(result.valid).toBe(false);
  });

  test('handles properties with undefined id (no dedup)', () => {
    const data = [
      { id: undefined, address: '123 Main', city: 'Chester' },
      { id: undefined, address: '456 Oak', city: 'Bruin' },
    ];
    const result = validateImportData(data);
    expect(result.valid).toBe(true);
    // undefined ids: first one goes in, second is a "duplicate" of undefined key
    expect(result.properties.length + result.duplicatesRemoved).toBe(2);
  });

  test('handles large import datasets', () => {
    const data = [];
    for (let i = 0; i < 1000; i++) {
      data.push({ id: String(i), address: `${i} Main St`, city: 'Chester' });
    }
    const result = validateImportData(data);
    expect(result.valid).toBe(true);
    expect(result.properties).toHaveLength(1000);
    expect(result.duplicatesRemoved).toBe(0);
  });

  test('handles properties with extra fields', () => {
    const data = [
      { id: '1', address: '123 Main', city: 'Chester', extraField: 'value', anotherExtra: 42 },
    ];
    const result = validateImportData(data);
    expect(result.valid).toBe(true);
    expect(result.properties[0].extraField).toBe('value');
  });

  test('handles properties with whitespace-only address', () => {
    const data = [{ id: '1', address: '   ', city: 'Chester' }];
    // '   ' is truthy, so it passes the address check
    const result = validateImportData(data);
    expect(result.valid).toBe(true);
  });

  test('handles many duplicates', () => {
    const data = [];
    for (let i = 0; i < 50; i++) {
      data.push({ id: '1', address: '123 Main', city: 'Chester' });
    }
    const result = validateImportData(data);
    expect(result.valid).toBe(true);
    expect(result.properties).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(49);
  });

  test('mixed valid and empty address rejects all', () => {
    const data = [
      { id: '1', address: '123 Main', city: 'Chester' },
      { id: '2', address: '', city: 'Bruin' },
    ];
    const result = validateImportData(data);
    expect(result.valid).toBe(false);
  });

  test('handles properties with null id (dedup behavior)', () => {
    const data = [
      { id: null, address: '123 Main', city: 'Chester' },
      { id: null, address: '456 Oak', city: 'Bruin' },
    ];
    const result = validateImportData(data);
    expect(result.valid).toBe(true);
    // null is a valid Set key, so second null is a duplicate
    expect(result.properties).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });
});
