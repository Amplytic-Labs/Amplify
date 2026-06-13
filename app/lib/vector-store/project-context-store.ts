/**
 * Project Context Vector Store
 *
 * Manages per-project context using Orama full-text search.
 * Each project gets its own isolated Orama database instance,
 * all persisted to IndexedDB.
 *
 * Context types stored:
 * - requirement: What the user wants (features, behavior)
 * - decision: Architectural or design decisions made
 * - error: Errors encountered during development
 * - fix: How errors were resolved
 * - pattern: Established coding patterns in the project
 * - architecture: Project structure and component relationships
 * - constraint: Things NOT to do (technology restrictions, etc.)
 * - file_context: What specific files do and their purpose
 * - conversation_summary: Summaries of past conversations
 * - tool_usage: Records of tool invocations and results
 * - flow_definition: Defined user flows (e.g., "login flow: landing -> login -> dashboard")
 * - screen_connection: How screens/pages connect to each other
 *
 * This replaces sending the entire project context in every prompt.
 * Instead, the AI queries for relevant context based on the current task.
 */

import { create, insert, search, remove, save, load } from '@orama/orama';
import type {
  ProjectContextEntry,
  ProjectContextEntryType,
  ProjectContextSchema,
  VectorSearchOptions,
  VectorSearchResult,
} from './types';
import { saveOramaToIDB, loadOramaFromIDB, deleteOramaFromIDB } from './persistence';

