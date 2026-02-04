// ========== CONFIGURATION ==========
const STORAGE_KEY = 'jps_properties_v2';
const PIN = "2365";
const STORAGE_KEY_PIN = "jps_pin_ok";
const REMEMBER = true;

// ========== STATE ==========
let properties = [];
let firebaseReady = false;
let suppressRemoteUpdate = false;
let map, markerLayer;
let currentFilter = 'all';
let countyFilter = null;
let typeFilter = null;
let searchTerm = '';
let editingPropertyId = null;
let isEditMode = false;
let parsedDeals = [];
let sortField = 'dateAdded';
let sortDirection = 'desc';
let bulkMode = false;
let selectedProperties = new Set();

// ========== FIREBASE SYNC ==========

// Debounce helper - prevents rapid-fire saves
function debounce(fn, ms) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
    };
}

// Save to Firebase (called automatically, debounced)
const saveToFirebase = debounce(async () => {
    if (!firebaseReady || !window._fb) {
        console.warn('Firebase not ready for save');
        return;
    }
    
    const { db, doc, setDoc, serverTimestamp } = window._fb;
    const docRef = doc(db, 'jps', 'pipeline');
    
    suppressRemoteUpdate = true;
    updateSyncStatus('saving');
    
    try {
        console.log('💾 Saving to Firebase...', properties.length, 'properties');
        await setDoc(docRef, {
            properties: properties,
            updatedAt: serverTimestamp(),
            version: 2
        });
        console.log('✓ Saved to Firebase successfully');
        updateSyncStatus('synced');
    } catch (error) {
        console.error('❌ Firebase save error:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        
        updateSyncStatus('error');
        
        if (error.code === 'permission-denied') {
            showToast('Firebase access denied - check security rules', 'error');
        } else {
            showToast('Cloud sync failed - saved locally', 'warning');
        }
    }
    
    // Allow remote updates again after a short delay
    setTimeout(() => { suppressRemoteUpdate = false; }, 300);
}, 600);

// Load from Firebase (called once on startup)
async function loadFromFirebase() {
    if (!window._fb) {
        console.warn('Firebase not initialized');
        return false;
    }
    
    const { db, doc, getDoc } = window._fb;
    const docRef = doc(db, 'jps', 'pipeline');
    
    try {
        console.log('🔄 Loading from Firebase...');
        const snap = await getDoc(docRef);
        
        if (snap.exists()) {
            const data = snap.data();
            console.log('Firebase document found:', data);
            
            if (data.properties && Array.isArray(data.properties)) {
                properties = data.properties;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(properties));
                console.log(`✓ Loaded ${properties.length} properties from Firebase`);
                return true;
            } else {
                console.warn('Firebase document exists but has no properties array');
            }
        } else {
            console.log('No Firebase document found - will create on first save');
        }
        return false;
    } catch (error) {
        console.error('❌ Firebase load error:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        
        if (error.code === 'permission-denied') {
            showToast('Firebase access denied - check security rules', 'error');
        } else if (error.code === 'unavailable') {
            showToast('Firebase offline - using local data', 'warning');
        } else {
            showToast('Using offline data', 'info');
        }
        return false;
    }
}

// Real-time listener for cross-device sync
function startRealtimeSync() {
    if (!window._fb) return;
    
    const { db, doc, onSnapshot } = window._fb;
    const docRef = doc(db, 'jps', 'pipeline');
    
    onSnapshot(docRef, (snap) => {
        // Skip if we just saved (prevents echo)
        if (suppressRemoteUpdate) return;
        
        // If document doesn't exist yet, push our local data
        if (!snap.exists()) {
            console.log('No remote data found, pushing local data...');
            saveToFirebase();
            return;
        }
        
        const data = snap.data();
        if (!data.properties || !Array.isArray(data.properties)) return;
        
        // Update local data from remote
        properties = data.properties;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(properties));
        
        // Refresh the entire UI
        normalizeProperties();
        updateStats();
        renderCountyList();
        renderTypeList();
        refresh();
        
        console.log('✓ Synced from another device');
        updateSyncStatus('synced');
        
    }, (error) => {
        console.error('Real-time sync error:', error);
        updateSyncStatus('error');
    });
}

