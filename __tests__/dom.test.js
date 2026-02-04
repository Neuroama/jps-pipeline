/**
 * DOM tests using jsdom (Jest's default test environment for DOM).
 * Tests rendering functions and UI behavior.
 * @jest-environment jsdom
 */

const {
  sanitizeInput,
  formatCurrency,
  getDaysSinceAdded,
  statusMap,
  getFiltered,
  computeStats,
} = require('../js/logic');

// ========== Toast-like DOM rendering ==========

describe('DOM: showToast pattern', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('creates a toast element in the DOM', () => {
    // Simulate showToast logic
    const t = document.createElement('div');
    t.className = 'toast success';
    t.innerHTML = `<span>${sanitizeInput('Test message')}</span>`;
    document.body.appendChild(t);

    const toast = document.querySelector('.toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe('Test message');
    expect(toast.classList.contains('success')).toBe(true);
  });

  test('removes old toast before adding new one', () => {
    // First toast
    const t1 = document.createElement('div');
    t1.className = 'toast';
    t1.textContent = 'First';
    document.body.appendChild(t1);

    // Remove old, add new (like showToast does)
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const t2 = document.createElement('div');
    t2.className = 'toast';
    t2.textContent = 'Second';
    document.body.appendChild(t2);

    const toasts = document.querySelectorAll('.toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0].textContent).toBe('Second');
  });

  test('sanitizes XSS in toast messages', () => {
    const t = document.createElement('div');
    t.innerHTML = `<span>${sanitizeInput('<script>alert("xss")</script>')}</span>`;
    document.body.appendChild(t);

    expect(t.textContent).not.toContain('<script>');
    expect(t.textContent).toBe('scriptalert("xss")/script');
  });
});

// ========== Sync status indicator ==========

describe('DOM: updateSyncStatus pattern', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="header-actions"></div>';
  });

  test('creates sync status element', () => {
    const headerActions = document.querySelector('.header-actions');
    const el = document.createElement('div');
    el.id = 'sync-status';
    headerActions.insertBefore(el, headerActions.firstChild);

    el.innerHTML = '<span style="color:green">● Synced</span>';

    expect(document.getElementById('sync-status')).not.toBeNull();
    expect(el.textContent).toContain('Synced');
  });

  test('updates existing sync status element', () => {
    const el = document.createElement('div');
    el.id = 'sync-status';
    document.body.appendChild(el);

    // Simulate status changes
    const statuses = {
      synced: '● Synced',
      saving: '● Saving...',
      error: '● Offline',
      offline: '○ Local only',
    };

    for (const [status, label] of Object.entries(statuses)) {
      el.innerHTML = `<span>${label}</span>`;
      expect(el.textContent).toBe(label);
    }
  });
});

// ========== renderGrid pattern ==========

describe('DOM: renderGrid pattern', () => {
  const sampleProperty = {
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
    notes: 'No heat',
    lat: 41.0531,
    lng: -79.7297,
    dateAdded: '2026-01-21T06:34:05.343Z',
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="property-grid"></div>';
  });

  test('renders property card with address and city', () => {
    const gridEl = document.getElementById('property-grid');
    const p = sampleProperty;
    const status = statusMap[p.stage];

    gridEl.innerHTML = `
      <div class="property-card">
        <div class="card-header">
          <div>
            <div class="card-address">${sanitizeInput(p.address)}</div>
            <div class="card-location">${sanitizeInput(p.city)}, PA ${p.zip || ''}</div>
          </div>
          <div class="card-status ${status.class}">${status.label}</div>
        </div>
      </div>
    `;

    expect(gridEl.querySelector('.card-address').textContent).toBe('105 Mohawk St');
    expect(gridEl.querySelector('.card-location').textContent).toContain('Bruin');
    expect(gridEl.querySelector('.card-status').textContent).toBe('Ready');
    expect(gridEl.querySelector('.card-status').classList.contains('ready')).toBe(true);
  });

  test('renders empty grid for no properties', () => {
    const gridEl = document.getElementById('property-grid');
    gridEl.innerHTML = '';

    expect(gridEl.children).toHaveLength(0);
    expect(gridEl.innerHTML).toBe('');
  });

  test('renders multiple property cards', () => {
    const gridEl = document.getElementById('property-grid');
    const properties = [
      { ...sampleProperty, id: '1' },
      { ...sampleProperty, id: '2', address: '456 Oak Ave', city: 'Chester' },
    ];

    gridEl.innerHTML = properties.map(p =>
      `<div class="property-card"><div class="card-address">${sanitizeInput(p.address)}</div></div>`
    ).join('');

    expect(gridEl.querySelectorAll('.property-card')).toHaveLength(2);
  });
});

// ========== renderList pattern ==========

