/**
 * IndexedDB-backed store for a single screenshot per project.
 *
 * Each project has AT MOST ONE screenshot record at any time. Every new
 * capture overwrites the previous one via `put` — so old screenshots are
 * automatically discarded and storage never bloats with stale images.
 *
 * Record shape:
 *   { projectId, dataUrl, capturedAt, framework, width, height }
 *
 * `dataUrl` is a base64 PNG data URL produced by the in-iframe capture
 * (see `public/inspector-script.js` + `app/lib/services/screenshotCapture.ts`).
 */
export interface ProjectScreenshot {
  projectId: string;
  dataUrl: string;
  capturedAt: string;
  framework?: string;
  width?: number;
  height?: number;
}

export async function getProjectScreenshot(
  db: IDBDatabase,
  projectId: string,
): Promise<ProjectScreenshot | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('project_screenshots', 'readonly');
    const store = tx.objectStore('project_screenshots');
    const req = store.get(projectId);
    req.onsuccess = () => resolve(req.result as ProjectScreenshot | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllProjectScreenshots(
  db: IDBDatabase,
): Promise<ProjectScreenshot[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('project_screenshots', 'readonly');
    const store = tx.objectStore('project_screenshots');
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as ProjectScreenshot[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Save (overwrite) the screenshot for a project. Previous screenshot is
 * replaced — this is the "delete old screenshots" behaviour: we never keep
 * more than one per project.
 */
export async function setProjectScreenshot(
  db: IDBDatabase,
  screenshot: ProjectScreenshot,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('project_screenshots', 'readwrite');
    const store = tx.objectStore('project_screenshots');
    const req = store.put(screenshot);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProjectScreenshot(db: IDBDatabase, projectId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('project_screenshots', 'readwrite');
    const store = tx.objectStore('project_screenshots');
    const req = store.delete(projectId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