// Sync status indicator
function updateSyncStatus(status) {
    let el = document.getElementById('sync-status');
    
    if (!el) {
        el = document.createElement('div');
        el.id = 'sync-status';
        el.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-right: 12px;
        `;
        const headerActions = document.querySelector('.header-actions');
        if (headerActions) {
            headerActions.insertBefore(el, headerActions.firstChild);
        }
    }
    
    const colors = {
        synced: 'var(--green)',
        saving: 'var(--yellow)',
        error: 'var(--red)',
        offline: 'var(--text-muted)'
    };
    
    const labels = {
        synced: '● Synced',
        saving: '● Saving...',
        error: '● Offline',
        offline: '○ Local only'
    };
    
    el.innerHTML = `<span style="color:${colors[status] || colors.offline}">${labels[status] || labels.offline}</span>`;
}

// Initialize Firebase when ready
window.addEventListener('firebase-ready', async () => {
    firebaseReady = true;
    
    try {
        // Load from Firebase (may override localStorage)
        const loaded = await loadFromFirebase();
        
        if (loaded) {
            // Refresh UI with Firebase data
            normalizeProperties();
            updateStats();
            renderCountyList();
            renderTypeList();
            refresh();
        } else if (properties.length > 0) {
            // No Firebase data exists, push local data
            console.log('Pushing local data to Firebase...');
            await saveToFirebase();
        }
        
        // Start listening for changes from other devices
        startRealtimeSync();
        
        updateSyncStatus('synced');
    } catch (error) {
        console.error('Firebase initialization error:', error);
        updateSyncStatus('error');
    }
});

// ========== VALIDATION UTILITIES ==========

function validatePropertyData(data) {
    const errors = [];
    
    // Required fields
    if (!data.address || data.address.trim().length === 0) {
        errors.push('Address is required');
    }
    if (!data.city || data.city.trim().length === 0) {
        errors.push('City is required');
    }
    
    // Numeric field validation
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
    
    // URL validation
    if (data.pictures && !isValidURL(data.pictures)) {
        errors.push('Pictures link must be a valid URL');
    }
    if (data.contractLink && !isValidURL(data.contractLink)) {
        errors.push('Contract link must be a valid URL');
    }
    if (data.investorSheetLink && !isValidURL(data.investorSheetLink)) {
        errors.push('Investor sheet link must be a valid URL');
    }
    
    // ZIP code validation
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
    // Remove potential XSS characters
    return input.trim().replace(/[<>]/g, '');
}

// ========== UTILITY FUNCTIONS ==========

const defaultProperties = [
{"id":"1","address":"105 Mohawk St","city":"Bruin","zip":"16022","county":"Butler","type":"SFH","beds":2,"baths":2,"sqft":null,"asking":29900,"arv":"","rehab":"","stage":"Ready to Blast","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/x78yyb89l1fvjrmmtsvce/AJR45aFiHvjO4RV1sq2gAXc?rlkey=tluyv1113o7cx9fyymvd78rsj&st=bnqfbn0j&dl=0","contractLink":null,"investorSheetLink":null,"notes":"No heat, No electric","lat":41.0531,"lng":-79.7297,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"2","address":"177-179 Pine St","city":"Johnstown","zip":"15902","county":"Cambria","type":"MFH","beds":null,"baths":null,"sqft":null,"asking":24900,"arv":"","rehab":"","stage":"Ready to Blast","access":"Front door open","pictures":"https://www.dropbox.com/scl/fo/y16sewfrxbouqojd3hlgo/AI4gkH8rdloRwKnRVjbrJWw?rlkey=02s1kln21zophhb5on0o0w1pn&st=594d1i2j&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Newer sewer line, quiet dead end street","lat":40.3267,"lng":-78.9214,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"3","address":"313-315 Grove Ave","city":"Johnstown","zip":"15902","county":"Cambria","type":"MFH","beds":null,"baths":null,"sqft":null,"asking":29900,"arv":"","rehab":"","stage":"Ready to Blast","access":"3333 rear door","pictures":"https://www.dropbox.com/scl/fo/7u2qye3vzmqfrgm57ftnn/APKLrqfpEzObWI0iN2ng0K0?rlkey=f6m9yixuldysn6xilhgev7pc4&st=oks393ep&dl=0","contractLink":null,"investorSheetLink":null,"notes":"","lat":40.3287,"lng":-78.9194,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"4","address":"1317 W. 3rd St","city":"Chester","zip":"19013","county":"Delaware","type":"SFH","beds":4,"baths":1,"sqft":null,"asking":99900,"arv":"","rehab":"","stage":"Ready to Blast","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/14ryt164accu3rugdlr0t/AF3IcHOnZF2KMVDgkvuJ1F8?rlkey=68pt8nrwi4lyjd6b7sv7afsos&st=bmzptlr3&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Electric heat, newer 200amp cb","lat":39.8496,"lng":-75.3757,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"5","address":"708 Jeffrey St","city":"Chester","zip":"19013","county":"Delaware","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":99900,"arv":"","rehab":"","stage":"Too High","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/mgtaud4xu7x6akm5202e7/AE7DPDyAL45t3qHHp3CCT90?rlkey=da5sb8ykxq3mm8gm7mfrpivo3&st=opjbyt5t&dl=0","contractLink":null,"investorSheetLink":null,"notes":"","lat":39.8506,"lng":-75.3647,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T00:38:32.317Z"},
{"id":"6","address":"173 Beechwood Ave","city":"Clifton Heights","zip":"19018","county":"Delaware","type":"Lot","beds":null,"baths":null,"sqft":null,"asking":29900,"arv":"","rehab":"","stage":"Ready to Blast","access":null,"pictures":"https://www.dropbox.com/scl/fo/e3hgl15exdih5bmxtp3y5/ALAm-qeIbJpBsyp-jBCyy3E?rlkey=nhyusz5rprv0ouv1c9v9e2um6&st=zgfjxjho&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Buildable lot","lat":39.929,"lng":-75.2957,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T01:12:43.227Z"},
{"id":"7","address":"124 N. 3rd","city":"Darby","zip":"19023","county":"Delaware","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":89900,"arv":"","rehab":"","stage":"On Hold","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/l6fevtgv0yx88h1uas8mc/AA8sINK2RcegrEjfD8NFgJk?rlkey=w6xflnx52by795ueasb998j9s&st=hkdn1co3&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Newer 100 amp cb, gas hot water heat","lat":39.9184,"lng":-75.259,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T00:38:53.097Z"},
{"id":"8","address":"2517 Peoples St","city":"Chester","zip":"19013","county":"Delaware","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":69900,"arv":"","rehab":"","stage":"On Hold","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/bqjfkw6hb478w9eo9f883/AP-jNKy3oZ3jefy4elNf6FM?rlkey=6yp0llcmwhzbsfnumf7z1d0xd&st=ls789bue&dl=0","contractLink":null,"investorSheetLink":null,"notes":"100 amp cb, gas heat","lat":39.8536,"lng":-75.3717,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T00:38:59.626Z"},
{"id":"9","address":"19 S 6th St","city":"Darby","zip":"19023","county":"Delaware","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":89900,"arv":"","rehab":"","stage":"On Hold","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/6cqzq7k79b6qukooixrd1/ALuJAilKoEsat-1tKTvyZPU?rlkey=zv2wp7z2ssuukbc02x9wjy604&st=2dn1tva5&dl=0","contractLink":null,"investorSheetLink":null,"notes":"","lat":39.9164,"lng":-75.261,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T00:39:05.125Z"},
{"id":"10","address":"433 Rose St","city":"Chester","zip":"19013","county":"Delaware","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":54900,"arv":"","rehab":"","stage":"On Hold","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/vw6lekqbpodl64qc7itho/AG4tjfibe84uxmqTQJYV0QE?rlkey=2krzecdtes4ryel3sb5er1c4e&st=1nkl2w3l&dl=0","contractLink":null,"investorSheetLink":null,"notes":"gas hot air heat","lat":39.8476,"lng":-75.3687,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T00:39:12.197Z"},
{"id":"11","address":"1114 Clover Ln","city":"Chester","zip":"19013","county":"Delaware","type":"SFH","beds":2,"baths":1,"sqft":null,"asking":79900,"arv":"","rehab":"","stage":"On Hold","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/bt2120jtdoeqddjjbekqq/AOzPYRCbHXW5YTgqkYQQpng?rlkey=a2vjptpz0t9x646jhre4p4t7j&st=8wlauzg2&dl=0","contractLink":null,"investorSheetLink":null,"notes":"newer gas hot air heater, newer hot water heater, old 100 amp cb","lat":39.8456,"lng":-75.3627,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T00:39:16.310Z"},
{"id":"12","address":"128 N Wells","city":"Glenolden","zip":"19036","county":"Delaware","type":"SFH","beds":3,"baths":2,"sqft":null,"asking":179900,"arv":"","rehab":"","stage":"On Hold","access":"3333 side door","pictures":"https://www.dropbox.com/scl/fo/lvm0y7j4dqtn8f8jbttkt/AOrntvfyg-YX_Tz66fdC8XI?rlkey=rlb9lczgcyeieqzzi9a3r26hp&st=kdtmait4&dl=0","contractLink":null,"investorSheetLink":null,"notes":"100 amp cb, gas heater","lat":39.8993,"lng":-75.2896,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T00:39:19.877Z"},
{"id":"13","address":"17 E. Mowry St","city":"Chester","zip":"19013","county":"Delaware","type":"Unknown","beds":null,"baths":null,"sqft":null,"asking":89900,"arv":"","rehab":"","stage":"On Hold","access":"Door is open","pictures":"https://www.dropbox.com/scl/fo/nze9xjf82wrrr1frehhs1/AAZ9tSJGKU87fZFg76h0alk?rlkey=6g1aa94lldlwbeymz6flxn6hj&st=vkygitrv&dl=0","contractLink":null,"investorSheetLink":null,"notes":"2 unit. Hoarder house. Lots of junk","lat":39.8516,"lng":-75.3577,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T00:39:23.444Z"},
{"id":"14","address":"332 Kerlin St","city":"Chester","zip":"19013","county":"Delaware","type":"SFH","beds":3,"baths":2,"sqft":null,"asking":69900,"arv":"","rehab":"","stage":"Ready to Blast","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/0nc532b8fauuuqnbcywie/AJkYhUeb0FZC0szvnuZ4B-E?rlkey=dxg98uwk41fv467gkgegrakew&st=hh1azjav&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Gas heat","lat":39.8486,"lng":-75.3597,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T01:43:28.944Z"},
{"id":"15","address":"67 Dixon Blvd","city":"Uniontown","zip":"15401","county":"Fayette","type":"SFH","beds":2,"baths":1,"sqft":null,"asking":69900,"arv":"","rehab":"","stage":"Ready to Blast","access":"3333 rear door","pictures":"https://www.dropbox.com/scl/fo/uj756klqii95fulgdbyvg/AKB8JgD1XrVmipEcDY7olEE?rlkey=x0um8rz85p4gu8lnontuta2nb&st=rgmgbxub&dl=0","contractLink":null,"investorSheetLink":null,"notes":"gas heat, central air, detached garage","lat":39.899,"lng":-79.7249,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T02:26:17.027Z"},
{"id":"16","address":"322 Graff St","city":"Everson","zip":"15631","county":"Fayette","type":"SFH","beds":4,"baths":1,"sqft":null,"asking":49900,"arv":"","rehab":"","stage":"Too High","access":"3333 back door","pictures":"https://www.dropbox.com/scl/fo/6nkgwhzd6aqgf5wf4fhwd/AKkxrifJUgySQH_AAtRRIi4?rlkey=tc17fx5pbbtocjqf83e1opvbn&st=3mzy3271&dl=0","contractLink":null,"investorSheetLink":null,"notes":"large above ground pool","lat":40.097,"lng":-79.587,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T06:21:42.960Z"},
{"id":"17","address":"406 Market St","city":"Brownsville","zip":"15417","county":"Fayette","type":"MFH","beds":null,"baths":null,"sqft":null,"asking":39900,"arv":"","rehab":"","stage":"Ready to Blast","access":"3333 inside 2nd door or rear door is open","pictures":"https://www.dropbox.com/scl/fo/pjhqkaz4lqrmv7mfb3qz7/AEynxMALDoJHkpc8CHZDt3w?rlkey=6eosfmpb3v0pyvfvve8vegdq6&st=lg99e9t4&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Next to gas station, barbershop and Somerset Trust Bank being built across street","lat":40.0237,"lng":-79.8837,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-22T07:01:09.667Z"},
{"id":"18","address":"102 Turnbull Ln","city":"Wickhaven","zip":"15492","county":"Fayette","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":89900,"arv":"","rehab":"","stage":"New","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/3ne59550qa3uood3bu5f9/ANI46vn0FExt-pxsd70_pEo?rlkey=fe9abrdnarhfrtu1foeh8u413&st=fwaz7cy5&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Nice brick house, oil hot water heat, shed, rear deck, hardwood floors","lat":40.0537,"lng":-79.8137,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"19","address":"384 Market St","city":"Clarksville","zip":"15322","county":"Greene","type":"SFH","beds":3,"baths":2,"sqft":null,"asking":29900,"arv":"","rehab":"","stage":"New","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/q5vepruszp7hq41ub0hbr/ACXRyetGB_TvoiuqMrp8Ojg?rlkey=aagj320vg8pyw10vc728mpt3j&st=qlrd5ale&dl=0","contractLink":null,"investorSheetLink":null,"notes":"gas hot air heat, 100amp cb, large kitchen, good neighborhood, old shed in rear","lat":39.9701,"lng":-80.0427,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"20","address":"137 N Otter St","city":"Mercer","zip":"16137","county":"Mercer","type":"Lot","beds":null,"baths":null,"sqft":null,"asking":12900,"arv":"","rehab":"","stage":"New","access":null,"pictures":"https://www.dropbox.com/scl/fo/kyqab4jek671namgb184q/AAZ0Rda0LB1dOby5EF-LnUM?rlkey=obv18gma50cup8iv5nab1uo6j&st=74hq5bbu&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Public water and sewer available","lat":41.227,"lng":-80.239,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"21","address":"1202 Bond St","city":"Farrell","zip":"16121","county":"Mercer","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":39900,"arv":"","rehab":"","stage":"New","access":"Door is open","pictures":"https://www.dropbox.com/scl/fo/m2l1z5vso6hsrn5un26je/AAJqfHRxgMP66eYfZhxjoKI?rlkey=a22mwgp9o67wo2bg55e503p4n&st=lbm909rs&dl=0","contractLink":null,"investorSheetLink":null,"notes":"on big 159x247 lot. Yard and parking space, hardwood and carpet throughout, large deck","lat":41.2126,"lng":-80.4968,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"22","address":"152 E. Garrett St","city":"Somerset","zip":"15501","county":"Somerset","type":"SFH","beds":3,"baths":1,"sqft":1344,"asking":79900,"arv":"","rehab":"","stage":"New","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/9y5gj7iwrkn98cdt5xpw9/AN5MvDYOY_JHlbDug-KZJ3w?rlkey=ti5tw1u8upvc0h2m3qrx3aju5&st=lqhon04o&dl=0","contractLink":null,"investorSheetLink":null,"notes":"1,344 sqft","lat":40.0084,"lng":-79.0781,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"23","address":"Rogers Riviera Rd","city":"Venango","zip":null,"county":"Venango","type":"Lot","beds":null,"baths":null,"sqft":null,"asking":119900,"arv":"","rehab":"","stage":"New","access":null,"pictures":"https://www.dropbox.com/scl/fo/yed2uoxz649uamar9x0ii/AGUiB-AuyFRd_oFdrj98p-k?rlkey=bzt0yj67adbhoasrj106fxbi0&st=e1a7vuy9&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Buildable, flat, road frontage, no water running through land. GPS coordinates: 41.20933, -79.77143","lat":41.4201,"lng":-79.7601,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"24","address":"81 Hickory Hill Ln","city":"Youngsville","zip":"16371","county":"Warren","type":"SFH","beds":4,"baths":1,"sqft":null,"asking":89900,"arv":"","rehab":"","stage":"New","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/2jvc6fwmxsgizya3gerjr/AOCcX_5mSOz__tYSvS8CY5M?rlkey=4xhzijvno8fav8724fegzwfin&st=dld3lluo&dl=0","contractLink":null,"investorSheetLink":null,"notes":"On 10 acres. 3 car garage with 2 detached garages. Well and septic.","lat":41.8526,"lng":-79.3188,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"25","address":"139 Highland Ave","city":"Claysville","zip":"15323","county":"Washington","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":19900,"arv":"","rehab":"","stage":"New","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/csuq6q6wb3zhbk71rsgxc/ABP7pmDnQoNyKOS-YN4vWLk?rlkey=2lfp5ltije1xskoqf6sky34br&st=s1agysa1&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Covered front porch, newer hot water heater, newer electric panel, big rear yard","lat":40.1184,"lng":-80.4217,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"26","address":"32 Rosewood Dr","city":"Charleroi","zip":"15022","county":"Washington","type":"SFH","beds":2,"baths":1,"sqft":null,"asking":39900,"arv":"","rehab":"","stage":"New","access":"Door is open","pictures":null,"contractLink":null,"investorSheetLink":null,"notes":"Property is burned out on inside but in good area","lat":40.1379,"lng":-79.8978,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"27","address":"311 Mt Tabor Rd","city":"Coal Center","zip":"15423","county":"Washington","type":"SFH","beds":4,"baths":1,"sqft":null,"asking":49900,"arv":"","rehab":"","stage":"New","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/we74vh667iexqkvzj2mm0/ABq9S0ORFrhIx3yLylKC7JM?rlkey=tuk9htnxiivz0qht6fty5ph5b&st=x20jbv8l&dl=0","contractLink":null,"investorSheetLink":null,"notes":"200 amp cb, oil hot air heat","lat":40.0879,"lng":-79.8978,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"28","address":"183 Country Club Rd","city":"Washington","zip":"15301","county":"Washington","type":"SFH","beds":2,"baths":1,"sqft":null,"asking":29900,"arv":"","rehab":"","stage":"New","access":"12345 front door","pictures":"https://www.dropbox.com/scl/fo/1peo0u3mcbs667yaebhrv/ABlpHY8RJ6fDMfLePHOT8s8?rlkey=mguyq7msfzis8s2b3gh686gv3&st=k7p9m0jf&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Central air, new 100 amp cb, public sewer + water, gas hot air heat","lat":40.174,"lng":-80.2462,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"29","address":"38 3rd Ave","city":"Scottdale","zip":"15683","county":"Westmoreland","type":"SFH","beds":2,"baths":1,"sqft":null,"asking":99900,"arv":"","rehab":"","stage":"New","access":"3333 side door","pictures":"https://www.dropbox.com/scl/fo/aac4ivlkoc2p37yem0745/ACr29Hh2u2Llv-fcueyPsCo?rlkey=ic6ptnbtgum2fr2l99re07q3r&st=4evb1mpz&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Move in condition, Semi finished basement, newer gas hot air heat, newer 100 amp cb","lat":40.1006,"lng":-79.5869,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"30","address":"800 3rd Ave - Hyde Park","city":"Hyde Park","zip":"15641","county":"Westmoreland","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":59900,"arv":"","rehab":"","stage":"Sold","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/fynzb1sqmdbbc0265dxlg/ACim5D53EzUvDVpQEDmCs7g?rlkey=lx5pvewon2m8ijko81qjtwede&st=mamdmc23&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Electric heat, 200 amp cb","lat":40.6348,"lng":-79.7328,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"31","address":"800 E Hill Dr","city":"New Kensington","zip":"15068","county":"Westmoreland","type":"Lot","beds":null,"baths":null,"sqft":null,"asking":14900,"arv":"","rehab":"","stage":"New","access":null,"pictures":"https://www.dropbox.com/scl/fo/nozjfp1xrh6m84rhskwdg/AJN2L5VpqF9Tf-WwKaGVCdM?rlkey=0g4rjyo7n691agjqlvc259zya&st=o98zpmhr&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Commercial zoned","lat":40.5698,"lng":-79.7448,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"32","address":"130 Wood","city":"Bolivar","zip":"15923","county":"Westmoreland","type":"Lot","beds":null,"baths":null,"sqft":null,"asking":24900,"arv":"","rehab":"","stage":"New","access":null,"pictures":"https://www.dropbox.com/scl/fo/bl4ek1p5e52i4rcah4opo/h?rlkey=sn7r3u27qxseq2hqc8s4n4lxj&st=0sbfcs96&dl=0","contractLink":null,"investorSheetLink":null,"notes":"","lat":40.3984,"lng":-79.1662,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"33","address":"2311 Cowling Rd","city":"Scottdale","zip":"15683","county":"Westmoreland","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":139900,"arv":"","rehab":"","stage":"New","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/u5alkj0ulxpvcw8lnu7mt/AHoiLmoc__eDcsVjP963YfU?rlkey=n1buxgz0sd5m4sgb075lyty45&st=k8q6opm2&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Roof ok, newer gas hot air heater, 200 amp cb, central air","lat":40.1006,"lng":-79.5869,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"34","address":"253 Ridge Ave","city":"New Kensington","zip":"15068","county":"Westmoreland","type":"SFH","beds":6,"baths":3,"sqft":null,"asking":59900,"arv":"","rehab":"","stage":"Ready to Blast","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/ek06zfeyckqo54jw7nikk/AMjavDGgGfzqhwqTakelPE4?rlkey=7xzs38ldd46onet3eq0g7yc04&st=smkj0a9c&dl=0","contractLink":null,"investorSheetLink":null,"notes":"100 amp cb, 2 heaters both gas hot air, detached garage in back, hardwood floors, original oak doors","lat":40.5718,"lng":-79.7528,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"35","address":"110 Orange St","city":"Wrightsville","zip":"17368","county":"York","type":"SFH","beds":2,"baths":1,"sqft":null,"asking":134900,"arv":"","rehab":"","stage":"Ready to Blast","access":"3333 front door","pictures":"https://www.dropbox.com/scl/fo/9lz7nyh9zdzou6ikzk0ow/AMNEwNSlDnf0E6ChoNhou0s?rlkey=6xj1owhzn20kmv7ngeri71ts1&st=ivde73j5&dl=0","contractLink":null,"investorSheetLink":null,"notes":"","lat":40.0254,"lng":-76.5299,"geoPrecision":"exact","dateAdded":"2026-01-21T06:34:05.343Z","lastUpdated":"2026-01-21T06:34:05.343Z"},
{"id":"36","address":"1037 Mcdowell St","city":"Chester","zip":"19013","county":"Delaware","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":89900,"arv":"","rehab":"","stage":"Ready to Blast","access":"3333","pictures":"https://www.dropbox.com/scl/fo/paour9bowxoazsdqajg32/APYdyfgb8dS1vnjMNEFH21c?rlkey=eeqzbjf6bp7tuwupd6rag3wf2&st=1sxg7g37&dl=0","contractLink":null,"investorSheetLink":null,"notes":"","lat":39.8526,"lng":-75.3687,"geoPrecision":"exact","dateAdded":"2026-01-21T19:15:38.491Z","lastUpdated":"2026-01-21T23:54:24.093Z"},
{"id":"37","address":"128 Hamilton Ln","city":"New Galilee","zip":"16141","county":"Beaver","type":"MFH","beds":5,"baths":2.5,"sqft":null,"asking":189000,"arv":275000,"rehab":"","stage":"Ready to Blast","access":"3333 back door","pictures":"https://www.dropbox.com/scl/fo/g0yn5m03798biohvu6sbm/AC1xJlUEOo8B31EkEwrRz64?rlkey=nfmint5f380n79yhs4vqjtyu8&st=wyf95x4a&dl=0","contractLink":null,"investorSheetLink":null,"notes":"Worth 275k ARV, In ground pool, oil hot water heat, central air, detached 3 car garage, finished basement","lat":40.8356188,"lng":-80.3995096,"geoPrecision":"exact","dateAdded":"2026-01-28T18:51:36.282Z","lastUpdated":"2026-01-28T20:03:20.507Z"},
{"id":"38","address":"383 N Liberty St","city":"Blairsville","zip":"15717","county":"Indiana","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":19900,"arv":"","rehab":"","stage":"New","access":"Door is open","pictures":"https://www.dropbox.com/scl/fo/6y8apwaj6ct0c09mkqpfv/AAiRb655oIles8v0sLlVVZg?rlkey=135cclo234ujj3wbig7jg49mp&st=ekrxt17x&dl=0","contractLink":null,"investorSheetLink":null,"notes":"","lat":40.436293,"lng":-79.2688229,"geoPrecision":"exact","dateAdded":"2026-01-28T18:52:54.490Z","lastUpdated":"2026-01-28T18:52:54.490Z"},
{"id":"39","address":"2181 Barr Slope Rd","city":"Clymer","zip":"15728","county":"Indiana","type":"SFH","beds":3,"baths":1,"sqft":null,"asking":39900,"arv":"","rehab":"","stage":"New","access":"3333","pictures":"https://www.dropbox.com/scl/fo/u9s1cv7tk7m9gz0tecabp/ABPK1KEBcCVD3H1gnYm_iPQ?rlkey=5jm8dp8u4bhxxpxzxlc4kdlm9&st=1ivqkgz8&dl=0","contractLink":null,"investorSheetLink":null,"notes":"","lat":40.6682605,"lng":-79.011747,"geoPrecision":"exact","dateAdded":"2026-01-28T18:54:30.940Z","lastUpdated":"2026-01-28T18:54:30.940Z"},
{"id":"40","address":"11 Meadow St","city":"Altoona","zip":"16602","county":"Blair","type":"SFH","beds":4,"baths":3,"sqft":4356,"asking":59900,"arv":215000,"rehab":40000,"stage":"Ready to Blast","access":"3333","pictures":"https://www.dropbox.com/scl/fo/031qm1xxwfads0xwjomrw/AIKeaO4AIURuqm6xUjahM9I?rlkey=pjv3760vnfbr0ecd93kw1anf9&st=065vxzk8&dl=0","contractLink":null,"investorSheetLink":null,"notes":"","lat":40.5080528,"lng":-78.3812298,"geoPrecision":"exact","dateAdded":"2026-01-28T20:27:57.369Z","lastUpdated":"2026-01-28T20:27:57.369Z"}
];

const statusMap = {
    "Ready to Blast": { class: "ready", label: "Ready", color: "#22c55e" },
    "New": { class: "new", label: "New", color: "#6b7280" },
    "On Hold": { class: "hold", label: "On Hold", color: "#eab308" },
    "Too High": { class: "high", label: "Too High", color: "#f97316" },
    "Sold": { class: "sold", label: "Sold", color: "#ef4444" }
};

function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function loadProperties() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        properties = stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.error('Error loading properties from localStorage:', error);
        properties = [];
        showToast('Error loading saved data', 'error');
    }
}

function normalizeProperties() {
    properties.forEach(p => {
        if (!p.arv) p.arv = '';
        if (!p.rehab) p.rehab = '';
        if (!p.notes) p.notes = '';
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

function saveProperties() {
    try {
        // Always save to localStorage (instant, works offline)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(properties));
        
        // Also save to Firebase (debounced, syncs across devices)
        if (typeof saveToFirebase === 'function') {
            saveToFirebase();
        }
    } catch (error) {
        console.error('Error saving properties:', error);
        showToast('Failed to save - check storage', 'error');
    }
}

function showToast(msg, type='success') {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${sanitizeInput(msg)}</span>`;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
    }, 3000);
}