export class ProjectContextVectorStore {
  private static _instance: ProjectContextVectorStore;
  private databases: Map<string, any> = new Map();
  private _initPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): ProjectContextVectorStore {
    if (!ProjectContextVectorStore._instance) {
      ProjectContextVectorStore._instance = new ProjectContextVectorStore();
    }
    return ProjectContextVectorStore._instance;
  }

  /**
   * Ensures the database for a specific project exists and is loaded.
   */
  async ensureProject(projectId: string): Promise<any> {
    if (this.databases.has(projectId)) {
      return this.databases.get(projectId)!;
    }

    const dbKey = `vector_store_project_${projectId}`;

    try {
      const savedData = await loadOramaFromIDB(dbKey);
      if (savedData) {
        // Use Orama's native load() API — JSON.parse produces a plain object
        // that lacks Orama's internal methods (search, insert, etc.)
        const db = await create({
          schema: {
            id: 'string',
            projectId: 'string',
            content: 'string',
            type: 'string',
            createdAt: 'string',
            updatedAt: 'string',
            sourceChatId: 'string',
            planPointId: 'string',
            files: 'string[]',
            tags: 'string[]',
          },
          language: 'english',
        });
        const rawData = JSON.parse(savedData);
        await load(db, rawData);
        this.databases.set(projectId, db);
        console.log(`[ProjectContextStore] Loaded project "${projectId}" from IndexedDB`);
        return db;
      }
    } catch (error) {
      console.warn(`[ProjectContextStore] Failed to load project "${projectId}":`, error);
    }

    // Create new database for this project
    const db = await create({
      schema: {
        id: 'string',
        projectId: 'string',
        content: 'string',
        type: 'string',
        createdAt: 'string',
        updatedAt: 'string',
        sourceChatId: 'string',
        planPointId: 'string',
        files: 'string[]',
        tags: 'string[]',
      },
      language: 'english',
    });

    this.databases.set(projectId, db);
    console.log(`[ProjectContextStore] Created new database for project "${projectId}"`);
    return db;
  }

  /**
   * Adds a context entry for a project.
   */
  async add(
    projectId: string,
    entry: Omit<ProjectContextEntry, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProjectContextEntry> {
    const db = await this.ensureProject(projectId);

    const newEntry: ProjectContextEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await insert(db, {
      id: newEntry.id,
      projectId: newEntry.projectId,
      content: newEntry.content,
      type: newEntry.type,
      createdAt: newEntry.createdAt,
      updatedAt: newEntry.updatedAt,
      sourceChatId: newEntry.sourceChatId,
      planPointId: newEntry.planPointId,
      files: newEntry.files,
      tags: newEntry.tags,
    });

    await this.persistProject(projectId);
    return newEntry;
  }

  /**
   * Updates an existing context entry.
   */
  async update(projectId: string, entry: ProjectContextEntry): Promise<void> {
    const db = await this.ensureProject(projectId);

    try {
      await remove(db, entry.id);
    } catch {
      // May not exist
    }

    await insert(db, {
      ...entry,
      updatedAt: new Date().toISOString(),
    });

    await this.persistProject(projectId);
  }

  /**
   * Searches project context using BM25 full-text search.
   */
  async search(
    projectId: string,
    query: string,
    options?: VectorSearchOptions & { type?: ProjectContextEntryType },
  ): Promise<VectorSearchResult<ProjectContextEntry>[]> {
    const db = await this.ensureProject(projectId);

    const limit = options?.limit ?? 5;
    const searchParams: any = {
      term: query,
      limit: limit * 3,
      properties: options?.properties ?? ['content'],
    };

    // Build where clause
    const conditions: any = {};
    if (options?.type) {
      conditions.type = { eq: options.type };
    }
    if (options?.category) {
      conditions.type = { eq: options.category }; // category maps to type
    }
    if (options?.tags && options.tags.length > 0) {
      conditions.tags = { containsAny: options.tags };
    }
    if (Object.keys(conditions).length > 0) {
      searchParams.where = conditions;
    }

    const result = await search(db, searchParams);
    const hits = Array.isArray(result.hits) ? result.hits : [];

    const mapped: VectorSearchResult<ProjectContextEntry>[] = hits
      .filter((hit: any) => hit.score > 0)
      .map((hit: any) => ({
        entry: hit.document as unknown as ProjectContextEntry,
        score: hit.score,
      }));

    const threshold = options?.threshold ?? 0;
    const filtered = threshold > 0 ? mapped.filter((r) => r.score >= threshold) : mapped;

    return filtered.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Gets all error+fix pairs for a project. Useful for the AI to avoid
   * repeating the same mistakes.
   */
  async getErrorHistory(projectId: string): Promise<ProjectContextEntry[]> {
    const errors = await this.search(projectId, 'error fix bug issue', {
      type: 'error',
      limit: 20,
      threshold: 0,
    });
    const fixes = await this.search(projectId, 'error fix bug issue resolve', {
      type: 'fix',
      limit: 20,
      threshold: 0,
    });
    return [...errors.map((r) => r.entry), ...fixes.map((r) => r.entry)];
  }

  /**
   * Gets all architectural decisions for a project.
   */
  async getDecisions(projectId: string): Promise<ProjectContextEntry[]> {
    const results = await this.search(projectId, 'decision architecture chose selected', {
      type: 'decision',
      limit: 20,
      threshold: 0,
    });
    return results.map((r) => r.entry);
  }

  /**
   * Gets all established patterns for a project.
   */
  async getPatterns(projectId: string): Promise<ProjectContextEntry[]> {
    const results = await this.search(projectId, 'pattern convention style structure', {
      type: 'pattern',
      limit: 20,
      threshold: 0,
    });
    return results.map((r) => r.entry);
  }

  /**
   * Gets all requirements for a project.
   */
  async getRequirements(projectId: string): Promise<ProjectContextEntry[]> {
    const results = await this.search(projectId, 'requirement feature need want must should', {
      type: 'requirement',
      limit: 20,
      threshold: 0,
    });
    return results.map((r) => r.entry);
  }

  /**
   * Gets all flow definitions and screen connections.
   * Used by the verification system to check "every button does something"
   * and "every screen is connected".
   */
  async getFlowDefinitions(projectId: string): Promise<ProjectContextEntry[]> {
    const flows = await this.search(projectId, 'flow screen page route navigate connect', {
      type: 'flow_definition',
      limit: 50,
      threshold: 0,
    });
    const connections = await this.search(projectId, 'screen connect navigate link button', {
      type: 'screen_connection',
      limit: 50,
      threshold: 0,
    });
    return [...flows.map((r) => r.entry), ...connections.map((r) => r.entry)];
  }

  /**
   * Formats relevant project context for system prompt injection.
   *
   * @param projectId The project to get context for
   * @param query The current task/query to find relevant context for
   * @param maxTokens Approximate token budget (default: 1000)
   * @returns Formatted string for prompt injection
   */
  async formatContextForPrompt(
    projectId: string,
    query: string,
    maxTokens: number = 1000,
  ): Promise<string> {
    // Search across multiple types to get a diverse context
    const allResults = await this.search(projectId, query, { limit: 15 });

    if (allResults.length === 0) return '';

    // Group by type for organized output
    const grouped = new Map<string, VectorSearchResult<ProjectContextEntry>[]>();
    for (const result of allResults) {
      const type = result.entry.type;
      if (!grouped.has(type)) grouped.set(type, []);
      grouped.get(type)!.push(result);
    }

    let output = '';
    let estimatedTokens = 0;
    const charsPerToken = 4;

    // Priority order for context types
    const typeOrder: ProjectContextEntryType[] = [
      'requirement',
      'constraint',
      'decision',
      'error',
      'fix',
      'pattern',
      'architecture',
      'flow_definition',
      'screen_connection',
      'file_context',
    ];

    for (const type of typeOrder) {
      const entries = grouped.get(type);
      if (!entries) continue;

      for (const { entry } of entries) {
        const prefix = `[${type.toUpperCase()}]`;
        const filesStr = entry.files?.length ? ` (files: ${entry.files.join(', ')})` : '';
        const line = `${prefix} ${entry.content}${filesStr}`;
        const lineTokens = Math.ceil(line.length / charsPerToken);

        if (estimatedTokens + lineTokens > maxTokens) break;

        output += line + '\n';
        estimatedTokens += lineTokens;
      }

      if (estimatedTokens > maxTokens) break;
    }

    return output.trim();
  }

  /**
   * Deletes a specific entry.
   */
  async delete(projectId: string, entryId: string): Promise<boolean> {
    const db = await this.ensureProject(projectId);
    try {
      await remove(db, entryId);
      await this.persistProject(projectId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deletes an entire project's context store.
   */
  async deleteProject(projectId: string): Promise<void> {
    const dbKey = `vector_store_project_${projectId}`;
    await deleteOramaFromIDB(dbKey);
    this.databases.delete(projectId);
  }

  /**
   * Returns entry count for a project.
   */
  async count(projectId: string): Promise<number> {
    const db = await this.ensureProject(projectId);
    const result = await search(db, { term: '', limit: 10000, properties: ['content'] });
    return Array.isArray(result.hits) ? result.hits.length : 0;
  }

  /**
   * Lists all known project IDs (from in-memory map).
   */
  listProjects(): string[] {
    return Array.from(this.databases.keys());
  }

  /**
   * Persists a single project's database to IndexedDB.
   */
  private async persistProject(projectId: string): Promise<void> {
    const db = this.databases.get(projectId);
    if (!db) return;

    const dbKey = `vector_store_project_${projectId}`;
    try {
      // Use Orama's native save() API to get a serializable snapshot
      const rawData = await save(db);
      await saveOramaToIDB(dbKey, JSON.stringify(rawData));
    } catch (error) {
      console.error(`[ProjectContextStore] Failed to persist project "${projectId}":`, error);
    }
  }
}

export const projectContextStore = ProjectContextVectorStore.getInstance();