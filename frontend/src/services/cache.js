/**
 * Client-side caching utilities
 * - Memory LRU cache for fast access
 * - IndexedDB for persistent storage across sessions
 */

// LRU Cache implementation
class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

// IndexedDB wrapper for persistent storage
const DB_NAME = 'cinelinks-cache';
const DB_VERSION = 1;
const STORE_NAME = 'neighbors';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB open failed:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });

  return dbPromise;
}

async function idbGet(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          // Check if expired (24 hours)
          const age = Date.now() - result.timestamp;
          if (age > 24 * 60 * 60 * 1000) {
            // Expired, delete and return undefined
            idbDelete(key);
            resolve(undefined);
          } else {
            resolve(result.value);
          }
        } else {
          resolve(undefined);
        }
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('IndexedDB get error:', err);
    return undefined;
  }
}

async function idbSet(key, value) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put({
        key,
        value,
        timestamp: Date.now()
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('IndexedDB set error:', err);
  }
}

async function idbDelete(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('IndexedDB delete error:', err);
  }
}

async function idbClear() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('IndexedDB clear error:', err);
  }
}

// Combined cache (memory + IndexedDB)
class CombinedCache {
  constructor(maxMemorySize = 50) {
    this.memory = new LRUCache(maxMemorySize);
  }

  async get(key) {
    // Try memory first
    const memValue = this.memory.get(key);
    if (memValue !== undefined) {
      return memValue;
    }

    // Try IndexedDB
    const idbValue = await idbGet(key);
    if (idbValue !== undefined) {
      // Populate memory cache
      this.memory.set(key, idbValue);
      return idbValue;
    }

    return undefined;
  }

  async set(key, value) {
    // Set in both caches
    this.memory.set(key, value);
    await idbSet(key, value);
  }

  async delete(key) {
    this.memory.delete(key);
    await idbDelete(key);
  }

  async clear() {
    this.memory.clear();
    await idbClear();
  }
}

// Export singleton instances
export const neighborsCache = new CombinedCache(50);
export const metadataCache = new LRUCache(10);

// Prefetch queue to avoid duplicate requests
const prefetchQueue = new Set();

export function isPrefetching(key) {
  return prefetchQueue.has(key);
}

export function addToPrefetchQueue(key) {
  prefetchQueue.add(key);
}

export function removeFromPrefetchQueue(key) {
  prefetchQueue.delete(key);
}