// ========== GEOCODING ==========

async function tryGeocode(query) {
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=1&addressdetails=1`, {
            headers: { 'User-Agent': 'JiwaniPropertySolutions/1.0' }
        });
        
        if (!r.ok) {
            throw new Error(`Geocoding API returned ${r.status}`);
        }
        
        const data = await r.json();
        if (data && data.length) {
            let county = data[0].address?.county?.replace(/ County$/i, '').trim() || null;
            return {
                success: true,
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                county
            };
        }
        return { success: false };
    } catch (e) {
        console.error('Geocoding error:', e);
        return { success: false };
    }
}

async function geocodeAddress(addr, city, state='PA', zip='') {
    try {
        let r = await tryGeocode(`${addr}, ${city}, ${state}${zip ? ' ' + zip : ''}`);
        if (r.success) return { ...r, geoPrecision: 'exact' };
        
        r = await tryGeocode(`${city}, ${state}`);
        if (r.success) return { ...r, geoPrecision: 'approx' };
        
        return { success: false, geoPrecision: 'none' };
    } catch (error) {
        console.error('Geocoding error:', error);
        return { success: false, geoPrecision: 'none' };
    }
}

function showGeocodingStatus(status, msg) {
    const c = document.getElementById('geocode-status');
    if (!c) return;
    
    if (status === 'loading') {
        c.innerHTML = `<div class="geocoding-status"><div class="spinner"></div><span>${sanitizeInput(msg || 'Looking up address...')}</span></div>`;
    } else if (status === 'success') {
        c.innerHTML = `<div class="geocoding-status success"><span>✓</span><span>${sanitizeInput(msg || 'Found!')}</span></div>`;
    } else if (status === 'error') {
        c.innerHTML = `<div class="geocoding-status error"><span>!</span><span>${sanitizeInput(msg || 'Not found.')}</span></div>`;
    } else {
        c.innerHTML = '';
    }
}

async function geocodeMissing() {
    const missing = properties.filter(p => !p.lat || !p.lng);
    if (!missing.length) return showToast('All properties geocoded', 'info');
    
    showToast(`Geocoding ${missing.length} properties...`, 'info');
    let success = 0;
    
    try {
        for (let i = 0; i < missing.length; i++) {
            if (i > 0) await new Promise(r => setTimeout(r, 1000));
            
            const p = missing[i];
            const res = await geocodeAddress(p.address, p.city, 'PA', p.zip);
            
            if (res.success) {
                p.lat = res.lat;
                p.lng = res.lng;
                p.geoPrecision = res.geoPrecision;
                if (!p.county && res.county) p.county = res.county;
                success++;
            }
        }
        
        saveProperties();
        refresh();
        renderCountyList();
        showToast(`Geocoded ${success} properties`, success ? 'success' : 'warning');
    } catch (error) {
        console.error('Batch geocoding error:', error);
        showToast('Geocoding failed', 'error');
    }
}

async function fillMissingCounties() {
    const missing = properties.filter(p => !p.county && p.lat && p.lng);
    if (!missing.length) return showToast('All have counties', 'info');
    
    showToast(`Filling ${missing.length} counties...`, 'info');
    let success = 0;
    
    try {
        for (let i = 0; i < missing.length; i++) {
            if (i > 0) await new Promise(r => setTimeout(r, 1000));
            
            const p = missing[i];
            const res = await geocodeAddress(p.address, p.city, 'PA', p.zip);
            
            if (res.success && res.county) {
                p.county = res.county;
                success++;
            }
        }
        
        saveProperties();
        refresh();
        renderCountyList();
        showToast(`Filled ${success} counties`, success ? 'success' : 'warning');
    } catch (error) {
        console.error('Fill counties error:', error);
        showToast('Failed to fill counties', 'error');
    }
}

function checkDuplicate() {
    const addr = document.getElementById('form-address').value.trim().toLowerCase();
    const city = document.getElementById('form-city').value.trim().toLowerCase();
    const w = document.getElementById('duplicate-warning');
    
    if (!w) return false;
    if (!addr || !city) {
        w.innerHTML = '';
        return false;
    }
    
    const dup = properties.find(p =>
        p.address.toLowerCase().includes(addr) || addr.includes(p.address.toLowerCase())
    );
    
    if (dup && dup.city.toLowerCase() === city) {
        w.innerHTML = `<div class="duplicate-warning"><strong>⚠️ Possible Duplicate</strong>Found: ${sanitizeInput(dup.address)}, ${sanitizeInput(dup.city)} (${dup.stage})</div>`;
        return true;
    }
    
    w.innerHTML = '';
    return false;
}

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', function() {
    try {
        loadProperties();
        
        // Only load defaults if no stored data exists
        if (!localStorage.getItem(STORAGE_KEY) || !properties.length) {
            properties = defaultProperties.slice();
            saveProperties();
        }
        
        normalizeProperties();
        updateStats();
        renderCountyList();
        renderTypeList();
        renderGrid();
        renderList();
        initMap();
        setupEventListeners();
        updateFilterCounts();
        
        console.log(`Loaded ${properties.length} properties`);
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('App initialization failed', 'error');
    }
});

// ========== STATS & FILTERS ==========

function updateStats() {
    try {
        const ready = properties.filter(p => p.stage === "Ready to Blast").length;
        const newC = properties.filter(p => p.stage === "New").length;
        const hold = properties.filter(p => p.stage === "On Hold").length;
        const high = properties.filter(p => p.stage === "Too High").length;
        const sold = properties.filter(p => p.stage === "Sold").length;

        const readyEl = document.getElementById('ready-count');
        const newEl = document.getElementById('new-count');
        const holdEl = document.getElementById('hold-count');
        const highEl = document.getElementById('high-count');
        const soldEl = document.getElementById('sold-count');
        const totalEl = document.getElementById('total-count');
        const allCountEl = document.getElementById('all-count');

        if (readyEl) readyEl.textContent = ready;
        if (newEl) newEl.textContent = newC;
        if (holdEl) holdEl.textContent = hold;
        if (highEl) highEl.textContent = high;
        if (soldEl) soldEl.textContent = sold;
        if (totalEl) totalEl.textContent = properties.length + ' properties';
        if (allCountEl) allCountEl.textContent = properties.length;
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

function renderCountyList() {
    try {
        const counties = {};
        properties.forEach(p => {
            if (p.county) counties[p.county] = (counties[p.county] || 0) + 1;
        });
        
        const countyListEl = document.getElementById('county-list');
        if (countyListEl) {
            countyListEl.innerHTML = Object.entries(counties)
                .sort((a,b) => b[1]-a[1])
                .map(([c,n]) => `<div class="county-item" data-county="${sanitizeInput(c)}"><span>${sanitizeInput(c)}</span><span class="county-count">${n}</span></div>`)
                .join('');
        }
    } catch (error) {
        console.error('Error rendering county list:', error);
    }
}

function renderTypeList() {
    try {
        const types = {};
        properties.forEach(p => {
            types[p.type] = (types[p.type] || 0) + 1;
        });
        
        const typeListEl = document.getElementById('type-list');
        if (typeListEl) {
            typeListEl.innerHTML = Object.entries(types)
                .map(([t,n]) => `<div class="county-item" data-type="${sanitizeInput(t)}"><span>${sanitizeInput(t)}</span><span class="county-count">${n}</span></div>`)
                .join('');
        }
    } catch (error) {
        console.error('Error rendering type list:', error);
    }
}

function getFiltered() {
    let f = properties.filter(p => {
        const stageOk = currentFilter === 'all' ||
            (currentFilter === 'ready' && p.stage === 'Ready to Blast') ||
            (currentFilter === 'new' && p.stage === 'New') ||
            (currentFilter === 'hold' && p.stage === 'On Hold') ||
            (currentFilter === 'high' && p.stage === 'Too High') ||
            (currentFilter === 'sold' && p.stage === 'Sold');
        
        const countyOk = !countyFilter || p.county === countyFilter;
        const typeOk = !typeFilter || p.type === typeFilter;
        
        const searchOk = !searchTerm ||
            p.address.toLowerCase().includes(searchTerm) ||
            p.city.toLowerCase().includes(searchTerm) ||
            (p.county && p.county.toLowerCase().includes(searchTerm)) ||
            (p.notes && p.notes.toLowerCase().includes(searchTerm));
        
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

function setFilter(f) {
    currentFilter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-filter="${f}"]`);
    if (btn) btn.classList.add('active');
    refresh();
}

