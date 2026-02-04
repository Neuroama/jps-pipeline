/**
 * End-to-end workflow tests.
 * Tests complete user workflows using the pure logic functions
 * to simulate the full add → filter → edit → export cycle.
 */

const {
  validatePropertyData,
  generateUUID,
  normalizeProperties,
  getFiltered,
  parseBlock,
  exportCSVString,
  validateImportData,
  sanitizeInput,
  computeStats,
  checkDuplicateProperty,
} = require('../js/logic');

describe('Workflow: Add property → filter → export', () => {
  let properties;

  beforeEach(() => {
    properties = [];
  });

  test('full add-property flow', () => {
    // Step 1: User enters property data
    const formData = {
      address: '123 Main St',
      city: 'Chester',
      zip: '19013',
      beds: 3,
      baths: 2,
      sqft: 1500,
      asking: 99900,
      arv: null,
      rehab: null,
      pictures: null,
      contractLink: null,
      investorSheetLink: null,
    };

    // Step 2: Validate
    const errors = validatePropertyData(formData);
    expect(errors).toHaveLength(0);

    // Step 3: Create property object
    const now = new Date().toISOString();
    const property = {
      id: generateUUID(),
      ...formData,
      county: 'Delaware',
      type: 'SFH',
      stage: 'New',
      access: '3333 front door',
      notes: 'Gas heat',
      lat: 39.85,
      lng: -75.36,
      geoPrecision: 'exact',
      dateAdded: now,
      lastUpdated: now,
    };

    // Step 4: Add to array
    properties.push(property);
    expect(properties).toHaveLength(1);

    // Step 5: Normalize
    normalizeProperties(properties);
    expect(properties[0].arv).toBe('');
    expect(properties[0].rehab).toBe('');

    // Step 6: Filter shows it
    const filtered = getFiltered(properties, { currentFilter: 'new' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].address).toBe('123 Main St');

    // Step 7: Export contains it
    // Need to add type for CSV
    properties[0].type = 'SFH';
    const csv = exportCSVString(properties);
    expect(csv).toContain('123 Main St');
    expect(csv).toContain('Chester');
  });

  test('bulk paste → parse → save flow', () => {
    const dealText = `105 Mohawk St, Bruin, PA 16022
Butler County
2 bed 2 bath
Asking 29.9k
ARV 80k
Access: 3333 front door
https://www.dropbox.com/scl/fo/xyz
No heat, No electric

177-179 Pine St, Johnstown, PA 15902
Cambria County
Asking 24.9k
Access: Front door open
Newer sewer line`;

    // Step 1: Split into blocks and parse
    const blocks = dealText.split(/\n\s*\n/).filter(b => b.trim());
    expect(blocks).toHaveLength(2);

    const parsedDeals = blocks.map(b => parseBlock(b)).filter(d => d.address);
    expect(parsedDeals).toHaveLength(2);

    // Step 2: Verify parsed data
    expect(parsedDeals[0].address).toBe('105 Mohawk St');
    expect(parsedDeals[0].asking).toBe(29900);
    expect(parsedDeals[0].arv).toBe(80000);
    expect(parsedDeals[1].address).toBe('177-179 Pine St');
    expect(parsedDeals[1].asking).toBe(24900);

    // Step 3: Save parsed deals as properties
    const now = new Date().toISOString();
    for (const d of parsedDeals) {
      properties.push({
        id: generateUUID(),
        address: d.address,
        city: d.city,
        zip: d.zip || null,
        county: d.county || null,
        type: 'Unknown',
        beds: d.beds,
        baths: d.baths,
        sqft: null,
        asking: d.asking,
        arv: d.arv,
        rehab: null,
        stage: 'New',
        access: d.access,
        pictures: d.pictures,
        contractLink: null,
        investorSheetLink: null,
        notes: d.notes || null,
        lat: null,
        lng: null,
        geoPrecision: 'none',
        dateAdded: now,
        lastUpdated: now,
      });
    }

    expect(properties).toHaveLength(2);

    // Step 4: Stats reflect new properties
    const stats = computeStats(properties);
    expect(stats.new).toBe(2);
    expect(stats.total).toBe(2);
  });
});

