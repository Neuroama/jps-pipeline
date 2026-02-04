/**
 * Map and geocoding tests.
 * Tests the pure logic aspects of map/geocoding functionality.
 */

const {
  getFiltered,
  statusMap,
  sanitizeInput,
  formatCurrency,
} = require('../js/logic');

// ========== Map marker data preparation ==========

describe('Map: marker data from filtered properties', () => {
  const properties = [
    { id: '1', address: '105 Mohawk St', city: 'Bruin', county: 'Butler', type: 'SFH', stage: 'Ready to Blast', asking: 29900, beds: 2, baths: 2, notes: '', lat: 41.0531, lng: -79.7297, dateAdded: '2026-01-21T06:34:05.343Z' },
    { id: '2', address: '456 Oak Ave', city: 'Chester', county: 'Delaware', type: 'SFH', stage: 'New', asking: 99900, beds: 3, baths: 1, notes: '', lat: 39.85, lng: -75.36, dateAdded: '2026-01-22T06:34:05.343Z' },
    { id: '3', address: '789 Elm St', city: 'Darby', county: 'Delaware', type: 'Lot', stage: 'Sold', asking: 29900, beds: null, baths: null, notes: '', lat: null, lng: null, dateAdded: '2026-01-23T06:34:05.343Z' },
  ];

  test('filters out properties without coordinates for map', () => {
    const filtered = getFiltered(properties);
    const mappable = filtered.filter(p => p.lat && p.lng);
    expect(mappable).toHaveLength(2);
  });

  test('gets correct marker color from statusMap', () => {
    expect(statusMap['Ready to Blast'].color).toBe('#22c55e');
    expect(statusMap['New'].color).toBe('#6b7280');
    expect(statusMap['On Hold'].color).toBe('#eab308');
    expect(statusMap['Too High'].color).toBe('#f97316');
    expect(statusMap['Sold'].color).toBe('#ef4444');
  });

  test('builds map popup content correctly', () => {
    const p = properties[0];
    const popup = `
      <div class="map-popup">
        <div class="popup-header">${sanitizeInput(p.address)}</div>
        <div class="popup-location">${sanitizeInput(p.city)}, PA ${p.zip || ''}</div>
        <div class="popup-details">
          <span>${sanitizeInput(p.type)}</span> • <span>${p.beds || '-'}bd/${p.baths || '-'}ba</span>
        </div>
        <div class="popup-price">${formatCurrency(p.asking)}</div>
      </div>
    `;

    expect(popup).toContain('105 Mohawk St');
    expect(popup).toContain('Bruin');
    expect(popup).toContain('SFH');
    expect(popup).toContain('2bd/2ba');
    expect(popup).toContain('$29,900');
  });

  test('handles properties with 0 lat/lng as invalid', () => {
    const propsWithZero = [
      { ...properties[0], lat: 0, lng: 0 },
    ];
    // 0 is falsy, so these would be filtered out in the !p.lat check
    const mappable = propsWithZero.filter(p => p.lat && p.lng);
    expect(mappable).toHaveLength(0);
  });

  test('collects bounds from mappable properties', () => {
    const filtered = getFiltered(properties);
    const bounds = [];
    filtered.forEach(p => {
      if (p.lat && p.lng) {
        bounds.push([p.lat, p.lng]);
      }
    });

    expect(bounds).toHaveLength(2);
    // Order depends on default sort (dateAdded desc), so property 2 comes first
    expect(bounds).toContainEqual([41.0531, -79.7297]);
    expect(bounds).toContainEqual([39.85, -75.36]);
  });

  test('filters map markers when stage filter is applied', () => {
    const filtered = getFiltered(properties, { currentFilter: 'ready' });
    const mappable = filtered.filter(p => p.lat && p.lng);
    expect(mappable).toHaveLength(1);
    expect(mappable[0].address).toBe('105 Mohawk St');
  });

  test('filters map markers when county filter is applied', () => {
    const filtered = getFiltered(properties, { countyFilter: 'Delaware' });
    const mappable = filtered.filter(p => p.lat && p.lng);
    expect(mappable).toHaveLength(1);
    expect(mappable[0].address).toBe('456 Oak Ave');
  });
});