function handleSort() {
    const selectEl = document.getElementById('sort-select');
    if (!selectEl) return;
    
    const [f,d] = selectEl.value.split('-');
    sortField = f;
    sortDirection = d;
    refresh();
}

function updateFilterCounts() {
    try {
        const all = properties.length;
        const ready = properties.filter(p => p.stage === 'Ready to Blast').length;
        const newC = properties.filter(p => p.stage === 'New').length;
        const hold = properties.filter(p => p.stage === 'On Hold').length;
        const high = properties.filter(p => p.stage === 'Too High').length;
        const sold = properties.filter(p => p.stage === 'Sold').length;

        const allCountEl = document.getElementById('all-count');
        const readyCountEl = document.getElementById('ready-count');
        const newCountEl = document.getElementById('new-count');
        const holdCountEl = document.getElementById('hold-count');
        const highCountEl = document.getElementById('high-count');
        const soldCountEl = document.getElementById('sold-count');

        if (allCountEl) allCountEl.textContent = all;
        if (readyCountEl) readyCountEl.textContent = ready;
        if (newCountEl) newCountEl.textContent = newC;
        if (holdCountEl) holdCountEl.textContent = hold;
        if (highCountEl) highCountEl.textContent = high;
        if (soldCountEl) soldCountEl.textContent = sold;

        // Update header total
        const totalEl = document.getElementById('total-count');
        if (totalEl) totalEl.textContent = all + ' properties';
    } catch (error) {
        console.error('Error updating filter counts:', error);
    }
}

// ========== DROPDOWN & SIDEBAR UI ==========

function toggleDropdown() {
    const menu = document.getElementById('header-dropdown');
    if (menu) menu.classList.toggle('open');
}

function closeDropdown() {
    const menu = document.getElementById('header-dropdown');
    if (menu) menu.classList.remove('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.dropdown')) {
        closeDropdown();
    }
});

function toggleSidebarSection(btn) {
    const section = btn.closest('.sidebar-section');
    if (section) section.classList.toggle('collapsed');
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const expandBtn = document.getElementById('sidebar-expand-btn');
    if (!sidebar) return;

    const isCollapsed = sidebar.classList.toggle('collapsed');

    // Show/hide the external expand button
    if (expandBtn) {
        expandBtn.classList.toggle('visible', isCollapsed);
    }

    // Re-render map if visible so it fills the new space
    if (map) {
        setTimeout(() => {
            map.invalidateSize();
        }, 300);
    }
}

// ========== BULK OPERATIONS ==========

function toggleBulkMode() {
    bulkMode = !bulkMode;
    selectedProperties.clear();
    document.body.classList.toggle('bulk-mode', bulkMode);
    
    const bulkActionsEl = document.getElementById('bulk-actions');
    if (bulkActionsEl) {
        bulkActionsEl.classList.toggle('active', bulkMode);
    }
    
    document.querySelectorAll('.bulk-col').forEach(el => {
        el.style.display = bulkMode ? 'table-cell' : 'none';
    });
    
    updateSelectedCount();
    refresh();
}

function togglePropertySelection(id, e) {
    if (e) e.stopPropagation();
    
    selectedProperties.has(id) ? selectedProperties.delete(id) : selectedProperties.add(id);
    updateSelectedCount();
    refresh();
}

function toggleSelectAll() {
    const f = getFiltered();
    if (selectedProperties.size === f.length) {
        selectedProperties.clear();
    } else {
        f.forEach(p => selectedProperties.add(p.id));
    }
    updateSelectedCount();
    refresh();
}

function updateSelectedCount() {
    const countEl = document.getElementById('selected-count');
    if (countEl) {
        countEl.textContent = `${selectedProperties.size} selected`;
    }
    
    const allCheckboxes = document.querySelectorAll('#select-all-checkbox, #list-select-all');
    allCheckboxes.forEach(cb => {
        cb.checked = selectedProperties.size === getFiltered().length && selectedProperties.size > 0;
    });
}

function applyBulkStatus() {
    const selectEl = document.getElementById('bulk-status-select');
    if (!selectEl) return;
    
    const s = selectEl.value;
    if (!s || !selectedProperties.size) {
        return showToast('Select properties and status', 'error');
    }
    
    try {
        properties.forEach(p => {
            if (selectedProperties.has(p.id)) {
                p.stage = s;
                p.lastUpdated = new Date().toISOString();
            }
        });
        
        saveProperties();
        updateStats();
        refresh();
        
        showToast(`Updated ${selectedProperties.size} to ${statusMap[s].label}`, 'success');
        selectedProperties.clear();
        selectEl.value = '';
        updateSelectedCount();
    } catch (error) {
        console.error('Bulk status update error:', error);
        showToast('Failed to update properties', 'error');
    }
}

function bulkDelete() {
    if (!selectedProperties.size) {
        return showToast('Select properties', 'error');
    }
    
    if (!confirm(`Delete ${selectedProperties.size} properties?`)) return;
    
    try {
        properties = properties.filter(p => !selectedProperties.has(p.id));
        saveProperties();
        updateStats();
        renderCountyList();
        renderTypeList();
        refresh();
        
        showToast(`Deleted ${selectedProperties.size}`, 'info');
        selectedProperties.clear();
        updateSelectedCount();
    } catch (error) {
        console.error('Bulk delete error:', error);
        showToast('Failed to delete properties', 'error');
    }
}

// ========== RENDERING ==========

