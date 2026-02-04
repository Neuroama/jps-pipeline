// ========== PURE LOGIC FUNCTIONS (testable, no DOM dependencies) ==========
// These functions are extracted from app.js so they can be unit tested.
// app.js continues to define them inline for browser use; this file
// re-exports them for Node/Jest.

function validatePropertyData(data) {
    const errors = [];

    if (!data.address || data.address.trim().length === 0) {
        errors.push('Address is required');
    }
    if (!data.city || data.city.trim().length === 0) {
        errors.push('City is required');
    }

    if (data.beds !== null && (data.beds < 0 || data.beds > 50)) {
        errors.push('Beds must be between 0 and 50');
    }
    if (data.baths !== null && (data.baths < 0 || data.baths > 50)) {
        errors.push('Baths must be between 0 and 50');
    }
    if (data.sqft !== null && (data.sqft < 0 || data.sqft > 1000000)) {
        errors.push('Square footage must be between 0 and 1,000,000');
    }
    if (data.asking !== null && (data.asking < 0 || data.asking > 100000000)) {
        errors.push('Asking price must be between $0 and $100,000,000');
    }
    if (data.arv !== null && (data.arv < 0 || data.arv > 100000000)) {
        errors.push('ARV must be between $0 and $100,000,000');
    }
    if (data.rehab !== null && (data.rehab < 0 || data.rehab > 100000000)) {
        errors.push('Rehab cost must be between $0 and $100,000,000');
    }

    if (data.pictures && !isValidURL(data.pictures)) {
        errors.push('Pictures link must be a valid URL');
    }
    if (data.contractLink && !isValidURL(data.contractLink)) {
        errors.push('Contract link must be a valid URL');
    }
    if (data.investorSheetLink && !isValidURL(data.investorSheetLink)) {
        errors.push('Investor sheet link must be a valid URL');
    }

    if (data.zip && !/^\d{5}(-\d{4})?$/.test(data.zip)) {
        errors.push('ZIP code must be 5 digits (optional 4-digit extension)');
    }

    return errors;
}

function isValidURL(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.trim().replace(/[<>]/g, '');
}

function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getDaysSinceAdded(d) {
    if (!d) return null;
    return Math.floor(Math.abs(new Date() - new Date(d)) / (1000*60*60*24));
}

function formatDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(n) {
    return n ? '$' + n.toLocaleString() : '-';
}

function normalizeProperties(properties) {
    properties.forEach(p => {
        if (!p.arv) p.arv = '';
        if (!p.rehab) p.rehab = '';
        if (!p.notes) p.notes = '';
    });
    return properties;
}

const statusMap = {
    "Ready to Blast": { class: "ready", label: "Ready", color: "#22c55e" },
    "New": { class: "new", label: "New", color: "#6b7280" },
    "On Hold": { class: "hold", label: "On Hold", color: "#eab308" },
    "Too High": { class: "high", label: "Too High", color: "#f97316" },
    "Sold": { class: "sold", label: "Sold", color: "#ef4444" }
};

function getFiltered(properties, { currentFilter = 'all', countyFilter = null, typeFilter = null, searchTerm = '', sortField = 'dateAdded', sortDirection = 'desc' } = {}) {
    let f = properties.filter(p => {
        const stageOk = currentFilter === 'all' ||
            (currentFilter === 'ready' && p.stage === 'Ready to Blast') ||
            (currentFilter === 'new' && p.stage === 'New') ||
            (currentFilter === 'hold' && p.stage === 'On Hold') ||
            (currentFilter === 'high' && p.stage === 'Too High') ||
            (currentFilter === 'sold' && p.stage === 'Sold');

        const countyOk = !countyFilter || p.county === countyFilter;
        const typeOk = !typeFilter || p.type === typeFilter;

        const searchLower = searchTerm.toLowerCase();
        const searchOk = !searchTerm ||
            p.address.toLowerCase().includes(searchLower) ||
            p.city.toLowerCase().includes(searchLower) ||
            (p.county && p.county.toLowerCase().includes(searchLower)) ||
            (p.notes && p.notes.toLowerCase().includes(searchLower));

        return stageOk && countyOk && typeOk && searchOk;
    });

    f.sort((a,b) => {
        let av = a[sortField], bv = b[sortField];
        if (av == null || av === '') av = sortDirection === 'asc' ? Infinity : -Infinity;
        if (bv == null || bv === '') bv = sortDirection === 'asc' ? Infinity : -Infinity;
        if (typeof av === 'string') {
            av = av.toLowerCase();
            bv = bv.toLowerCase();
        }
        return sortDirection === 'asc' ?
            (av > bv ? 1 : av < bv ? -1 : 0) :
            (av < bv ? 1 : av > bv ? -1 : 0);
    });

    return f;
}