describe('Workflow: Import → deduplicate → filter → export roundtrip', () => {
  test('import/export roundtrip preserves data', () => {
    // Step 1: Create import data
    const importData = [
      { id: '1', address: '105 Mohawk St', city: 'Bruin', county: 'Butler', type: 'SFH', beds: 2, baths: 2, sqft: null, asking: 29900, arv: '', rehab: '', stage: 'Ready to Blast', access: '3333', pictures: null, contractLink: null, investorSheetLink: null, notes: 'No heat', lat: 41.05, lng: -79.73, geoPrecision: 'exact', dateAdded: '2026-01-21T06:34:05.343Z', lastUpdated: '2026-01-21T06:34:05.343Z' },
      { id: '2', address: '456 Oak Ave', city: 'Chester', county: 'Delaware', type: 'SFH', beds: 3, baths: 1, sqft: null, asking: 99900, arv: '', rehab: '', stage: 'New', access: null, pictures: null, contractLink: null, investorSheetLink: null, notes: '', lat: 39.85, lng: -75.36, geoPrecision: 'exact', dateAdded: '2026-01-22T06:34:05.343Z', lastUpdated: '2026-01-22T06:34:05.343Z' },
    ];

    // Step 2: Validate import
    const validation = validateImportData(importData);
    expect(validation.valid).toBe(true);
    expect(validation.duplicatesRemoved).toBe(0);

    // Step 3: Properties are loaded
    const properties = validation.properties;
    normalizeProperties(properties);

    // Step 4: Filter by stage
    const ready = getFiltered(properties, { currentFilter: 'ready' });
    expect(ready).toHaveLength(1);
    expect(ready[0].address).toBe('105 Mohawk St');

    // Step 5: Export to CSV
    const csv = exportCSVString(properties);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 data rows
    expect(lines[0]).toContain('Address');
    expect(lines[1]).toContain('105 Mohawk St');
    expect(lines[2]).toContain('456 Oak Ave');
  });

  test('import with duplicates removes them', () => {
    const data = [
      { id: '1', address: '123 Main', city: 'Chester' },
      { id: '1', address: '123 Main (dup)', city: 'Chester' },
      { id: '2', address: '456 Oak', city: 'Bruin' },
    ];

    const result = validateImportData(data);
    expect(result.valid).toBe(true);
    expect(result.properties).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(1);
    // Keeps first occurrence
    expect(result.properties[0].address).toBe('123 Main');
  });
});

describe('Workflow: Edit property → status change → filter update', () => {
  test('changing status updates filter results', () => {
    const properties = [
      { id: '1', address: '105 Mohawk St', city: 'Bruin', county: 'Butler', type: 'SFH', stage: 'New', asking: 29900, beds: 2, baths: 2, notes: '', dateAdded: '2026-01-21T06:34:05.343Z' },
      { id: '2', address: '456 Oak Ave', city: 'Chester', county: 'Delaware', type: 'SFH', stage: 'New', asking: 99900, beds: 3, baths: 1, notes: '', dateAdded: '2026-01-22T06:34:05.343Z' },
    ];

    // Initially both are "New"
    let filtered = getFiltered(properties, { currentFilter: 'new' });
    expect(filtered).toHaveLength(2);

    let ready = getFiltered(properties, { currentFilter: 'ready' });
    expect(ready).toHaveLength(0);

    // Change first property to "Ready to Blast"
    properties[0].stage = 'Ready to Blast';
    properties[0].lastUpdated = new Date().toISOString();

    // Filters update
    filtered = getFiltered(properties, { currentFilter: 'new' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].address).toBe('456 Oak Ave');

    ready = getFiltered(properties, { currentFilter: 'ready' });
    expect(ready).toHaveLength(1);
    expect(ready[0].address).toBe('105 Mohawk St');

    // Stats update
    const stats = computeStats(properties);
    expect(stats.ready).toBe(1);
    expect(stats.new).toBe(1);
  });
});

describe('Workflow: Duplicate detection', () => {
  test('detects duplicate before adding', () => {
    const properties = [
      { address: '105 Mohawk St', city: 'Bruin' },
      { address: '456 Oak Ave', city: 'Chester' },
    ];

    // User tries to add same address
    const dup = checkDuplicateProperty(properties, '105 Mohawk St', 'Bruin');
    expect(dup).not.toBeNull();
    expect(dup.address).toBe('105 Mohawk St');

    // User enters a new address - no duplicate
    const noDup = checkDuplicateProperty(properties, '789 Elm St', 'Darby');
    expect(noDup).toBeNull();
  });
});

describe('Workflow: Validation prevents bad data', () => {
  test('rejects property with invalid data', () => {
    const badData = {
      address: '',
      city: '',
      beds: -5,
      baths: 100,
      sqft: -1,
      asking: -100,
      arv: null,
      rehab: null,
      pictures: 'not-a-url',
      contractLink: null,
      investorSheetLink: null,
      zip: 'ABC',
    };

    const errors = validatePropertyData(badData);
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(errors).toContain('Address is required');
    expect(errors).toContain('City is required');
  });

  test('sanitizes user input before saving', () => {
    const malicious = '<script>alert("xss")</script>';
    const sanitized = sanitizeInput(malicious);
    expect(sanitized).not.toContain('<');
    expect(sanitized).not.toContain('>');
  });
});