function renderGrid() {
    try {
        const f = getFiltered();
        const gridEl = document.getElementById('property-grid');

        if (!gridEl) return;

        if (f.length === 0) {
            gridEl.innerHTML = `<div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div class="empty-state-text">No properties found</div>
                <div class="empty-state-hint">${searchTerm || currentFilter !== 'all' || countyFilter || typeFilter ? 'Try adjusting your filters' : 'Click "+ Add Property" to get started'}</div>
            </div>`;
            return;
        }

        gridEl.innerHTML = f.map(p => {
            const days = getDaysSinceAdded(p.dateAdded);
            const sel = selectedProperties.has(p.id);
            
            let det = '';
            if (p.beds || p.baths) {
                det = `<div class="card-details">
                    ${p.beds ? `<div class="detail-item"><div class="detail-value">${p.beds}</div><div class="detail-label">Beds</div></div>` : ''}
                    ${p.baths ? `<div class="detail-item"><div class="detail-value">${p.baths}</div><div class="detail-label">Baths</div></div>` : ''}
                    ${p.sqft ? `<div class="detail-item"><div class="detail-value">${p.sqft.toLocaleString()}</div><div class="detail-label">Sq Ft</div></div>` : ''}
                </div>`;
            }
            
            return `<div class="property-card ${sel ? 'selected' : ''}" onclick="${bulkMode ? `togglePropertySelection('${p.id}', event)` : `openPanel('${p.id}')`}">
                <input type="checkbox" class="card-checkbox" ${sel ? 'checked' : ''} onclick="togglePropertySelection('${p.id}', event)">
                <div class="card-header">
                    <div>
                        <div class="card-address">${sanitizeInput(p.address)}</div>
                        <div class="card-location">${sanitizeInput(p.city)}, PA${p.zip ? ' ' + sanitizeInput(p.zip) : ''}</div>
                    </div>
                    <div class="card-status ${statusMap[p.stage].class}">${statusMap[p.stage].label}</div>
                </div>
                <div class="card-body">
                    ${det}
                    <div class="card-tags">
                        <span class="tag tag-type">${sanitizeInput(p.type)}</span>
                        ${p.county ? `<span class="tag tag-county">${sanitizeInput(p.county)}</span>` : ''}
                        ${days !== null ? `<span class="tag tag-days">${days}d ago</span>` : ''}
                        ${!p.lat || !p.lng ? '<span class="tag tag-nogeo">No Map</span>' : ''}
                        ${p.arv && p.arv > 0 ? `<span class="tag tag-arv">ARV: ${formatCurrency(p.arv)}</span>` : ''}
                    </div>
                    <div class="card-asking">
                        <div class="asking-price">${formatCurrency(p.asking)}</div>
                        <div class="card-actions">
                            ${p.pictures ? `<a class="card-btn" href="${sanitizeInput(p.pictures)}" target="_blank" onclick="event.stopPropagation()">Photos</a>` : ''}
                        </div>
                    </div>
                    ${p.notes ? `<div class="card-notes-preview">${sanitizeInput(p.notes)}</div>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch (error) {
        console.error('Error rendering grid:', error);
        showToast('Error displaying properties', 'error');
    }
}

function renderList() {
    try {
        const f = getFiltered();
        const listBodyEl = document.getElementById('list-body');
        
        if (!listBodyEl) return;
        
        listBodyEl.innerHTML = f.map(p => {
            const days = getDaysSinceAdded(p.dateAdded);
            const sel = selectedProperties.has(p.id);
            
            return `<tr class="${sel ? 'selected' : ''}" onclick="${bulkMode ? `togglePropertySelection('${p.id}', event)` : `openPanel('${p.id}')`}">
                <td class="bulk-col" style="display:${bulkMode ? 'table-cell' : 'none'}">
                    <input type="checkbox" ${sel ? 'checked' : ''} onclick="togglePropertySelection('${p.id}', event)">
                </td>
                <td><strong>${sanitizeInput(p.address)}</strong></td>
                <td>${sanitizeInput(p.city)}</td>
                <td>${p.county ? sanitizeInput(p.county) : '-'}</td>
                <td>${sanitizeInput(p.type)}</td>
                <td>${p.beds || '-'}/${p.baths || '-'}</td>
                <td><strong style="color:var(--green)">${formatCurrency(p.asking)}</strong></td>
                <td style="font-size:0.8rem;color:var(--text-secondary)">${days !== null ? days : '-'}</td>
                <td><span class="list-status ${statusMap[p.stage].class}">${statusMap[p.stage].label}</span></td>
                <td>${p.pictures ? `<a class="link-btn" href="${sanitizeInput(p.pictures)}" target="_blank" onclick="event.stopPropagation()">View</a>` : '<span class="link-btn disabled">None</span>'}</td>
            </tr>`;
        }).join('');
    } catch (error) {
        console.error('Error rendering list:', error);
        showToast('Error displaying list', 'error');
    }
}

// ========== MAP ==========

function initMap() {
    try {
        const mapEl = document.getElementById('map');
        if (!mapEl) return;
        
        map = L.map('map').setView([40.3, -79.5], 7);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '©OpenStreetMap, ©CartoDB'
        }).addTo(map);
        
        markerLayer = L.layerGroup().addTo(map);
        renderMarkers();
    } catch (error) {
        console.error('Map initialization error:', error);
        showToast('Map failed to load', 'warning');
    }
}

function createIcon(color) {
    return L.divIcon({
        className: 'custom-marker',
        html: `<svg width="24" height="32" viewBox="0 0 24 32">
            <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20c0-6.6-5.4-12-12-12z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
            <circle cx="12" cy="12" r="5" fill="#fff"/>
        </svg>`,
        iconSize: [24, 32],
        iconAnchor: [12, 32],
        popupAnchor: [0, -32]
    });
}

function renderMarkers() {
    if (!map || !markerLayer) return;
    
    try {
        markerLayer.clearLayers();
        const f = getFiltered();
        const bounds = [];
        
        f.forEach(p => {
            if (!p.lat || !p.lng) return;
            
            const m = L.marker([p.lat, p.lng], {
                icon: createIcon(statusMap[p.stage].color)
            }).bindPopup(`
                <div class="map-popup">
                    <div class="popup-header">${sanitizeInput(p.address)}</div>
                    <div class="popup-location">${sanitizeInput(p.city)}, PA ${p.zip || ''}</div>
                    <div class="popup-details">
                        <span>${sanitizeInput(p.type)}</span> • <span>${p.beds || '-'}bd/${p.baths || '-'}ba</span>
                    </div>
                    <div class="popup-price">${formatCurrency(p.asking)}</div>
                </div>
            `);
            
            markerLayer.addLayer(m);
            bounds.push([p.lat, p.lng]);
        });
        
        if (bounds.length) {
            map.fitBounds(bounds, { padding: [20, 20] });
        }
    } catch (error) {
        console.error('Error rendering markers:', error);
    }
}

// ========== DETAIL PANEL ==========

function openPanel(id) {
    const p = properties.find(x => String(x.id) === String(id));
    if (!p) return;
    
    editingPropertyId = id;
    isEditMode = false;
    
    const addrEl = document.getElementById('panel-address');
    const locEl = document.getElementById('panel-location');
    
    if (addrEl) addrEl.textContent = p.address;
    if (locEl) locEl.textContent = `${p.city}, PA ${p.zip || ''} • ${p.county || 'No County'}`;
    
    renderPanelContent(p);
    
    const panelEl = document.getElementById('detail-panel');
    const overlayEl = document.getElementById('overlay');
    
    if (panelEl) panelEl.classList.add('open');
    if (overlayEl) overlayEl.classList.add('open');
}

function renderPanelContent(p) {
    const contentEl = document.getElementById('panel-content');
    if (!contentEl) return;
    
    try {
        const days = getDaysSinceAdded(p.dateAdded);
        const editBtn = !isEditMode ?
            `<button class="btn btn-secondary" style="margin-left:auto" onclick="toggleEditMode()">Edit</button>` :
            `<div style="display:flex;gap:8px;margin-left:auto">
                <button class="btn btn-secondary" onclick="cancelEdit()">Cancel</button>
                <button class="btn btn-primary" onclick="saveEdit()">Save</button>
            </div>`;
        
        const spread = p.arv && p.asking ? p.arv - p.asking - (p.rehab || 0) : null;
        contentEl.innerHTML = `
            <div class="panel-summary">
                <div class="panel-summary-item">
                    <div class="panel-summary-value">${formatCurrency(p.asking)}</div>
                    <div class="panel-summary-label">Asking</div>
                </div>
                <div class="panel-summary-item">
                    <div class="panel-summary-value${!p.arv ? ' muted' : ''}">${p.arv ? formatCurrency(p.arv) : '—'}</div>
                    <div class="panel-summary-label">ARV</div>
                </div>
                <div class="panel-summary-item">
                    <div class="panel-summary-value${spread === null ? ' muted' : ''}" style="${spread !== null && spread > 0 ? 'color:var(--green)' : spread !== null ? 'color:var(--red)' : ''}">${spread !== null ? formatCurrency(spread) : '—'}</div>
                    <div class="panel-summary-label">Spread</div>
                </div>
            </div>
            <div class="detail-section">
                <h3>Deal Status</h3>
                <div class="status-selector">
                    <label>Change Status</label>
                    <select class="status-dropdown" id="edit-stage" ${!isEditMode ? `onchange="changePropertyStatus('${p.id}', this.value)"` : ''}>
                        <option value="New" ${p.stage === 'New' ? 'selected' : ''}>New / Needs Sheet</option>
                        <option value="Ready to Blast" ${p.stage === 'Ready to Blast' ? 'selected' : ''}>Ready to Blast</option>
                        <option value="On Hold" ${p.stage === 'On Hold' ? 'selected' : ''}>On Hold</option>
                        <option value="Too High" ${p.stage === 'Too High' ? 'selected' : ''}>Too High</option>
                        <option value="Sold" ${p.stage === 'Sold' ? 'selected' : ''}>Sold</option>
                    </select>
                </div>
                <div class="edit-mode-toggle">${editBtn}</div>
            </div>
            <div class="detail-section">
                <h3>Dates</h3>
                <div class="detail-grid">
                    <div class="detail-field">
                        <div class="field-label">Date Added</div>
                        <div class="field-value">${formatDate(p.dateAdded)}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Days Since Added</div>
                        <div class="field-value">${days !== null ? days + ' days' : '-'}</div>
                    </div>
                </div>
            </div>
            <div class="detail-section">
                <h3>Property Details</h3>
                <div class="detail-grid">
                    <div class="detail-field">
                        <div class="field-label">Type</div>
                        ${isEditMode ? `
                            <select id="edit-type" class="inline-input">
                                <option value="SFH" ${p.type === 'SFH' ? 'selected' : ''}>SFH</option>
                                <option value="MFH" ${p.type === 'MFH' ? 'selected' : ''}>MFH</option>
                                <option value="Lot" ${p.type === 'Lot' ? 'selected' : ''}>Lot</option>
                                <option value="Unknown" ${p.type === 'Unknown' ? 'selected' : ''}>Unknown</option>
                            </select>
                        ` : `<div class="field-value">${sanitizeInput(p.type)}</div>`}
                    </div>
                    <div class="detail-field">
                        <div class="field-label">County</div>
                        ${isEditMode ?
                            `<input type="text" id="edit-county" value="${p.county || ''}" class="inline-input">` :
                            `<div class="field-value${!p.county ? ' muted' : ''}">${p.county ? sanitizeInput(p.county) : 'Not set'}</div>`
                        }
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Beds</div>
                        ${isEditMode ?
                            `<input type="number" id="edit-beds" value="${p.beds || ''}" class="inline-input" min="0" max="50">` :
                            `<div class="field-value${!p.beds ? ' muted' : ''}">${p.beds || '-'}</div>`
                        }
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Baths</div>
                        ${isEditMode ?
                            `<input type="number" id="edit-baths" value="${p.baths || ''}" step="0.5" class="inline-input" min="0" max="50">` :
                            `<div class="field-value${!p.baths ? ' muted' : ''}">${p.baths || '-'}</div>`
                        }
                    </div>
                </div>
            </div>
            <div class="detail-section">
                <h3>Deal Numbers</h3>
                <div class="detail-grid">
                    <div class="detail-field">
                        <div class="field-label">Asking Price</div>
                        ${isEditMode ?
                            `<input type="number" id="edit-asking" value="${p.asking || ''}" class="inline-input" min="0">` :
                            `<div class="field-value large">${formatCurrency(p.asking)}</div>`
                        }
                    </div>
                    <div class="detail-field">
                        <div class="field-label">ARV</div>
                        ${isEditMode ?
                            `<input type="number" id="edit-arv" value="${p.arv || ''}" class="inline-input" min="0">` :
                            `<div class="field-value${!p.arv ? ' muted' : ''}">${p.arv ? formatCurrency(p.arv) : 'Not set'}</div>`
                        }
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Rehab</div>
                        ${isEditMode ?
                            `<input type="number" id="edit-rehab" value="${p.rehab || ''}" class="inline-input" min="0">` :
                            `<div class="field-value${!p.rehab ? ' muted' : ''}">${p.rehab ? formatCurrency(p.rehab) : 'Not set'}</div>`
                        }
                    </div>
                    ${p.arv && p.asking ? `
                        <div class="detail-field">
                            <div class="field-label">Spread</div>
                            <div class="field-value" style="color:var(--green)">${formatCurrency(p.arv - p.asking - (p.rehab || 0))}</div>
                        </div>
                    ` : ''}
                </div>
            </div>
            <div class="detail-section">
                <h3>Access</h3>
                <div class="detail-field full">
                    <div class="field-label">Lockbox / Entry</div>
                    ${isEditMode ?
                        `<input type="text" id="edit-access" value="${p.access || ''}" class="inline-input">` :
                        `<div class="field-value${!p.access ? ' muted' : ''}">${p.access ? sanitizeInput(p.access) : 'Not specified'}</div>`
                    }
                </div>
            </div>
            <div class="detail-section">
                <h3>Links & Documents</h3>
                <div class="detail-grid">
                    <div class="detail-field full">
                        <div class="field-label">Photos Link</div>
                        ${isEditMode ?
                            `<input type="url" id="edit-pictures" value="${p.pictures || ''}" class="inline-input">` :
                            `<div class="field-value">${p.pictures ? `<a href="${sanitizeInput(p.pictures)}" target="_blank" style="color:var(--accent)">View Photos</a>` : '<span class="muted">No photos</span>'}</div>`
                        }
                    </div>
                    <div class="detail-field full">
                        <div class="field-label">Contract</div>
                        <div id="panel-contract-doc">${renderDocField(p, 'contract')}</div>
                    </div>
                    <div class="detail-field full">
                        <div class="field-label">Investor Sheet</div>
                        <div id="panel-investor-doc">${renderDocField(p, 'investor')}</div>
                    </div>
                </div>
            </div>
            <div class="detail-section">
                <h3>Notes</h3>
                ${isEditMode ?
                    `<textarea id="edit-notes" class="inline-input" style="min-height:100px">${p.notes || ''}</textarea>` :
                    (p.notes ? `<div class="notes-box">${sanitizeInput(p.notes)}</div>` : `<div class="notes-box muted">No notes</div>`)
                }
            </div>
            ${!isEditMode ? `
                <div class="action-buttons">
                    ${p.pictures ? `<a href="${sanitizeInput(p.pictures)}" target="_blank" class="action-btn primary">View Photos</a>` : ''}
                    <button class="action-btn secondary" onclick="copyAddress('${sanitizeInput(p.address)}, ${sanitizeInput(p.city)}, PA ${p.zip || ''}')">Copy Address</button>
                </div>
                <button class="btn btn-danger" style="width:100%;margin-top:12px" onclick="deleteProperty('${p.id}')">Delete Property</button>
            ` : ''}
        `;
    } catch (error) {
        console.error('Error rendering panel content:', error);
        contentEl.innerHTML = '<div class="error">Failed to load property details</div>';
    }
}

// ========== PDF UPLOAD / DOWNLOAD (Base64 in Firestore) ==========

function renderDocField(p, type) {
    const fileKey = type === 'contract' ? 'contractFile' : 'investorFile';
    const linkKey = type === 'contract' ? 'contractLink' : 'investorSheetLink';
    const file = p[fileKey];
    const link = p[linkKey];

    if (file && file.data) {
        return `<div class="doc-file-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span class="doc-file-name" style="cursor:pointer" onclick="downloadDocument('${p.id}', '${type}')">${sanitizeInput(file.name)}</span>
            <span class="doc-file-size">${formatFileSize(file.size)}</span>
            <button class="doc-download-btn" onclick="downloadDocument('${p.id}', '${type}')" title="Download">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="doc-delete-btn" onclick="deleteDocument('${p.id}', '${type}')" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`;
    }

    if (link) {
        return `<div class="field-value"><a href="${sanitizeInput(link)}" target="_blank" style="color:var(--accent)">View Link</a></div>`;
    }

    return `<div class="doc-upload-inline">
        <label class="doc-upload-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Upload PDF
            <input type="file" accept=".pdf" onchange="uploadDocumentFromPanel(this, '${p.id}', '${type}')" style="display:none">
        </label>
    </div>`;
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function handleFileSelect(input, type) {
    const file = input.files[0];
    const placeholder = document.getElementById(type + '-placeholder');
    const selected = document.getElementById(type + '-selected');
    const filename = document.getElementById(type + '-filename');

    if (file) {
        if (file.type !== 'application/pdf') {
            showToast('Only PDF files are allowed', 'error');
            input.value = '';
            return;
        }
        if (file.size > 500 * 1024) {
            showToast('File must be under 500KB (stored in database)', 'error');
            input.value = '';
            return;
        }
        if (placeholder) placeholder.style.display = 'none';
        if (selected) selected.style.display = 'flex';
        if (filename) filename.textContent = file.name + ' (' + formatFileSize(file.size) + ')';
    }
}

function clearFileSelect(type) {
    const input = document.getElementById('form-' + type + '-file');
    const placeholder = document.getElementById(type + '-placeholder');
    const selected = document.getElementById(type + '-selected');

    if (input) input.value = '';
    if (placeholder) placeholder.style.display = 'flex';
    if (selected) selected.style.display = 'none';
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]); // strip data:...;base64, prefix
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function uploadPDF(file) {
    try {
        const base64 = await readFileAsBase64(file);
        return {
            name: file.name,
            size: file.size,
            data: base64,
            uploadedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error reading file:', error);
        showToast('Failed to read file', 'error');
        return null;
    }
}

function downloadDocument(propertyId, docType) {
    const p = properties.find(x => String(x.id) === String(propertyId));
    if (!p) return;

    const fileKey = docType === 'contract' ? 'contractFile' : 'investorFile';
    const file = p[fileKey];
    if (!file || !file.data) return;

    try {
        const byteChars = atob(file.data);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Download error:', error);
        showToast('Failed to download file', 'error');
    }
}

async function uploadDocumentFromPanel(input, propertyId, docType) {
    const file = input.files[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
        showToast('Only PDF files are allowed', 'error');
        input.value = '';
        return;
    }
    if (file.size > 500 * 1024) {
        showToast('File must be under 500KB (stored in database)', 'error');
        input.value = '';
        return;
    }

    const p = properties.find(x => String(x.id) === String(propertyId));
    if (!p) return;

    const fileKey = docType === 'contract' ? 'contractFile' : 'investorFile';
    const containerEl = document.getElementById('panel-' + docType + '-doc');
    if (containerEl) containerEl.innerHTML = '<div class="doc-uploading"><div class="spinner"></div> Saving...</div>';

    try {
        const fileData = await uploadPDF(file);
        if (fileData) {
            p[fileKey] = fileData;
            saveProperties();
            if (containerEl) containerEl.innerHTML = renderDocField(p, docType);
            showToast('Uploaded!', 'success');
        }
    } catch (error) {
        console.error('Upload error:', error);
        if (containerEl) containerEl.innerHTML = renderDocField(p, docType);
    }
}

function deleteDocument(propertyId, docType) {
    if (!confirm('Remove this document?')) return;

    const p = properties.find(x => String(x.id) === String(propertyId));
    if (!p) return;

    const fileKey = docType === 'contract' ? 'contractFile' : 'investorFile';
    p[fileKey] = null;
    saveProperties();

    const containerEl = document.getElementById('panel-' + docType + '-doc');
    if (containerEl) containerEl.innerHTML = renderDocField(p, docType);
    showToast('Document removed', 'info');
}

function closePanel() {
    const panelEl = document.getElementById('detail-panel');
    const overlayEl = document.getElementById('overlay');
    
    if (panelEl) panelEl.classList.remove('open');
    if (overlayEl) overlayEl.classList.remove('open');
}

function copyAddress(a) {
    navigator.clipboard.writeText(a);
    showToast('Copied!', 'success');
}

function toggleEditMode() {
    isEditMode = true;
    const p = properties.find(x => x.id === editingPropertyId);
    if (p) renderPanelContent(p);
}

function cancelEdit() {
    isEditMode = false;
    const p = properties.find(x => x.id === editingPropertyId);
    if (p) renderPanelContent(p);
}

function saveEdit() {
    const p = properties.find(x => String(x.id) === String(editingPropertyId));
    if (!p) return;
    
    try {
        // Collect data from form
        const data = {
            address: p.address, // Keep original
            city: p.city, // Keep original
            stage: document.getElementById('edit-stage').value,
            type: document.getElementById('edit-type').value,
            county: document.getElementById('edit-county').value || null,
            beds: document.getElementById('edit-beds').value ? parseInt(document.getElementById('edit-beds').value) : null,
            baths: document.getElementById('edit-baths').value ? parseFloat(document.getElementById('edit-baths').value) : null,
            asking: document.getElementById('edit-asking').value ? parseInt(document.getElementById('edit-asking').value) : null,
            arv: document.getElementById('edit-arv').value ? parseInt(document.getElementById('edit-arv').value) : null,
            rehab: document.getElementById('edit-rehab').value ? parseInt(document.getElementById('edit-rehab').value) : null,
            access: document.getElementById('edit-access').value || null,
            pictures: document.getElementById('edit-pictures').value || null,
            notes: document.getElementById('edit-notes')?.value || p.notes
        };
        
        // Validate
        const errors = validatePropertyData(data);
        if (errors.length > 0) {
            showToast(errors[0], 'error');
            return;
        }
        
        // Apply changes
        Object.assign(p, data);
        p.lastUpdated = new Date().toISOString();
        
        saveProperties();
        updateStats();
        renderCountyList();
        refresh();
        
        isEditMode = false;
        renderPanelContent(p);
        showToast('Updated!', 'success');
    } catch (error) {
        console.error('Error saving edit:', error);
        showToast('Failed to save changes', 'error');
    }
}

function deleteProperty(id) {
    if (!confirm('Delete?')) return;
    
    try {
        properties = properties.filter(p => String(p.id) !== String(id));
        saveProperties();
        updateStats();
        renderCountyList();
        renderTypeList();
        refresh();
        closePanel();
        showToast('Deleted', 'info');
    } catch (error) {
        console.error('Delete error:', error);
        showToast('Failed to delete property', 'error');
    }
}

function changePropertyStatus(id, s) {
    const p = properties.find(x => String(x.id) === String(id));
    if (!p) return;
    
    try {
        p.stage = s;
        p.lastUpdated = new Date().toISOString();
        
        saveProperties();
        updateStats();
        refresh();
        
        if (!isEditMode) openPanel(id);
        showToast(`Status: ${statusMap[s].label}`, 'success');
    } catch (error) {
        console.error('Status change error:', error);
        showToast('Failed to change status', 'error');
    }
}

// ========== ADD PROPERTY MODAL ==========

function openAddPropertyModal() {
    const modalEl = document.getElementById('add-property-modal');
    if (modalEl) modalEl.classList.add('open');
    
    resetPropertyForm();
    showGeocodingStatus('');
    
    const dupWarning = document.getElementById('duplicate-warning');
    if (dupWarning) dupWarning.innerHTML = '';
    
    parsedDeals = [];
    
    const previewSection = document.getElementById('preview-section');
    if (previewSection) previewSection.classList.remove('active');
}

function closeAddPropertyModal() {
    const modalEl = document.getElementById('add-property-modal');
    if (modalEl) modalEl.classList.remove('open');
}

function switchModalTab(tab) {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    if (tab === 'manual') {
        const tabs = document.querySelectorAll('.modal-tab');
        if (tabs[0]) tabs[0].classList.add('active');
        
        const manualTab = document.getElementById('manual-tab');
        if (manualTab) manualTab.classList.add('active');
    } else {
        const tabs = document.querySelectorAll('.modal-tab');
        if (tabs[1]) tabs[1].classList.add('active');
        
        const pasteTab = document.getElementById('paste-tab');
        if (pasteTab) pasteTab.classList.add('active');
    }
}

function resetPropertyForm() {
    const formEl = document.getElementById('property-form');
    if (formEl) formEl.reset();
    
    const textInput = document.getElementById('deal-text-input');
    if (textInput) textInput.value = '';
    
    const latEl = document.getElementById('form-lat');
    const lngEl = document.getElementById('form-lng');
    if (latEl) latEl.value = '';
    if (lngEl) lngEl.value = '';
}

// ========== PASTE PARSER ==========

function parseDealText() {
    const textEl = document.getElementById('deal-text-input');
    if (!textEl) return;
    
    const text = textEl.value;
    if (!text.trim()) return showToast('Paste deal text first', 'error');
    
    try {
        const blocks = text.split(/\n\s*\n|---+/).filter(b => b.trim());
        parsedDeals = [];
        
        blocks.forEach((block, i) => {
            const d = parseBlock(block);
            if (d.address) {
                d._index = i;
                parsedDeals.push(d);
            }
        });
        
        if (!parsedDeals.length) {
            return showToast('Could not parse', 'error');
        }
        
        renderPreviewTable();
        
        const previewSection = document.getElementById('preview-section');
        if (previewSection) previewSection.classList.add('active');
        
        showToast(`Parsed ${parsedDeals.length} deal(s)`, 'success');
    } catch (error) {
        console.error('Parse error:', error);
        showToast('Failed to parse deals', 'error');
    }
}

function parseBlock(block) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);
    
    let address = '', city = '', zip = '', county = '';
    let beds = null, baths = null, asking = null;
    let access = null, pictures = null, arv = null;
    let notes = [];
    
    for (const line of lines) {
        const lower = line.toLowerCase();
        
        // Parse address line
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
        
        // Parse county
        if (lower.includes('county')) {
            county = line.replace(/county/i, '').trim();
            continue;
        }
        
        // Parse beds/baths
        const bm = line.match(/(\d+)\s*(?:br|bed)/i);
        const btm = line.match(/(\d+\.?\d*)\s*(?:ba|bath)/i);
        if (bm) beds = parseInt(bm[1]);
        if (btm) baths = parseFloat(btm[1]);
        if (bm || btm) continue;
        
        // Parse ARV (check BEFORE generic K-format prices to avoid
        // "ARV 275k" being consumed as asking price)
        if (lower.includes('arv') || lower.includes('worth')) {
            const a = line.match(/(\d+\.?\d*)\s*k/i);
            if (a) {
                arv = Math.round(parseFloat(a[1]) * 1000);
                continue;
            }
        }

        // Parse asking price
        if (lower.includes('asking') || lower.match(/\$?\d+\.?\d*k/i)) {
            const k = line.match(/(\d+\.?\d*)\s*k/i);
            if (k) {
                asking = Math.round(parseFloat(k[1]) * 1000);
                continue;
            }
        }
        
        // Parse access
        if (lower.includes('access') || lower.includes('lockbox') || lower.includes('door') || lower.includes('code')) {
            access = line.replace(/access:?/i, '').trim();
            continue;
        }
        
        // Parse photos link
        if (lower.includes('dropbox') || lower.includes('photos') || lower.includes('pics') || line.match(/https?:\/\//)) {
            const u = line.match(/(https?:\/\/[^\s]+)/);
            if (u) {
                pictures = u[1];
                continue;
            }
        }
        
        // Everything else is notes
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

function renderPreviewTable() {
    const previewBodyEl = document.getElementById('preview-body');
    if (!previewBodyEl) return;
    
    previewBodyEl.innerHTML = parsedDeals.map((d,i) => `
        <tr>
            <td>
                <strong>${sanitizeInput(d.address)}</strong><br>
                <small style="color:var(--text-muted)">${sanitizeInput(d.city)}</small>
            </td>
            <td>${d.asking ? formatCurrency(d.asking) : '-'}</td>
            <td>${d.beds || '-'}/${d.baths || '-'}</td>
            <td>${d.county ? sanitizeInput(d.county) : '-'}</td>
            <td>${d.pictures ? 'Yes' : 'No'}</td>
            <td>${d.arv ? formatCurrency(d.arv) : 'No'}</td>
            <td class="preview-actions">
                <button class="preview-btn edit" onclick="editParsedDeal(${i})">Edit</button>
                <button class="preview-btn remove" onclick="removeParsedDeal(${i})">X</button>
            </td>
        </tr>
    `).join('');
    
    const countEl = document.getElementById('preview-count');
    if (countEl) countEl.textContent = `${parsedDeals.length} properties`;
}

function editParsedDeal(i) {
    if (i < 0 || i >= parsedDeals.length) return;
    
    const d = parsedDeals[i];
    
    document.getElementById('form-address').value = d.address || '';
    document.getElementById('form-city').value = d.city || '';
    document.getElementById('form-zip').value = d.zip || '';
    document.getElementById('form-county').value = d.county || '';
    document.getElementById('form-beds').value = d.beds || '';
    document.getElementById('form-baths').value = d.baths || '';
    document.getElementById('form-asking').value = d.asking || '';
    document.getElementById('form-arv').value = d.arv || '';
    document.getElementById('form-access').value = d.access || '';
    document.getElementById('form-pictures').value = d.pictures || '';
    document.getElementById('form-notes').value = d.notes || '';
    
    parsedDeals.splice(i, 1);
    renderPreviewTable();
    switchModalTab('manual');
    showToast('Deal loaded', 'info');
}

function removeParsedDeal(i) {
    if (i < 0 || i >= parsedDeals.length) return;
    
    parsedDeals.splice(i, 1);
    renderPreviewTable();
    
    if (!parsedDeals.length) {
        const previewSection = document.getElementById('preview-section');
        if (previewSection) previewSection.classList.remove('active');
    }
}

function clearParsed() {
    parsedDeals = [];
    
    const previewSection = document.getElementById('preview-section');
    if (previewSection) previewSection.classList.remove('active');
    
    const textInput = document.getElementById('deal-text-input');
    if (textInput) textInput.value = '';
}

async function saveAllParsed() {
    if (!parsedDeals.length) return showToast('No deals', 'error');
    
    try {
        const cnt = parsedDeals.length;
        const now = new Date().toISOString();
        
        showToast(`Saving ${cnt}...`, 'info');
        
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
                lastUpdated: now
            });
        }
        
        saveProperties();
        updateStats();
        renderCountyList();
        renderTypeList();
        refresh();
        
        parsedDeals = [];
        
        const previewSection = document.getElementById('preview-section');
        if (previewSection) previewSection.classList.remove('active');
        
        const textInput = document.getElementById('deal-text-input');
        if (textInput) textInput.value = '';
        
        closeAddPropertyModal();
        showToast(`Saved ${cnt}!`, 'success');
    } catch (error) {
        console.error('Batch save error:', error);
        showToast('Failed to save deals', 'error');
    }
}

