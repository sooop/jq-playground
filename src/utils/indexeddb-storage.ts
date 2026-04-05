/**
 * IndexedDB Storage Wrapper
 * Provides a Promise-based interface for IndexedDB operations
 */
export class IndexedDBStorage {
  private db: IDBDatabase | null = null;
  private dbName: string | null = null;
  private version: number | null = null;

  constructor() {}

  /**
   * Initialize IndexedDB with specified stores
   */
  async init(dbName: string, version: number, stores: Array<{ name: string; options: IDBObjectStoreParameters }>) {
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
        const req = event.target as IDBOpenDBRequest;
        const db = req.result;
        const tx = req.transaction;

        stores.forEach(({ name, options }) => {
          let store: IDBObjectStore;
          if (!db.objectStoreNames.contains(name)) {
            store = db.createObjectStore(name, options);

            // Create indexes for common query patterns
            if (name === 'input-history' || name === 'query-history') {
              store.createIndex('timestamp', 'timestamp', { unique: false });
              if (name === 'input-history') {
                store.createIndex('lastUsed', 'lastUsed', { unique: false });
                store.createIndex('contentHash', 'contentHash', { unique: false });
              }
            }
          } else {
            store = tx!.objectStore(name);
            // v2 upgrade: add contentHash index to input-history
            if (name === 'input-history' && !store.indexNames.contains('contentHash')) {
              store.createIndex('contentHash', 'contentHash', { unique: false });
            }
          }
        });
      };
    });
  }

  /**
   * Add a new record to a store
   */
  async add(storeName: string, data: object) {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.add(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a record by ID
   */
  async get(storeName: string, id: number) {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all records from a store with optional ordering and pagination
   */
  async getAll(storeName: string, orderBy: string | null = null, limit: number | null = null, offset = 0) {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);

      const source: IDBObjectStore | IDBIndex =
        orderBy && store.indexNames.contains(orderBy) ? store.index(orderBy) : store;

      const request = source.openCursor(null, 'prev'); // Most recent first
      const results: unknown[] = [];
      let skipped = 0;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;

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
   */
  async delete(storeName: string, id: number) {
    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all records from a store
   */
  async clear(storeName: string) {
    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get the oldest record from a store
   */
  async getOldest(storeName: string, orderBy = 'timestamp') {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);

      const source: IDBObjectStore | IDBIndex =
        orderBy && store.indexNames.contains(orderBy) ? store.index(orderBy) : store;

      const request = source.openCursor(null, 'next'); // Oldest first

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        resolve(cursor ? cursor.value : null);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count total records in a store
   */
  async count(storeName: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Enforce maximum record limit using LRU strategy
   */
  async enforceLimit(storeName: string, maxLimit: number, orderBy = 'timestamp') {
    const count = await this.count(storeName);

    if (count > maxLimit) {
      const toDelete = count - maxLimit;

      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const index = store.index(orderBy);
      const request = index.openCursor(null, 'next'); // Oldest first

      let deleted = 0;

      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;

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
   * Find a record by field value (full table scan — legacy)
   */
  async findByField(storeName: string, field: string, value: unknown) {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
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
   * Find a record by indexed field (O(1) lookup)
   */
  async findByIndex(storeName: string, indexName: string, value: unknown) {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      if (!store.indexNames.contains(indexName)) {
        resolve(null);
        return;
      }
      const index = store.index(indexName);
      const request = index.get(value as IDBValidKey);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update a record by ID
   */
  async update(storeName: string, id: number, updates: object) {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          reject(new Error('Record not found'));
          return;
        }

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