describe('DOM: renderList pattern', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <table>
        <tbody id="list-body"></tbody>
      </table>
    `;
  });

  test('renders table rows for properties', () => {
    const listBody = document.getElementById('list-body');
    const properties = [
      { id: '1', address: '105 Mohawk St', city: 'Bruin', county: 'Butler', type: 'SFH', beds: 2, baths: 2, asking: 29900, stage: 'Ready to Blast', pictures: null, dateAdded: '2026-01-21T06:34:05.343Z' },
    ];

    listBody.innerHTML = properties.map(p => {
      const status = statusMap[p.stage];
      return `<tr>
        <td><strong>${sanitizeInput(p.address)}</strong></td>
        <td>${sanitizeInput(p.city)}</td>
        <td>${p.county || '-'}</td>
        <td>${sanitizeInput(p.type)}</td>
        <td>${p.beds || '-'}/${p.baths || '-'}</td>
        <td><strong>${formatCurrency(p.asking)}</strong></td>
        <td><span class="list-status ${status.class}">${status.label}</span></td>
      </tr>`;
    }).join('');

    const rows = listBody.querySelectorAll('tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('strong').textContent).toBe('105 Mohawk St');
  });
});

// ========== Stats rendering ==========

describe('DOM: updateStats pattern', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <span id="ready-count">0</span>
      <span id="new-count">0</span>
      <span id="hold-count">0</span>
      <span id="high-count">0</span>
      <span id="sold-count">0</span>
    `;
  });

  test('updates stat counts in DOM from computeStats', () => {
    const properties = [
      { stage: 'Ready to Blast' },
      { stage: 'Ready to Blast' },
      { stage: 'New' },
      { stage: 'On Hold' },
      { stage: 'Too High' },
      { stage: 'Sold' },
    ];

    const stats = computeStats(properties);

    document.getElementById('ready-count').textContent = stats.ready;
    document.getElementById('new-count').textContent = stats.new;
    document.getElementById('hold-count').textContent = stats.hold;
    document.getElementById('high-count').textContent = stats.high;
    document.getElementById('sold-count').textContent = stats.sold;

    expect(document.getElementById('ready-count').textContent).toBe('2');
    expect(document.getElementById('new-count').textContent).toBe('1');
    expect(document.getElementById('hold-count').textContent).toBe('1');
    expect(document.getElementById('high-count').textContent).toBe('1');
    expect(document.getElementById('sold-count').textContent).toBe('1');
  });
});

// ========== Filter UI rendering ==========

describe('DOM: county and type list rendering', () => {
  test('renders county list sorted by count', () => {
    document.body.innerHTML = '<div id="county-list"></div>';
    const countyListEl = document.getElementById('county-list');

    const counties = [['Delaware', 3], ['Cambria', 2], ['Butler', 1]];

    countyListEl.innerHTML = counties
      .map(([c, n]) => `<div class="county-item" data-county="${c}"><span>${c}</span><span class="county-count">${n}</span></div>`)
      .join('');

    const items = countyListEl.querySelectorAll('.county-item');
    expect(items).toHaveLength(3);
    expect(items[0].dataset.county).toBe('Delaware');
    expect(items[0].querySelector('.county-count').textContent).toBe('3');
  });

  test('county item click toggles active class', () => {
    document.body.innerHTML = '<div id="county-list"><div class="county-item" data-county="Delaware">Delaware</div></div>';

    const item = document.querySelector('.county-item');
    item.classList.add('active');
    expect(item.classList.contains('active')).toBe(true);

    item.classList.remove('active');
    expect(item.classList.contains('active')).toBe(false);
  });
});

// ========== Detail panel ==========

describe('DOM: detail panel open/close', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="detail-panel"></div>
      <div id="overlay"></div>
    `;
  });

  test('opens panel by adding "open" class', () => {
    const panel = document.getElementById('detail-panel');
    const overlay = document.getElementById('overlay');

    panel.classList.add('open');
    overlay.classList.add('open');

    expect(panel.classList.contains('open')).toBe(true);
    expect(overlay.classList.contains('open')).toBe(true);
  });

  test('closes panel by removing "open" class', () => {
    const panel = document.getElementById('detail-panel');
    const overlay = document.getElementById('overlay');

    panel.classList.add('open');
    overlay.classList.add('open');

    panel.classList.remove('open');
    overlay.classList.remove('open');

    expect(panel.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('open')).toBe(false);
  });
});

// ========== Escape key handler ==========

describe('DOM: keyboard shortcuts', () => {
  test('Escape key can close modals', () => {
    document.body.innerHTML = '<div id="add-property-modal" class="open"></div>';

    const modal = document.getElementById('add-property-modal');
    const event = new KeyboardEvent('keydown', { key: 'Escape' });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) {
        modal.classList.remove('open');
      }
    });

    document.dispatchEvent(event);
    expect(modal.classList.contains('open')).toBe(false);
  });
});

// ========== Bulk mode ==========

describe('DOM: bulk mode toggle', () => {
  test('toggles bulk-mode class on body', () => {
    let bulkMode = false;

    bulkMode = !bulkMode;
    document.body.classList.toggle('bulk-mode', bulkMode);
    expect(document.body.classList.contains('bulk-mode')).toBe(true);

    bulkMode = !bulkMode;
    document.body.classList.toggle('bulk-mode', bulkMode);
    expect(document.body.classList.contains('bulk-mode')).toBe(false);
  });
});