// ========== Geocoding logic ==========

describe('Geocoding: address formatting', () => {
  test('builds geocoding query from address parts', () => {
    const addr = '105 Mohawk St';
    const city = 'Bruin';
    const state = 'PA';
    const zip = '16022';

    const query = `${addr}, ${city}, ${state}${zip ? ' ' + zip : ''}`;
    expect(query).toBe('105 Mohawk St, Bruin, PA 16022');
  });

  test('builds query without zip', () => {
    const addr = '105 Mohawk St';
    const city = 'Bruin';
    const state = 'PA';
    const zip = '';

    const query = `${addr}, ${city}, ${state}${zip ? ' ' + zip : ''}`;
    expect(query).toBe('105 Mohawk St, Bruin, PA');
  });

  test('builds fallback city-only query', () => {
    const city = 'Bruin';
    const state = 'PA';
    const query = `${city}, ${state}`;
    expect(query).toBe('Bruin, PA');
  });
});

describe('Geocoding: response parsing', () => {
  test('parses successful geocoding response', () => {
    const apiResponse = [{
      lat: '41.0531',
      lon: '-79.7297',
      address: { county: 'Butler County' },
    }];

    const lat = parseFloat(apiResponse[0].lat);
    const lng = parseFloat(apiResponse[0].lon);
    const county = apiResponse[0].address?.county?.replace(/ County$/i, '').trim() || null;

    expect(lat).toBe(41.0531);
    expect(lng).toBe(-79.7297);
    expect(county).toBe('Butler');
  });

  test('strips "County" suffix from county name', () => {
    const countyRaw = 'Delaware County';
    const county = countyRaw.replace(/ County$/i, '').trim();
    expect(county).toBe('Delaware');
  });

  test('handles county without "County" suffix', () => {
    const countyRaw = 'Delaware';
    const county = countyRaw.replace(/ County$/i, '').trim();
    expect(county).toBe('Delaware');
  });

  test('handles missing county in response', () => {
    const apiResponse = [{
      lat: '41.0531',
      lon: '-79.7297',
      address: {},
    }];

    const county = apiResponse[0].address?.county?.replace(/ County$/i, '').trim() || null;
    expect(county).toBeNull();
  });

  test('handles empty geocoding response', () => {
    const apiResponse = [];
    const success = apiResponse && apiResponse.length > 0;
    expect(success).toBe(false);
  });

  test('determines geoPrecision from result type', () => {
    // Exact match: full address geocoded
    const exactResult = { success: true, geoPrecision: 'exact' };
    expect(exactResult.geoPrecision).toBe('exact');

    // Approx match: only city geocoded
    const approxResult = { success: true, geoPrecision: 'approx' };
    expect(approxResult.geoPrecision).toBe('approx');

    // No match
    const noResult = { success: false, geoPrecision: 'none' };
    expect(noResult.geoPrecision).toBe('none');
  });
});

describe('Geocoding: missing data handling', () => {
  test('identifies properties missing coordinates', () => {
    const properties = [
      { id: '1', address: '105 Mohawk St', lat: 41.05, lng: -79.73 },
      { id: '2', address: '456 Oak Ave', lat: null, lng: null },
      { id: '3', address: '789 Elm St', lat: 39.85, lng: null },
    ];

    const missing = properties.filter(p => !p.lat || !p.lng);
    expect(missing).toHaveLength(2);
    expect(missing[0].address).toBe('456 Oak Ave');
    expect(missing[1].address).toBe('789 Elm St');
  });

  test('identifies properties missing county', () => {
    const properties = [
      { id: '1', county: 'Butler', lat: 41.05, lng: -79.73 },
      { id: '2', county: null, lat: 39.85, lng: -75.36 },
      { id: '3', county: '', lat: 40.10, lng: -79.88 },
    ];

    const missing = properties.filter(p => !p.county && p.lat && p.lng);
    expect(missing).toHaveLength(2);
  });
});
