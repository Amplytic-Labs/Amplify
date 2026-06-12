import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('StorageMonitor');

const WARNING_THRESHOLD_MB = 40;
const EVICTION_THRESHOLD_MB = 45;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let monitoringActive = false;

export interface StorageStats {
  usedMB: number;
  quotaMB: number;
  usagePercent: number;
}

export async function getStorageEstimate(): Promise<StorageStats | null> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usedMB = (estimate.usage || 0) / (1024 * 1024);
      const quotaMB = (estimate.quota || 0) / (1024 * 1024);
      return {
        usedMB,
        quotaMB,
        usagePercent: quotaMB > 0 ? (usedMB / quotaMB) * 100 : 0,
      };
    } catch {
      return null;
    }
  }
  return null;
}

export async function evictOldVectorData(): Promise<number> {
  // Try to clear old vector snapshots from IndexedDB
  // This is a safety valve when storage is running low
  try {
    const { openDatabaseV3, deleteVectorSnapshot, getPlan } = await import('~/lib/persistence/db-v3');
    const db = await openDatabaseV3();
    if (!db) return 0;

    // Get all keys from vectorSnapshots store
    const transaction = db.transaction('vectorSnapshots', 'readonly');
    const store = transaction.objectStore('vectorSnapshots');
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (keys.length === 0) return 0;

    // Delete oldest snapshots (first 20%)
    const toDelete = Math.ceil(keys.length * 0.2);
    let deleted = 0;
    for (let i = 0; i < toDelete; i++) {
      try {
        await deleteVectorSnapshot(db, keys[i] as string);
        deleted++;
      } catch {
        // Skip failures
      }
    }

    logger.info(`Evicted ${deleted}/${toDelete} vector snapshots`);
    return deleted;
  } catch (error) {
    logger.error('Failed to evict vector data:', error);
    return 0;
  }
}

export function startStorageMonitoring(): void {
  if (monitoringActive) return;
  monitoringActive = true;

  const check = async () => {
    const stats = await getStorageEstimate();
    if (!stats) return;

    if (stats.usedMB > EVICTION_THRESHOLD_MB) {
      logger.warn(`Storage critical: ${stats.usedMB.toFixed(1)}MB used. Running eviction...`);
      const evicted = await evictOldVectorData();
      if (evicted === 0) {
        logger.error('Storage critical but no data to evict. Vector store may be unusable.');
      }
    } else if (stats.usedMB > WARNING_THRESHOLD_MB) {
      logger.warn(`Storage warning: ${stats.usedMB.toFixed(1)}MB used`);
    }
  };

  check();
  setInterval(check, CHECK_INTERVAL_MS);
}