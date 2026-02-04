const { validatePropertyData, isValidURL, sanitizeInput } = require('../js/logic');

describe('validatePropertyData', () => {
  const validData = {
    address: '123 Main St',
    city: 'Chester',
    beds: 3,
    baths: 2,
    sqft: 1500,
    asking: 99900,
    arv: null,
    rehab: null,
    pictures: null,
    contractLink: null,
    investorSheetLink: null,
    zip: '19013',
  };

  test('returns no errors for valid data', () => {
    expect(validatePropertyData(validData)).toEqual([]);
  });

  // Required fields
  test('requires address', () => {
    const errors = validatePropertyData({ ...validData, address: '' });
    expect(errors).toContain('Address is required');
  });

  test('requires city', () => {
    const errors = validatePropertyData({ ...validData, city: '' });
    expect(errors).toContain('City is required');
  });

  test('rejects whitespace-only address', () => {
    const errors = validatePropertyData({ ...validData, address: '   ' });
    expect(errors).toContain('Address is required');
  });

  test('rejects null address', () => {
    const errors = validatePropertyData({ ...validData, address: null });
    expect(errors).toContain('Address is required');
  });

  test('rejects undefined city', () => {
    const errors = validatePropertyData({ ...validData, city: undefined });
    expect(errors).toContain('City is required');
  });

  // Numeric bounds
  test('rejects negative beds', () => {
    const errors = validatePropertyData({ ...validData, beds: -1 });
    expect(errors).toContain('Beds must be between 0 and 50');
  });

  test('rejects beds over 50', () => {
    const errors = validatePropertyData({ ...validData, beds: 51 });
    expect(errors).toContain('Beds must be between 0 and 50');
  });

  test('accepts beds at boundary 0', () => {
    const errors = validatePropertyData({ ...validData, beds: 0 });
    expect(errors).toEqual([]);
  });

  test('accepts beds at boundary 50', () => {
    const errors = validatePropertyData({ ...validData, beds: 50 });
    expect(errors).toEqual([]);
  });

  test('allows null beds', () => {
    const errors = validatePropertyData({ ...validData, beds: null });
    expect(errors).toEqual([]);
  });

  test('rejects negative baths', () => {
    const errors = validatePropertyData({ ...validData, baths: -1 });
    expect(errors).toContain('Baths must be between 0 and 50');
  });

  test('rejects sqft over 1,000,000', () => {
    const errors = validatePropertyData({ ...validData, sqft: 1000001 });
    expect(errors).toContain('Square footage must be between 0 and 1,000,000');
  });

  test('rejects negative asking price', () => {
    const errors = validatePropertyData({ ...validData, asking: -100 });
    expect(errors).toContain('Asking price must be between $0 and $100,000,000');
  });

  test('rejects asking price over $100M', () => {
    const errors = validatePropertyData({ ...validData, asking: 100000001 });
    expect(errors).toContain('Asking price must be between $0 and $100,000,000');
  });

  test('rejects negative ARV', () => {
    const errors = validatePropertyData({ ...validData, arv: -1 });
    expect(errors).toContain('ARV must be between $0 and $100,000,000');
  });

  test('rejects negative rehab', () => {
    const errors = validatePropertyData({ ...validData, rehab: -1 });
    expect(errors).toContain('Rehab cost must be between $0 and $100,000,000');
  });

  // URL validation
  test('rejects invalid pictures URL', () => {
    const errors = validatePropertyData({ ...validData, pictures: 'not-a-url' });
    expect(errors).toContain('Pictures link must be a valid URL');
  });

  test('accepts valid pictures URL', () => {
    const errors = validatePropertyData({ ...validData, pictures: 'https://dropbox.com/photos' });
    expect(errors).toEqual([]);
  });

  test('rejects invalid contractLink URL', () => {
    const errors = validatePropertyData({ ...validData, contractLink: 'bad-url' });
    expect(errors).toContain('Contract link must be a valid URL');
  });

  test('rejects invalid investorSheetLink URL', () => {
    const errors = validatePropertyData({ ...validData, investorSheetLink: 'bad' });
    expect(errors).toContain('Investor sheet link must be a valid URL');
  });

  // ZIP validation
  test('accepts valid 5-digit ZIP', () => {
    const errors = validatePropertyData({ ...validData, zip: '19013' });
    expect(errors).toEqual([]);
  });

  test('accepts valid ZIP+4', () => {
    const errors = validatePropertyData({ ...validData, zip: '19013-1234' });
    expect(errors).toEqual([]);
  });

  test('rejects invalid ZIP', () => {
    const errors = validatePropertyData({ ...validData, zip: '123' });
    expect(errors).toContain('ZIP code must be 5 digits (optional 4-digit extension)');
  });

  test('rejects ZIP with letters', () => {
    const errors = validatePropertyData({ ...validData, zip: 'ABCDE' });
    expect(errors).toContain('ZIP code must be 5 digits (optional 4-digit extension)');
  });

  test('allows null/empty ZIP', () => {
    expect(validatePropertyData({ ...validData, zip: null })).toEqual([]);
    expect(validatePropertyData({ ...validData, zip: '' })).toEqual([]);
  });

  // Multiple errors
  test('returns multiple errors at once', () => {
    const errors = validatePropertyData({
      address: '',
      city: '',
      beds: -1,
      baths: null,
      sqft: null,
      asking: null,
      arv: null,
      rehab: null,
      pictures: null,
      contractLink: null,
      investorSheetLink: null,
      zip: null,
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors).toContain('Address is required');
    expect(errors).toContain('City is required');
    expect(errors).toContain('Beds must be between 0 and 50');
  });
});

describe('isValidURL', () => {
  test('accepts https URLs', () => {
    expect(isValidURL('https://example.com')).toBe(true);
  });

  test('accepts http URLs', () => {
    expect(isValidURL('http://example.com')).toBe(true);
  });

  test('accepts URLs with paths', () => {
    expect(isValidURL('https://dropbox.com/scl/fo/abc123')).toBe(true);
  });

  test('rejects plain strings', () => {
    expect(isValidURL('not a url')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidURL('')).toBe(false);
  });

  test('rejects strings without protocol', () => {
    expect(isValidURL('example.com')).toBe(false);
  });
});

describe('sanitizeInput', () => {
  test('removes < and > characters', () => {
    expect(sanitizeInput('<script>alert("xss")</script>')).toBe('scriptalert("xss")/script');
  });

  test('trims whitespace', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  test('returns non-string values unchanged', () => {
    expect(sanitizeInput(42)).toBe(42);
    expect(sanitizeInput(null)).toBe(null);
    expect(sanitizeInput(undefined)).toBe(undefined);
  });

  test('handles empty string', () => {
    expect(sanitizeInput('')).toBe('');
  });

  test('preserves normal text', () => {
    expect(sanitizeInput('123 Main St, Chester PA')).toBe('123 Main St, Chester PA');
  });

  test('removes nested angle brackets', () => {
    expect(sanitizeInput('a<b>c<d>e')).toBe('abcde');
  });
});
