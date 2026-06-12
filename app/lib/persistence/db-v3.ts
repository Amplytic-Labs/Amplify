import { createScopedLogger } from '~/utils/logger';
import type { Project, Plan, PlanStatus, SubChat } from '../planning/types';

const logger = createScopedLogger('DBv3');

// ─── Database Open (version 3) ───────────────────────────

// this is used at the top level and never rejects
export async function openDatabaseV3(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') {
    console.error('indexedDB is not available in this environment.');
    return undefined;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open('boltHistory', 3);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      // ── v1: chats ──
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('chats')) {
          const store = db.createObjectStore('chats', { keyPath: 'id' });
          store.createIndex('id', 'id', { unique: true });
          store.createIndex('urlId', 'urlId', { unique: true });
        }
      }

      // ── v2: snapshots ──
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'chatId' });
        }
      }

      // ── v3: projects, plans, subChats, vectorSnapshots ──
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectStore.createIndex('id', 'id', { unique: true });
          projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('plans')) {
          const planStore = db.createObjectStore('plans', { keyPath: 'id' });
          planStore.createIndex('id', 'id', { unique: true });
          planStore.createIndex('projectId', 'projectId', { unique: false });
          planStore.createIndex('chatId', 'chatId', { unique: false });
          planStore.createIndex('status', 'status', { unique: false });
        }

        if (!db.objectStoreNames.contains('subChats')) {
          const subChatStore = db.createObjectStore('subChats', { keyPath: 'id' });
          subChatStore.createIndex('id', 'id', { unique: true });
          subChatStore.createIndex('planId', 'planId', { unique: false });
          subChatStore.createIndex('projectId', 'projectId', { unique: false });
        }

        if (!db.objectStoreNames.contains('vectorSnapshots')) {
          db.createObjectStore('vectorSnapshots', { keyPath: 'key' });
        }
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      resolve(undefined);
      logger.error((event.target as IDBOpenDBRequest).error);
    };
  });
}

// ─── Projects ─────────────────────────────────────────────

export async function getProject(db: IDBDatabase, id: string): Promise<Project | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readonly');
    const store = transaction.objectStore('projects');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as Project | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllProjects(db: IDBDatabase): Promise<Project[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readonly');
    const store = transaction.objectStore('projects');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as Project[]);
    request.onerror = () => reject(request.error);
  });
}

export async function setProject(db: IDBDatabase, project: Project): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    const store = transaction.objectStore('projects');
    const request = store.put(project);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteProject(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    const store = transaction.objectStore('projects');
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function addChatToProject(db: IDBDatabase, projectId: string, chatId: string): Promise<void> {
  const project = await getProject(db, projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  if (project.chatIds.includes(chatId)) {
    return;
  }

  project.chatIds.push(chatId);
  project.updatedAt = new Date().toISOString();

  return setProject(db, project);
}

export async function removeChatFromProject(db: IDBDatabase, projectId: string, chatId: string): Promise<void> {
  const project = await getProject(db, projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  project.chatIds = project.chatIds.filter((id) => id !== chatId);
  project.updatedAt = new Date().toISOString();

  return setProject(db, project);
}

// ─── Plans ────────────────────────────────────────────────

export async function getPlan(db: IDBDatabase, id: string): Promise<Plan | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('plans', 'readonly');
    const store = transaction.objectStore('plans');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as Plan | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function getPlansByProject(db: IDBDatabase, projectId: string): Promise<Plan[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('plans', 'readonly');
    const store = transaction.objectStore('plans');
    const index = store.index('projectId');
    const request = index.getAll(projectId);

    request.onsuccess = () => resolve(request.result as Plan[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getPlansByChat(db: IDBDatabase, chatId: string): Promise<Plan[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('plans', 'readonly');
    const store = transaction.objectStore('plans');
    const index = store.index('chatId');
    const request = index.getAll(chatId);

    request.onsuccess = () => resolve(request.result as Plan[]);
    request.onerror = () => reject(request.error);
  });
}

export async function setPlan(db: IDBDatabase, plan: Plan): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('plans', 'readwrite');
    const store = transaction.objectStore('plans');
    const request = store.put(plan);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function updatePlanStatus(db: IDBDatabase, planId: string, status: PlanStatus): Promise<void> {
  const plan = await getPlan(db, planId);

  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }

  plan.status = status;

  if (status === 'completed' || status === 'failed') {
    plan.completedAt = new Date().toISOString();
  }

  return setPlan(db, plan);
}

export async function deletePlan(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('plans', 'readwrite');
    const store = transaction.objectStore('plans');
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ─── Sub-Chats ────────────────────────────────────────────

export async function getSubChat(db: IDBDatabase, id: string): Promise<SubChat | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('subChats', 'readonly');
    const store = transaction.objectStore('subChats');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as SubChat | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function getSubChatsByPlan(db: IDBDatabase, planId: string): Promise<SubChat[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('subChats', 'readonly');
    const store = transaction.objectStore('subChats');
    const index = store.index('planId');
    const request = index.getAll(planId);

    request.onsuccess = () => resolve(request.result as SubChat[]);
    request.onerror = () => reject(request.error);
  });
}

export async function setSubChat(db: IDBDatabase, subChat: SubChat): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('subChats', 'readwrite');
    const store = transaction.objectStore('subChats');
    const request = store.put(subChat);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSubChatsByPlan(db: IDBDatabase, planId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('subChats', 'readwrite');
    const store = transaction.objectStore('subChats');
    const index = store.index('planId');
    const request = index.openCursor(planId);

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };

    request.onerror = () => reject(request.error);
  });
}

// ─── Vector Snapshots ─────────────────────────────────────

export interface VectorSnapshotRecord {
  key: string;
  data: ArrayBuffer | string;
}

export async function getVectorSnapshot(db: IDBDatabase, key: string): Promise<VectorSnapshotRecord | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('vectorSnapshots', 'readonly');
    const store = transaction.objectStore('vectorSnapshots');
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result as VectorSnapshotRecord | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function setVectorSnapshot(db: IDBDatabase, key: string, data: ArrayBuffer | string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('vectorSnapshots', 'readwrite');
    const store = transaction.objectStore('vectorSnapshots');
    const request = store.put({ key, data });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteVectorSnapshot(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('vectorSnapshots', 'readwrite');
    const store = transaction.objectStore('vectorSnapshots');
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = (event) => {
      if ((event.target as IDBRequest).error?.name === 'NotFoundError') {
        resolve();
      } else {
        reject(request.error);
      }
    };
  });
}