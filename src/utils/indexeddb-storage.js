/**
 * IndexedDB Storage Wrapper
 * Provides a Promise-based interface for IndexedDB operations
 */
export class IndexedDBStorage {
  constructor() {
    this.db = null;
    this.dbName = null;
    this.version = null;
  }

  /**
   * Initialize IndexedDB with specified stores
   * @param {string} dbName - Database name
   * @param {number} version - Schema version
   * @param {Array<{name: string, options: object}>} stores - Object stores to create
   */
  async init(dbName, version, stores) {
    this.dbName = dbName;
    this.version = version;

    if (!IndexedDBStorage.isSupported()) {
      throw new Error('IndexedDB is not supported in this browser');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        stores.forEach(({ name, options }) => {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, options);

            // Create indexes for common query patterns
            if (name === 'input-history' || name === 'query-history') {
              store.createIndex('timestamp', 'timestamp', { unique: false });
              if (name === 'input-history') {
                store.createIndex('lastUsed', 'lastUsed', { unique: false });
              }
            }
          }
        });
      };
    });
  }

  /**
   * Add a new record to a store
   * @param {string} storeName - Object store name
   * @param {object} data - Data to add (ID will be auto-generated if keyPath is autoIncrement)
   */
  async add(storeName, data) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.add(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a record by ID
   * @param {string} storeName - Object store name
   * @param {number} id - Record ID
   */
  async get(storeName, id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all records from a store with optional ordering and pagination
   * @param {string} storeName - Object store name
   * @param {string} orderBy - Index name to order by (optional)
   * @param {number} limit - Maximum number of records (optional)
   * @param {number} offset - Number of records to skip (optional)
   */
  async getAll(storeName, orderBy = null, limit = null, offset = 0) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);

      let source = store;
      if (orderBy && store.indexNames.contains(orderBy)) {
        source = store.index(orderBy);
      }

      const request = source.openCursor(null, 'prev'); // Most recent first
      const results = [];
      let skipped = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;

        if (cursor) {
          if (skipped < offset) {
            skipped++;
            cursor.continue();
            return;
          }

          results.push(cursor.value);

          if (!limit || results.length < limit) {
            cursor.continue();
          } else {
            resolve(results);
          }
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a record by ID
   * @param {string} storeName - Object store name
   * @param {number} id - Record ID
   */
  async delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all records from a store
   * @param {string} storeName - Object store name
   */
  async clear(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get the oldest record from a store
   * @param {string} storeName - Object store name
   * @param {string} orderBy - Index name to order by
   */
  async getOldest(storeName, orderBy = 'timestamp') {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);

      let source = store;
      if (orderBy && store.indexNames.contains(orderBy)) {
        source = store.index(orderBy);
      }

      const request = source.openCursor(null, 'next'); // Oldest first

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        resolve(cursor ? cursor.value : null);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count total records in a store
   * @param {string} storeName - Object store name
   */
  async count(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Enforce maximum record limit using LRU strategy
   * @param {string} storeName - Object store name
   * @param {number} maxLimit - Maximum number of records allowed
   * @param {string} orderBy - Index to determine oldest records
   */
  async enforceLimit(storeName, maxLimit, orderBy = 'timestamp') {
    const count = await this.count(storeName);

    if (count > maxLimit) {
      const toDelete = count - maxLimit;
      const oldest = await this.getAll(storeName, orderBy, toDelete, 0);

      // Get oldest records by reversing the cursor direction
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const index = store.index(orderBy);
      const request = index.openCursor(null, 'next'); // Oldest first

      let deleted = 0;

      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const cursor = event.target.result;

          if (cursor && deleted < toDelete) {
            cursor.delete();
            deleted++;
            cursor.continue();
          } else {
            resolve(deleted);
          }
        };

        request.onerror = () => reject(request.error);
      });
    }

    return 0;
  }

  /**
   * Check if IndexedDB is supported
   */
  static isSupported() {
    return typeof indexedDB !== 'undefined';
  }

  /**
   * Find a record by field value
   * @param {string} storeName - Object store name
   * @param {string} field - Field name to search
   * @param {*} value - Value to match
   */
  async findByField(storeName, field, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value[field] === value) {
            resolve(cursor.value);
          } else {
            cursor.continue();
          }
        } else {
          resolve(null); // Not found
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update a record by ID
   * @param {string} storeName - Object store name
   * @param {number} id - Record ID
   * @param {object} updates - Fields to update
   */
  async update(storeName, id, updates) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          reject(new Error('Record not found'));
          return;
        }

        // Merge updates
        const updatedRecord = { ...record, ...updates };
        const putRequest = store.put(updatedRecord);

        putRequest.onsuccess = () => resolve(updatedRecord);
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
