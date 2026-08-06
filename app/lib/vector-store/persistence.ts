/**
 * IndexedDB Persistence Layer for Orama Databases
 *
 * Provides save/load/delete operations for serializing Orama databases
 * to/from IndexedDB. This allows the vector stores to persist across
 * browser sessions without requiring any server-side storage.
 */

const VECTOR_DB_NAME = 'amplify_vector_stores';
const VECTOR_DB_VERSION = 1;

/**
 * Opens (or creates) the vector store IndexedDB database.
 */
async function openVectorDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VECTOR_DB_NAME, VECTOR_DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('stores')) {
        db.createObjectStore('stores', { keyPath: 'name' });
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

/**
 * Saves a serialized Orama database to IndexedDB.
 */
export async function saveOramaToIDB(name: string, data: string): Promise<void> {
  const db = await openVectorDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('stores', 'readwrite');
    const store = tx.objectStore('stores');
    const request = store.put({ name, data, updatedAt: new Date().toISOString() });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Loads a serialized Orama database from IndexedDB.
 * Returns null if not found.
 */
export async function loadOramaFromIDB(name: string): Promise<string | null> {
  const db = await openVectorDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('stores', 'readonly');
    const store = tx.objectStore('stores');
    const request = store.get(name);

    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? (result.data as string) : null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Deletes a serialized Orama database from IndexedDB.
 */
export async function deleteOramaFromIDB(name: string): Promise<void> {
  const db = await openVectorDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('stores', 'readwrite');
    const store = tx.objectStore('stores');
    const request = store.delete(name);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Lists all stored Orama database names.
 */
export async function listOramaDatabases(): Promise<string[]> {
  const db = await openVectorDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('stores', 'readonly');
    const store = tx.objectStore('stores');
    const request = store.getAllKeys();

    request.onsuccess = () => {
      resolve(request.result as string[]);
    };
    request.onerror = () => reject(request.error);
  });
}
