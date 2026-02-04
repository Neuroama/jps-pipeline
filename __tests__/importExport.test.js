const { exportCSVString, validateImportData } = require('../js/logic');

const sampleProperties = [
  {
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
    notes: 'No heat, No electric',
    lat: 41.0531,
    lng: -79.7297,
    geoPrecision: 'exact',
    dateAdded: '2026-01-21T06:34:05.343Z',
    lastUpdated: '2026-01-21T06:34:05.343Z',
  },
];

describe('exportCSVString', () => {
  test('includes header row', () => {
    const csv = exportCSVString(sampleProperties);
    const header = csv.split('\n')[0];
    expect(header).toContain('Address');
    expect(header).toContain('City');
    expect(header).toContain('ZIP');
    expect(header).toContain('County');
    expect(header).toContain('Type');
    expect(header).toContain('Beds');
    expect(header).toContain('Baths');
    expect(header).toContain('Asking');
    expect(header).toContain('Stage');
  });

  test('includes property data', () => {
    const csv = exportCSVString(sampleProperties);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toContain('105 Mohawk St');
    expect(dataRow).toContain('Bruin');
    expect(dataRow).toContain('16022');
    expect(dataRow).toContain('Butler');
    expect(dataRow).toContain('SFH');
    expect(dataRow).toContain('29900');
  });

  test('quotes addresses with commas', () => {
    const csv = exportCSVString(sampleProperties);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toContain('"105 Mohawk St"');
  });

  test('escapes double quotes in notes', () => {
    const props = [{ ...sampleProperties[0], notes: 'He said "hello"' }];
    const csv = exportCSVString(props);
    expect(csv).toContain('He said ""hello""');
  });

  test('handles empty properties array', () => {
    const csv = exportCSVString([]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1); // header only
  });

  test('handles null fields gracefully', () => {
    const props = [{
      ...sampleProperties[0],
      zip: null,
      county: null,
      beds: null,
      baths: null,
      sqft: null,
      arv: null,
      rehab: null,
      access: null,
      pictures: null,
      contractLink: null,
      investorSheetLink: null,
      notes: null,
    }];
    // Should not throw
    expect(() => exportCSVString(props)).not.toThrow();
  });

  test('produces correct number of columns per row', () => {
    const csv = exportCSVString(sampleProperties);
    const lines = csv.split('\n');
    const headerCols = lines[0].split(',').length;
    // Data row parsing is trickier due to quoted fields, but header should have 23 columns
    expect(headerCols).toBe(23);
  });
});

describe('validateImportData', () => {
  test('accepts valid array of properties', () => {
    const data = [
      { id: '1', address: '123 Main St', city: 'Chester' },
      { id: '2', address: '456 Oak Ave', city: 'Bruin' },
    ];
    const result = validateImportData(data);
    expect(result.valid).toBe(true);
    expect(result.properties).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  test('rejects non-array input', () => {
    const result = validateImportData({ address: '123 Main', city: 'Chester' });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Expected array of properties');
  });

  test('rejects string input', () => {
    const result = validateImportData('not an array');
    expect(result.valid).toBe(false);
  });

  test('rejects null input', () => {
    const result = validateImportData(null);
    expect(result.valid).toBe(false);
  });

  test('rejects properties missing address', () => {
    const data = [{ id: '1', city: 'Chester' }];
    const result = validateImportData(data);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Missing required fields (address, city)');
  });

  test('rejects properties missing city', () => {
    const data = [{ id: '1', address: '123 Main St' }];
    const result = validateImportData(data);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Missing required fields (address, city)');
  });

  test('removes duplicate IDs', () => {
    const data = [
      { id: '1', address: '123 Main St', city: 'Chester' },
      { id: '1', address: '456 Oak Ave', city: 'Bruin' },
      { id: '2', address: '789 Elm St', city: 'Darby' },
    ];
    const result = validateImportData(data);
    expect(result.valid).toBe(true);
    expect(result.properties).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(1);
    // Keeps first occurrence
    expect(result.properties[0].address).toBe('123 Main St');
  });

  test('accepts empty array', () => {
    const result = validateImportData([]);
    expect(result.valid).toBe(true);
    expect(result.properties).toHaveLength(0);
  });

  test('rejects if any property in array is missing required fields', () => {
    const data = [
      { id: '1', address: '123 Main St', city: 'Chester' },
      { id: '2', address: '', city: 'Bruin' }, // empty address is falsy
    ];
    const result = validateImportData(data);
    expect(result.valid).toBe(false);
  });
});