// ========== SAVE PROPERTY ==========

async function autoFillCounty() {
    const addr = document.getElementById('form-address').value;
    const city = document.getElementById('form-city').value;
    const zip = document.getElementById('form-zip').value;
    
    if (!addr || !city) return;
    
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${addr}, ${city}, PA${zip ? ' ' + zip : ''}`)}&format=json&addressdetails=1&limit=1`, {
            headers: { 'User-Agent': 'JiwaniPropertySolutions/1.0' }
        });
        
        if (!r.ok) return;
        
        const data = await r.json();
        if (data && data.length) {
            let county = data[0].address?.county?.replace(/ County$/i, '').trim();
            if (county) {
                const countyEl = document.getElementById('form-county');
                if (countyEl) countyEl.value = county;
            }
            
            const latEl = document.getElementById('form-lat');
            const lngEl = document.getElementById('form-lng');
            if (latEl) latEl.value = data[0].lat;
            if (lngEl) lngEl.value = data[0].lon;
        }
    } catch (e) {
        console.error('Auto-fill county error:', e);
    }
}

async function saveProperty(e) {
    e.preventDefault();
    
    const btn = document.getElementById('save-property-btn');
    if (!btn) return;
    
    btn.disabled = true;
    btn.textContent = 'Saving...';
    
    try {
        const addr = sanitizeInput(document.getElementById('form-address').value);
        const city = sanitizeInput(document.getElementById('form-city').value);
        const zip = sanitizeInput(document.getElementById('form-zip').value) || null;
        
        // Validate required fields
        if (!addr || !city) {
            showToast('Address and city are required', 'error');
            btn.disabled = false;
            btn.textContent = 'Save Property';
            return;
        }
        
        // Collect all form data
        const propertyData = {
            address: addr,
            city: city,
            zip: zip,
            county: sanitizeInput(document.getElementById('form-county').value) || null,
            type: document.getElementById('form-type').value,
            beds: document.getElementById('form-beds').value ? parseInt(document.getElementById('form-beds').value) : null,
            baths: document.getElementById('form-baths').value ? parseFloat(document.getElementById('form-baths').value) : null,
            sqft: document.getElementById('form-sqft').value ? parseInt(document.getElementById('form-sqft').value) : null,
            asking: document.getElementById('form-asking').value ? parseInt(document.getElementById('form-asking').value) : null,
            arv: document.getElementById('form-arv').value ? parseInt(document.getElementById('form-arv').value) : null,
            rehab: document.getElementById('form-rehab').value ? parseInt(document.getElementById('form-rehab').value) : null,
            access: sanitizeInput(document.getElementById('form-access').value) || null,
            pictures: sanitizeInput(document.getElementById('form-pictures').value) || null,
            contractLink: null,
            investorSheetLink: null,
            notes: sanitizeInput(document.getElementById('form-notes').value) || null,
            stage: document.getElementById('form-stage').value
        };
        
        // Validate data
        const errors = validatePropertyData(propertyData);
        if (errors.length > 0) {
            showToast(errors[0], 'error');
            btn.disabled = false;
            btn.textContent = 'Save Property';
            return;
        }
        
        // Geocode address
        showGeocodingStatus('loading');
        let lat = null, lng = null, geoPrecision = 'none';
        
        const geo = await geocodeAddress(addr, city, 'PA', zip);
        if (geo.success) {
            lat = geo.lat;
            lng = geo.lng;
            geoPrecision = geo.geoPrecision;
            
            if (!propertyData.county && geo.county) {
                propertyData.county = geo.county;
                const countyEl = document.getElementById('form-county');
                if (countyEl) countyEl.value = geo.county;
            }
            
            showGeocodingStatus('success');
        } else {
            showGeocodingStatus('error');
        }
        
        await new Promise(r => setTimeout(r, 500));
        
        // Create new property
        const now = new Date().toISOString();
        const newId = generateUUID();
        const newProp = {
            id: newId,
            ...propertyData,
            contractFile: null,
            investorFile: null,
            lat,
            lng,
            geoPrecision,
            dateAdded: now,
            lastUpdated: now
        };
        properties.push(newProp);

        saveProperties();
        updateStats();
        renderCountyList();
        renderTypeList();
        refresh();

        // Encode PDFs as Base64 if selected
        const contractFileInput = document.getElementById('form-contract-file');
        const investorFileInput = document.getElementById('form-investor-file');
        const contractFile = contractFileInput && contractFileInput.files[0];
        const investorFile = investorFileInput && investorFileInput.files[0];

        if (contractFile || investorFile) {
            btn.textContent = 'Saving files...';
            try {
                if (contractFile) {
                    const cData = await uploadPDF(contractFile);
                    if (cData) newProp.contractFile = cData;
                }
                if (investorFile) {
                    const iData = await uploadPDF(investorFile);
                    if (iData) newProp.investorFile = iData;
                }
                saveProperties();
            } catch (uploadErr) {
                console.error('File save error:', uploadErr);
                showToast('Property saved but file encoding failed', 'warning');
            }
        }

        btn.disabled = false;
        btn.textContent = 'Save Property';

        const saveAndAddEl = document.getElementById('save-and-add');
        if (saveAndAddEl && saveAndAddEl.checked) {
            resetPropertyForm();
            clearFileSelect('contract');
            clearFileSelect('investor');
            showGeocodingStatus('');
            const dupWarning = document.getElementById('duplicate-warning');
            if (dupWarning) dupWarning.innerHTML = '';
            showToast('Saved! Add another.', 'success');
        } else {
            closeAddPropertyModal();
            showToast('Added!', 'success');
        }
    } catch (error) {
        console.error('Save property error:', error);
        showToast('Failed to save property', 'error');
        btn.disabled = false;
        btn.textContent = 'Save Property';
    }
}

