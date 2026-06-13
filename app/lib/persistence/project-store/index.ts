/**
 * Project Store
 *
 * Manages the categorization of chats into two categories:
 * 1. Normal chats — conversations that never invoked a workspace
 * 2. Project chats — conversations where a workspace was opened
 *
 * Auto-categorization logic:
 * - A chat starts as "chat" type by default
 * - When a workspace is first invoked (artifacts created, files written),
 *   the chat is recategorized as "project" type
 * - A project entry is created (or reused) and the chat is linked to it
 *
 * Data is stored in IndexedDB alongside chat history.
 */

import type { IChatMetadata } from '~/lib/persistence/db';

// ============================================================
// Types
// ============================================================

export type ChatCategory = 'chat' | 'project';

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  chatIds: string[];
  /**
   * The first chat that triggered project creation.
   */
  primaryChatId: string;
  /**
   * Technologies detected in the project.
   */
  technologies?: string[];
  /**
   * Whether the project has an active workspace.
   */
  hasWorkspace: boolean;
}

export interface ProjectStoreData {
  projects: Project[];
  /**
   * Maps chatId -> projectId for quick lookup.
   */
  chatToProject: Record<string, string>;
  /**
   * Maps chatId -> category.
   */
  chatCategories: Record<string, ChatCategory>;
}

// ============================================================
// Constants
// ============================================================

const PROJECT_STORE_KEY = 'bolt_projects';

// ============================================================
// Store Implementation
// ============================================================

function loadProjectData(): ProjectStoreData {
  // Guard: localStorage is not available on the server
  if (typeof window === 'undefined') {
    return { projects: [], chatToProject: {}, chatCategories: {} };
  }
  try {
    const raw = localStorage.getItem(PROJECT_STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('[ProjectStore] Failed to load:', e);
  }
  return { projects: [], chatToProject: {}, chatCategories: {} };
}

function saveProjectData(data: ProjectStoreData): void {
  // Guard: localStorage is not available on the server
  if (typeof window === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[ProjectStore] Failed to save:', e);
  }
}

export class ProjectStore {
  private static _instance: ProjectStore;
  private _data: ProjectStoreData;

  private constructor() {
    this._data = loadProjectData();
  }

  static getInstance(): ProjectStore {
    if (!ProjectStore._instance) {
      ProjectStore._instance = new ProjectStore();
    }
    return ProjectStore._instance;
  }

  // ============================================================
  // Chat Categorization
  // ============================================================

  /**
   * Gets the category of a chat.
   */
  getChatCategory(chatId: string): ChatCategory {
    return this._data.chatCategories[chatId] ?? 'chat';
  }

  /**
   * Gets all chat IDs for a given category.
   */
  getChatsByCategory(category: ChatCategory): string[] {
    return Object.entries(this._data.chatCategories)
      .filter(([, cat]) => cat === category)
      .map(([id]) => id);
  }

  /**
   * Gets all normal (non-project) chat IDs.
   */
  getNormalChatIds(): string[] {
    return this.getChatsByCategory('chat');
  }

  /**
   * Called when a workspace is first invoked for a chat.
   * Recategorizes the chat from 'chat' to 'project'.
   */
  async promoteChatToProject(chatId: string, projectName?: string): Promise<Project> {
    const existingProjectId = this._data.chatToProject[chatId];
    if (existingProjectId) {
      // Already a project chat, return the existing project
      const project = this._data.projects.find((p) => p.id === existingProjectId);
      if (project) return project;
    }

    // Create a new project
    const projectId = crypto.randomUUID();
    const project: Project = {
      id: projectId,
      name: projectName || `Project ${this._data.projects.length + 1}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chatIds: [chatId],
      primaryChatId: chatId,
      hasWorkspace: true,
    };

    this._data.projects.push(project);
    this._data.chatToProject[chatId] = projectId;
    this._data.chatCategories[chatId] = 'project';

    saveProjectData(this._data);
    console.log(`[ProjectStore] Chat "${chatId}" promoted to project "${projectId}"`);
    return project;
  }

  /**
   * Links an additional chat to an existing project.
   */
  linkChatToProject(chatId: string, projectId: string): void {
    const project = this._data.projects.find((p) => p.id === projectId);
    if (!project) return;

    if (!project.chatIds.includes(chatId)) {
      project.chatIds.push(chatId);
    }

    this._data.chatToProject[chatId] = projectId;
    this._data.chatCategories[chatId] = 'project';
    project.updatedAt = new Date().toISOString();

    saveProjectData(this._data);
  }

  // ============================================================
  // Project Management
  // ============================================================

  /**
   * Gets a project by ID.
   */
  getProject(projectId: string): Project | undefined {
    return this._data.projects.find((p) => p.id === projectId);
  }

  /**
   * Gets the project associated with a chat.
   */
  getProjectByChat(chatId: string): Project | undefined {
    const projectId = this._data.chatToProject[chatId];
    if (!projectId) return undefined;
    return this.getProject(projectId);
  }

  /**
   * Gets all projects.
   */
  getAllProjects(): Project[] {
    return [...this._data.projects].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  /**
   * Updates a project's metadata.
   */
  updateProject(projectId: string, updates: Partial<Pick<Project, 'name' | 'description' | 'technologies'>>): void {
    const project = this.getProject(projectId);
    if (!project) return;

    Object.assign(project, updates, { updatedAt: new Date().toISOString() });
    saveProjectData(this._data);
  }

  /**
   * Deletes a project and unlinks all associated chats.
   */
  deleteProject(projectId: string): void {
    const project = this.getProject(projectId);
    if (!project) return;

    // Unlink all chats
    for (const chatId of project.chatIds) {
      delete this._data.chatToProject[chatId];
      this._data.chatCategories[chatId] = 'chat';
    }

    // Remove the project
    this._data.projects = this._data.projects.filter((p) => p.id !== projectId);
    saveProjectData(this._data);
  }

  /**
   * Gets all chat IDs for a project.
   */
  getProjectChatIds(projectId: string): string[] {
    const project = this.getProject(projectId);
    return project?.chatIds ?? [];
  }

  /**
   * Checks if a chat belongs to a project.
   */
  isProjectChat(chatId: string): boolean {
    return this.getChatCategory(chatId) === 'project';
  }
}

export const projectStore = ProjectStore.getInstance();