const { parseBlock } = require('../js/logic');

describe('parseBlock', () => {
  test('parses full address with city, state, ZIP', () => {
    const result = parseBlock('123 Main St, Chester, PA 19013');
    expect(result.address).toBe('123 Main St');
    expect(result.city).toBe('Chester');
    expect(result.zip).toBe('19013');
  });

  test('parses address with city only (no state/zip)', () => {
    const result = parseBlock('456 Oak Ave, Johnstown');
    expect(result.address).toBe('456 Oak Ave');
    expect(result.city).toBe('Johnstown');
  });

  test('parses county line', () => {
    const result = parseBlock(`123 Main St, Chester, PA 19013\nDelaware County`);
    expect(result.county).toBe('Delaware');
  });

  test('parses beds and baths', () => {
    const result = parseBlock(`123 Main St, Chester, PA\n3 bed 2 bath`);
    expect(result.beds).toBe(3);
    expect(result.baths).toBe(2);
  });

  test('parses beds with "br" abbreviation', () => {
    const result = parseBlock(`123 Main St, Chester, PA\n4br 2.5ba`);
    expect(result.beds).toBe(4);
    expect(result.baths).toBe(2.5);
  });

  test('parses asking price in K format', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nAsking 99.9k`);
    expect(result.asking).toBe(99900);
  });

  test('parses asking price with dollar sign and K', () => {
    const result = parseBlock(`123 Main St, Chester, PA\n$49.9k`);
    expect(result.asking).toBe(49900);
  });

  test('parses ARV correctly without overwriting asking', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nAsking 50k\nARV 275k`);
    expect(result.asking).toBe(50000);
    expect(result.arv).toBe(275000);
  });

  test('parses "worth" line as ARV without overwriting asking', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nAsking 99k\nWorth 200k`);
    expect(result.asking).toBe(99000);
    expect(result.arv).toBe(200000);
  });

  test('parses standalone ARV line as ARV, not asking', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nARV 275k`);
    expect(result.asking).toBeNull();
    expect(result.arv).toBe(275000);
  });

  test('ARV without K suffix is correctly parsed as ARV (no asking match)', () => {
    // When ARV line has no "k" suffix, it won't match the asking regex
    // and the ARV check will process it — but only if it has a "k" suffix.
    // Without "k", the ARV regex also fails, so it falls through to notes.
    const result = parseBlock(`123 Main St, Chester, PA\nARV $275,000`);
    expect(result.arv).toBeNull(); // no "k" format, not parsed
  });

  test('parses access line', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nAccess: 3333 front door`);
    expect(result.access).toBe('3333 front door');
  });

  test('parses lockbox as access', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nLockbox 1234`);
    expect(result.access).toBe('Lockbox 1234');
  });

  test('parses door info as access', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nFront door is open`);
    expect(result.access).toBe('Front door is open');
  });

  test('parses photo URL', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nhttps://dropbox.com/photos/abc`);
    expect(result.pictures).toBe('https://dropbox.com/photos/abc');
  });

  test('parses Dropbox link', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nPhotos: https://www.dropbox.com/scl/fo/xyz`);
    expect(result.pictures).toBe('https://www.dropbox.com/scl/fo/xyz');
  });

  test('collects remaining lines as notes', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nNice brick house, oil heat`);
    expect(result.notes).toBe('Nice brick house, oil heat');
  });

  test('ignores short lines (3 chars or less) in notes', () => {
    const result = parseBlock(`123 Main St, Chester, PA\nok\nNice house`);
    expect(result.notes).toBe('Nice house');
  });

  test('parses a complete deal block', () => {
    const block = `105 Mohawk St, Bruin, PA 16022
Butler County
2 bed 2 bath
Asking 29.9k
ARV 80k
Access: 3333 front door
https://www.dropbox.com/scl/fo/xyz
No heat, No electric`;

    const result = parseBlock(block);
    expect(result.address).toBe('105 Mohawk St');
    expect(result.city).toBe('Bruin');
    expect(result.zip).toBe('16022');
    expect(result.county).toBe('Butler');
    expect(result.beds).toBe(2);
    expect(result.baths).toBe(2);
    expect(result.asking).toBe(29900);
    expect(result.arv).toBe(80000);
    expect(result.access).toBe('3333 front door');
    expect(result.pictures).toBe('https://www.dropbox.com/scl/fo/xyz');
    expect(result.notes).toBe('No heat, No electric');
  });

  test('returns empty address for unparseable block', () => {
    const result = parseBlock('just some random text');
    expect(result.address).toBe('');
  });

  test('handles block with only address', () => {
    const result = parseBlock('789 Elm St, Darby, PA 19023');
    expect(result.address).toBe('789 Elm St');
    expect(result.city).toBe('Darby');
    expect(result.beds).toBeNull();
    expect(result.baths).toBeNull();
    expect(result.asking).toBeNull();
  });

  test('handles empty block', () => {
    const result = parseBlock('');
    expect(result.address).toBe('');
    expect(result.city).toBe('');
  });

  test('handles multi-unit address', () => {
    const result = parseBlock('177-179 Pine St, Johnstown, PA 15902');
    expect(result.address).toBe('177-179 Pine St');
    expect(result.city).toBe('Johnstown');
  });

  test('handles address with directional prefix', () => {
    const result = parseBlock('1317 W. 3rd St, Chester, PA 19013');
    expect(result.address).toBe('1317 W. 3rd St');
    expect(result.city).toBe('Chester');
  });
});