// ========== EVENT LISTENERS ==========

function setupEventListeners() {
    try {
        // Navigation tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                
                const v = this.dataset.view;
                document.querySelectorAll('.grid-view, .list-view, .map-view').forEach(x => x.classList.remove('active'));
                
                const viewEl = document.getElementById(`${v}-view`);
                if (viewEl) viewEl.classList.add('active');
                
                if (v === 'map') {
                    if (map) {
                        setTimeout(() => {
                            map.invalidateSize();
                            renderMarkers();
                        }, 150);
                    } else {
                        setTimeout(() => initMap(), 100);
                    }
                }
            });
        });
        
        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                currentFilter = this.dataset.filter;
                refresh();
            });
        });
        
        // Search input
        const searchEl = document.getElementById('search-input');
        if (searchEl) {
            searchEl.addEventListener('input', function() {
                searchTerm = this.value.toLowerCase();
                refresh();
            });
        }
        
        // County filter
        const countyListEl = document.getElementById('county-list');
        if (countyListEl) {
            countyListEl.addEventListener('click', function(e) {
                const item = e.target.closest('.county-item');
                if (item) {
                    if (item.classList.contains('active')) {
                        item.classList.remove('active');
                        countyFilter = null;
                    } else {
                        document.querySelectorAll('#county-list .county-item').forEach(i => i.classList.remove('active'));
                        item.classList.add('active');
                        countyFilter = item.dataset.county;
                    }
                    refresh();
                }
            });
        }
        
        // Type filter
        const typeListEl = document.getElementById('type-list');
        if (typeListEl) {
            typeListEl.addEventListener('click', function(e) {
                const item = e.target.closest('.county-item');
                if (item) {
                    if (item.classList.contains('active')) {
                        item.classList.remove('active');
                        typeFilter = null;
                    } else {
                        document.querySelectorAll('#type-list .county-item').forEach(i => i.classList.remove('active'));
                        item.classList.add('active');
                        typeFilter = item.dataset.type;
                    }
                    refresh();
                }
            });
        }
        
        // Density buttons
        document.querySelectorAll('.density-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.density-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                document.body.classList.toggle('compact', this.dataset.density === 'compact');
            });
        });
        
        // Sortable table headers
        document.querySelectorAll('.list-table th[data-sort]').forEach(th => {
            th.addEventListener('click', function() {
                const f = this.dataset.sort;
                if (sortField === f) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortField = f;
                    sortDirection = 'asc';
                }
                
                const sel = document.getElementById('sort-select');
                if (sel) {
                    const opt = Array.from(sel.options).find(o => o.value === `${f}-${sortDirection}`);
                    if (opt) sel.value = opt.value;
                }
                
                refresh();
            });
        });
        
        // Overlay click
        const overlayEl = document.getElementById('overlay');
        if (overlayEl) {
            overlayEl.addEventListener('click', closePanel);
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const addModal = document.getElementById('add-property-modal');
                const detailPanel = document.getElementById('detail-panel');
                
                if (addModal && addModal.classList.contains('open')) {
                    closeAddPropertyModal();
                } else if (detailPanel && detailPanel.classList.contains('open')) {
                    closePanel();
                }
            }
        });
    } catch (error) {
        console.error('Error setting up event listeners:', error);
    }
}