function parseBlock(block) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);

    let address = '', city = '', zip = '', county = '';
    let beds = null, baths = null, asking = null;
    let access = null, pictures = null, arv = null;
    let notes = [];

    for (const line of lines) {
        const lower = line.toLowerCase();

        if (!address) {
            const m = line.match(/^(\d+[^,]+),\s*([^,]+),\s*PA\s*(\d{5})?/i);
            if (m) {
                address = m[1].trim();
                city = m[2].trim();
                zip = m[3] || '';
                continue;
            }

            const s = line.match(/^(\d+[^,]+),\s*([A-Za-z\s]+)$/);
            if (s && !lower.includes('county')) {
                address = s[1].trim();
                city = s[2].trim();
                continue;
            }
        }

        if (lower.includes('county')) {
            county = line.replace(/county/i, '').trim();
            continue;
        }

        const bm = line.match(/(\d+)\s*(?:br|bed)/i);
        const btm = line.match(/(\d+\.?\d*)\s*(?:ba|bath)/i);
        if (bm) beds = parseInt(bm[1]);
        if (btm) baths = parseFloat(btm[1]);
        if (bm || btm) continue;

        // Check ARV/worth BEFORE generic K-format prices to avoid
        // "ARV 275k" being consumed as an asking price
        if (lower.includes('arv') || lower.includes('worth')) {
            const a = line.match(/(\d+\.?\d*)\s*k/i);
            if (a) {
                arv = Math.round(parseFloat(a[1]) * 1000);
                continue;
            }
        }

        if (lower.includes('asking') || lower.match(/\$?\d+\.?\d*k/i)) {
            const k = line.match(/(\d+\.?\d*)\s*k/i);
            if (k) {
                asking = Math.round(parseFloat(k[1]) * 1000);
                continue;
            }
        }

        if (lower.includes('access') || lower.includes('lockbox') || lower.includes('door') || lower.includes('code')) {
            access = line.replace(/access:?/i, '').trim();
            continue;
        }

        if (lower.includes('dropbox') || lower.includes('photos') || lower.includes('pics') || line.match(/https?:\/\//)) {
            const u = line.match(/(https?:\/\/[^\s]+)/);
            if (u) {
                pictures = u[1];
                continue;
            }
        }

        if (line.length > 3) notes.push(line);
    }

    return {
        address,
        city,
        zip,
        county,
        beds,
        baths,
        asking,
        access,
        pictures,
        arv,
        notes: notes.join('\n')
    };
}

function exportCSVString(properties) {
    const h = ['Address','City','ZIP','County','Type','Beds','Baths','Sq Ft','Asking','ARV','Rehab','Access','Stage','Notes','Photos','Contract Link','Investor Sheet','Lat','Lng','Geo Precision','Date Added','Days Since Added','Last Updated'];

    const rows = properties.map(p => {
        const d = getDaysSinceAdded(p.dateAdded);
        return [
            `"${p.address}"`,
            p.city,
            p.zip||'',
            p.county||'',
            p.type,
            p.beds||'',
            p.baths||'',
            p.sqft||'',
            p.asking||'',
            p.arv||'',
            p.rehab||'',
            `"${p.access||''}"`,
            p.stage,
            `"${(p.notes||'').replace(/"/g,'""')}"`,
            p.pictures||'',
            p.contractLink||'',
            p.investorSheetLink||'',
            p.lat||'',
            p.lng||'',
            p.geoPrecision||'',
            p.dateAdded||'',
            d!==null?d:'',
            p.lastUpdated||''
        ];
    });

    return [h.join(','), ...rows.map(r => r.join(','))].join('\n');
}

function validateImportData(data) {
    if (!Array.isArray(data)) {
        return { valid: false, error: 'Expected array of properties' };
    }
    if (!data.every(p => p.address && p.city)) {
        return { valid: false, error: 'Missing required fields (address, city)' };
    }

    // Deduplicate by ID
    const uniqueData = [];
    const seenIds = new Set();
    for (const prop of data) {
        if (!seenIds.has(prop.id)) {
            seenIds.add(prop.id);
            uniqueData.push(prop);
        }
    }

    return { valid: true, properties: uniqueData, duplicatesRemoved: data.length - uniqueData.length };
}

// ========== EXTRACTED FUNCTIONS FROM app.js ==========

function debounce(fn, ms) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
    };
}

function computeStats(properties) {
    return {
        ready: properties.filter(p => p.stage === 'Ready to Blast').length,
        new: properties.filter(p => p.stage === 'New').length,
        hold: properties.filter(p => p.stage === 'On Hold').length,
        high: properties.filter(p => p.stage === 'Too High').length,
        sold: properties.filter(p => p.stage === 'Sold').length,
        total: properties.length,
    };
}

function computeCountyCounts(properties) {
    const counties = {};
    properties.forEach(p => {
        if (p.county) counties[p.county] = (counties[p.county] || 0) + 1;
    });
    return Object.entries(counties).sort((a, b) => b[1] - a[1]);
}

function computeTypeCounts(properties) {
    const types = {};
    properties.forEach(p => {
        if (p.type) types[p.type] = (types[p.type] || 0) + 1;
    });
    return Object.entries(types);
}

function checkDuplicateProperty(properties, address, city) {
    if (!address || !city) return null;
    const addrLower = address.toLowerCase();
    const cityLower = city.toLowerCase();
    return properties.find(p =>
        (p.address.toLowerCase().includes(addrLower) || addrLower.includes(p.address.toLowerCase())) &&
        p.city.toLowerCase() === cityLower
    ) || null;
}

function computeSpread(arv, asking, rehab) {
    if (!arv || !asking) return null;
    return arv - asking - (rehab || 0);
}

function validatePin(entered, pin) {
    if (!entered || entered.length < 4) return { valid: false, error: 'Enter 4 digits' };
    if (entered === pin) return { valid: true };
    return { valid: false, error: 'Wrong PIN' };
}

module.exports = {
    validatePropertyData,
    isValidURL,
    sanitizeInput,
    generateUUID,
    getDaysSinceAdded,
    formatDate,
    formatCurrency,
    normalizeProperties,
    statusMap,
    getFiltered,
    parseBlock,
    exportCSVString,
    validateImportData,
    debounce,
    computeStats,
    computeCountyCounts,
    computeTypeCounts,
    checkDuplicateProperty,
    computeSpread,
    validatePin,
};
