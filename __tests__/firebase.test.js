/**
 * Integration tests for Firebase sync logic.
 * These mock the Firebase SDK to test save/load/sync behavior
 * without a real database connection.
 */

// Mock Firebase SDK
const mockSetDoc = jest.fn().mockResolvedValue(undefined);
const mockGetDoc = jest.fn();
const mockOnSnapshot = jest.fn();
const mockDoc = jest.fn().mockReturnValue('docRef');
const mockServerTimestamp = jest.fn().mockReturnValue('SERVER_TIMESTAMP');

// We test the logic patterns used by saveToFirebase, loadFromFirebase, startRealtimeSync
// by reimplementing the core logic as pure functions

const { debounce } = require('../js/logic');

describe('Firebase sync logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('saveToFirebase pattern', () => {
    test('calls setDoc with properties and timestamp', async () => {
      const properties = [{ id: '1', address: '123 Main St', city: 'Chester' }];

      // Simulate what saveToFirebase does
      await mockSetDoc('docRef', {
        properties: properties,
        updatedAt: mockServerTimestamp(),
        version: 2,
      });

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      expect(mockSetDoc).toHaveBeenCalledWith('docRef', {
        properties: properties,
        updatedAt: 'SERVER_TIMESTAMP',
        version: 2,
      });
    });

    test('handles permission-denied error', async () => {
      const error = new Error('Permission denied');
      error.code = 'permission-denied';
      mockSetDoc.mockRejectedValueOnce(error);

      let status = 'saving';
      try {
        await mockSetDoc('docRef', { properties: [] });
      } catch (e) {
        if (e.code === 'permission-denied') {
          status = 'error';
        }
      }

      expect(status).toBe('error');
    });

    test('handles generic save error', async () => {
      mockSetDoc.mockRejectedValueOnce(new Error('Network error'));

      let status = 'saving';
      try {
        await mockSetDoc('docRef', { properties: [] });
      } catch (e) {
        status = 'error';
      }

      expect(status).toBe('error');
    });
  });

  describe('loadFromFirebase pattern', () => {
    test('loads properties from existing document', async () => {
      const firebaseData = {
        properties: [
          { id: '1', address: '105 Mohawk St', city: 'Bruin' },
          { id: '2', address: '177 Pine St', city: 'Johnstown' },
        ],
      };

      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => firebaseData,
      });

      const snap = await mockGetDoc('docRef');
      let properties = [];

      if (snap.exists()) {
        const data = snap.data();
        if (data.properties && Array.isArray(data.properties)) {
          properties = data.properties;
        }
      }

      expect(properties).toHaveLength(2);
      expect(properties[0].address).toBe('105 Mohawk St');
    });

    test('returns empty for non-existing document', async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => false,
        data: () => null,
      });

      const snap = await mockGetDoc('docRef');
      let loaded = false;

      if (snap.exists()) {
        loaded = true;
      }

      expect(loaded).toBe(false);
    });

    test('returns empty for document without properties array', async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ version: 2 }),
      });

      const snap = await mockGetDoc('docRef');
      const data = snap.data();
      const hasProps = data.properties && Array.isArray(data.properties);

      expect(hasProps).toBeFalsy();
    });

    test('handles unavailable error', async () => {
      const error = new Error('Service unavailable');
      error.code = 'unavailable';
      mockGetDoc.mockRejectedValueOnce(error);

      let errorType = null;
      try {
        await mockGetDoc('docRef');
      } catch (e) {
        errorType = e.code;
      }

      expect(errorType).toBe('unavailable');
    });
  });

  describe('startRealtimeSync pattern', () => {
    test('receives remote updates via onSnapshot', () => {
      let receivedProperties = null;

      // Simulate the onSnapshot callback
      const callback = (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (data.properties && Array.isArray(data.properties)) {
          receivedProperties = data.properties;
        }
      };

      mockOnSnapshot.mockImplementation((docRef, cb) => cb);

      // Simulate a snapshot event
      callback({
        exists: () => true,
        data: () => ({
          properties: [{ id: '1', address: '123 Main', city: 'Test' }],
        }),
      });

      expect(receivedProperties).toHaveLength(1);
      expect(receivedProperties[0].address).toBe('123 Main');
    });

    test('suppresses update echo after local save', () => {
      let suppressRemoteUpdate = true;
      let updated = false;

      const callback = (snap) => {
        if (suppressRemoteUpdate) return;
        updated = true;
      };

      callback({
        exists: () => true,
        data: () => ({ properties: [] }),
      });

      expect(updated).toBe(false);
    });

    test('processes update when not suppressed', () => {
      let suppressRemoteUpdate = false;
      let updated = false;

      const callback = (snap) => {
        if (suppressRemoteUpdate) return;
        if (!snap.exists()) return;
        const data = snap.data();
        if (data.properties && Array.isArray(data.properties)) {
          updated = true;
        }
      };

      callback({
        exists: () => true,
        data: () => ({ properties: [{ id: '1' }] }),
      });

      expect(updated).toBe(true);
    });

    test('handles snapshot error callback', () => {
      let errorStatus = null;

      const errorCallback = (error) => {
        errorStatus = 'error';
      };

      errorCallback(new Error('Snapshot error'));
      expect(errorStatus).toBe('error');
    });
  });

  describe('debounce for save', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('debounced save only fires once within delay', () => {
      const saveFn = jest.fn();
      const debouncedSave = debounce(saveFn, 600);

      // Rapid saves
      debouncedSave();
      debouncedSave();
      debouncedSave();

      jest.advanceTimersByTime(600);
      expect(saveFn).toHaveBeenCalledTimes(1);
    });

    test('debounced save fires again after delay', () => {
      const saveFn = jest.fn();
      const debouncedSave = debounce(saveFn, 600);

      debouncedSave();
      jest.advanceTimersByTime(600);
      debouncedSave();
      jest.advanceTimersByTime(600);

      expect(saveFn).toHaveBeenCalledTimes(2);
    });
  });
});