function refresh() {
    renderGrid();
    renderList();
    
    if (map) {
        setTimeout(() => {
            map.invalidateSize();
            renderMarkers();
        }, 50);
    }
    
    updateFilterCounts();
}

// ========== EXPORT/IMPORT ==========

function exportCSV() {
    try {
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
        
        const csv = [h.join(','), ...rows.map(r => r.join(','))].join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'jps_properties_' + new Date().toISOString().split('T')[0] + '.csv';
        a.click();
        
        showToast('CSV exported!', 'success');
    } catch (error) {
        console.error('Export CSV error:', error);
        showToast('Export failed', 'error');
    }
}

function exportProperties() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) return alert('No data');
        
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        a.download = 'jps_properties_backup.json';
        a.click();
        
        showToast('Exported!', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showToast('Export failed', 'error');
    }
}

function importProperties(file) {
    if (!file) {
        showToast('No file selected', 'error');
        return;
    }
    
    const reader = new FileReader();
    
    reader.onload = async () => {
        try {
            console.log('Parsing imported file...');
            const data = JSON.parse(reader.result);
            
            if (!Array.isArray(data)) {
                throw new Error('Expected array of properties');
            }
            
            if (!data.every(p => p.address && p.city)) {
                throw new Error('Missing required fields (address, city)');
            }
            
            console.log(`Import: ${data.length} properties found`);
            
            // Remove duplicates based on ID
            const uniqueData = [];
            const seenIds = new Set();
            
            for (const prop of data) {
                if (!seenIds.has(prop.id)) {
                    seenIds.add(prop.id);
                    uniqueData.push(prop);
                } else {
                    console.warn(`Duplicate ID removed: ${prop.id}`);
                }
            }
            
            console.log(`After deduplication: ${uniqueData.length} properties`);
            
            // Update properties array
            properties = uniqueData;
            
            // Save to localStorage first
            localStorage.setItem(STORAGE_KEY, JSON.stringify(properties));
            console.log('✓ Saved to localStorage');
            
            // Save to Firebase immediately (bypass debounce)
            if (firebaseReady && window._fb) {
                const { db, doc, setDoc, serverTimestamp } = window._fb;
                const docRef = doc(db, 'jps', 'pipeline');
                
                suppressRemoteUpdate = true;
                updateSyncStatus('saving');
                
                console.log('Saving to Firebase...');
                await setDoc(docRef, {
                    properties: properties,
                    updatedAt: serverTimestamp(),
                    version: 2
                }, { merge: false }); // Force complete overwrite
                
                console.log('✓ Saved to Firebase');
                updateSyncStatus('synced');
                
                setTimeout(() => { suppressRemoteUpdate = false; }, 500);
            } else {
                console.warn('Firebase not ready - saved locally only');
                showToast('Saved locally (Firebase not ready)', 'warning');
            }
            
            // Refresh UI without reloading
            normalizeProperties();
            updateStats();
            renderCountyList();
            renderTypeList();
            refresh();
            
            const dedupMsg = uniqueData.length < data.length ? 
                ` (${data.length - uniqueData.length} duplicates removed)` : '';
            showToast(`Imported ${uniqueData.length} properties${dedupMsg}!`, 'success');
            
        } catch (e) {
            console.error('Import error:', e);
            showToast('Import failed: ' + e.message, 'error');
        }
    };
    
    reader.onerror = () => {
        console.error('File read error');
        showToast('Failed to read file', 'error');
    };
    
    reader.readAsText(file);
}

function resetToDefaults() {
    if (!confirm('Reset to default properties? This will replace all current data with the original 40 properties. Make sure to export first if you want to keep your changes!')) {
        return;
    }
    
    properties = defaultProperties.slice();
    saveProperties();
    location.reload();
}

// ========== PIN LOCK SYSTEM ==========

const appRoot = document.getElementById("appRoot");
const overlay = document.getElementById("lockOverlay");
const card = document.getElementById("lockCard");

if (overlay && card) {
    const inputs = Array.from(overlay.querySelectorAll(".pinBox"));
    const errorEl = document.getElementById("lockError");
    const unlockBtn = document.getElementById("unlockBtn");
    const clearBtn = document.getElementById("clearPinBtn");
    
    function showError(msg="Wrong PIN") {
        if (errorEl) {
            errorEl.textContent = msg;
            errorEl.classList.add("show");
        }
        card.classList.remove("shake");
        void card.offsetWidth;
        card.classList.add("shake");
    }
    
    function clearError() {
        if (errorEl) errorEl.classList.remove("show");
    }
    
    function clearInputs() {
        inputs.forEach(i => i.value = "");
        if (inputs[0]) inputs[0].focus();
        clearError();
    }
    
    function getEnteredPin() {
        return inputs.map(i => i.value).join("");
    }
    
    function unlock() {
        overlay.style.display = "none";
        if (appRoot) appRoot.style.display = "block";
    }
    
    function lock() {
        overlay.style.display = "flex";
        if (appRoot) appRoot.style.display = "none";
        clearInputs();
    }
    
    function checkAndUnlock() {
        const entered = getEnteredPin();
        if (entered.length < 4) return showError("Enter 4 digits");
        
        if (entered === PIN) {
            if (REMEMBER) localStorage.setItem(STORAGE_KEY_PIN, "1");
            unlock();
        } else {
            showError();
            clearInputs();
        }
    }
    
    // Check if already authenticated
    const already = (REMEMBER && localStorage.getItem(STORAGE_KEY_PIN) === "1");
    if (already) {
        unlock();
    } else {
        lock();
    }
    
    // Input behavior
    inputs.forEach((input, idx) => {
        input.addEventListener("input", (e) => {
            clearError();
            input.value = input.value.replace(/\D/g, "").slice(0, 1);
            if (input.value && idx < inputs.length - 1) inputs[idx + 1].focus();
            if (getEnteredPin().length === 4) checkAndUnlock();
        });
        
        input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !input.value && idx > 0) {
                inputs[idx - 1].focus();
            }
            if (e.key === "Enter") checkAndUnlock();
        });
        
        input.addEventListener("paste", (e) => {
            e.preventDefault();
            const text = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 4);
            if (!text) return;
            
            text.split("").forEach((ch, i) => {
                if (inputs[i]) inputs[i].value = ch;
            });
            
            inputs[Math.min(text.length, 4) - 1].focus();
            if (text.length === 4) checkAndUnlock();
        });
    });
    
    if (unlockBtn) unlockBtn.addEventListener("click", checkAndUnlock);
    if (clearBtn) clearBtn.addEventListener("click", clearInputs);
    
    // Expose lock function
    window.lockSite = function () {
        localStorage.removeItem(STORAGE_KEY_PIN);
        lock();
    };
}
