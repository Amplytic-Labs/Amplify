/**
 * Project Files — the global source of truth.
 *
 * A Project owns a single current `FileMap`. Every chat linked to that project
 * reads from / writes to this same map, so switching chats inside a project
 * never changes the file version. Each meaningful update is recorded as a
 * `ProjectCommit` (versioned snapshot), enabling history / restore.
 *
 * Personal chats (no project) keep using the legacy per-chat `snapshots` store.
 */

import type { FileMap } from '~/lib/stores/files';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ProjectFiles');

export interface ProjectFiles {
  projectId: string;
  files: FileMap;
  updatedAt: string;

  /** Id of the most recent commit, for quick display. */
  currentCommitId?: string;
}

export interface ProjectCommit {
  id: string;
  projectId: string;
  message: string;
  files: FileMap;
  createdAt: string;

  /** Chat that produced this commit, if any. */
  chatId?: string;

  /** Short human label, e.g. "v3". */
  label?: string;
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get the current global FileMap for a project.
 * Returns undefined if the project has no files yet (brand new project).
 */
export async function getProjectFiles(db: IDBDatabase, projectId: string): Promise<ProjectFiles | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('project_files', 'readonly');
    const store = tx.objectStore('project_files');
    const request = store.get(projectId);
    request.onsuccess = () => resolve(request.result as ProjectFiles | undefined);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Replace the project's current global FileMap. Does NOT create a commit —
 * call `createProjectCommit` for that. Use this for fast intermediate saves
 * and for restoring a commit.
 */
export async function saveProjectFiles(
  db: IDBDatabase,
  projectId: string,
  files: FileMap,
  currentCommitId?: string,
): Promise<void> {
  const record: ProjectFiles = {
    projectId,
    files,
    updatedAt: new Date().toISOString(),
    currentCommitId,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction('project_files', 'readwrite');
    const store = tx.objectStore('project_files');
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Count how many commits a project already has, so we can label the next one
 * `v1`, `v2`, …
 */
export async function countProjectCommits(db: IDBDatabase, projectId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('project_commits', 'readonly');
    const store = tx.objectStore('project_commits');
    const index = store.index('projectId');
    const request = index.count(projectId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Create a versioned commit of the project's files and set it as current.
 * Returns the new commit id.
 */
export async function createProjectCommit(
  db: IDBDatabase,
  projectId: string,
  message: string,
  files: FileMap,
  chatId?: string,
): Promise<string> {
  const count = await countProjectCommits(db, projectId);
  const id = crypto.randomUUID();
  const commit: ProjectCommit = {
    id,
    projectId,
    message,
    files,
    createdAt: new Date().toISOString(),
    chatId,
    label: `v${count + 1}`,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('project_commits', 'readwrite');
    const store = tx.objectStore('project_commits');
    const request = store.put(commit);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // Update the project's current pointer + file map in a single tx.
  await saveProjectFiles(db, projectId, files, id);

  logger.info(`Created commit ${commit.label} for project ${projectId}: ${message}`);

  return id;
}

/**
 * List a project's commits, newest first.
 */
export async function listProjectCommits(db: IDBDatabase, projectId: string): Promise<ProjectCommit[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('project_commits', 'readonly');
    const store = tx.objectStore('project_commits');
    const index = store.index('projectId');
    const request = index.getAll(projectId);

    request.onsuccess = () => {
      const commits = (request.result as ProjectCommit[]) || [];
      commits.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      resolve(commits);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a single commit by id.
 */
export async function getProjectCommit(db: IDBDatabase, commitId: string): Promise<ProjectCommit | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('project_commits', 'readonly');
    const store = tx.objectStore('project_commits');
    const request = store.get(commitId);
    request.onsuccess = () => resolve(request.result as ProjectCommit | undefined);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Restore a project to a previous commit: sets the commit's files as the
 * current global FileMap (and points currentCommitId at it). Does NOT delete
 * later commits — history is append-only.
 *
 * Returns the restored FileMap so the caller can sync it into WebContainer.
 */
export async function restoreProjectCommit(
  db: IDBDatabase,
  projectId: string,
  commitId: string,
): Promise<FileMap | undefined> {
  const commit = await getProjectCommit(db, commitId);

  if (!commit) {
    logger.warn(`Commit ${commitId} not found for project ${projectId}`);
    return undefined;
  }

  await saveProjectFiles(db, projectId, commit.files, commit.id);
  logger.info(`Restored project ${projectId} to commit ${commit.label}`);

  return commit.files;
}

/**
 * Delete all files + commits for a project (cleanup when a project is removed).
 */
export async function deleteProjectFiles(db: IDBDatabase, projectId: string): Promise<void> {
  // Delete current files.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('project_files', 'readwrite');
    tx.objectStore('project_files').delete(projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Delete all commits for this project.
  const commits = await listProjectCommits(db, projectId);

  if (commits.length === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('project_commits', 'readwrite');
    const store = tx.objectStore('project_commits');

    for (const c of commits) {
      store.delete(c.id);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export type { FileMap };
export { reqToPromise };
