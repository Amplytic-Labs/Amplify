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

import { map } from 'nanostores';
import { useStore } from '@nanostores/react';

/*
 * ============================================================
 * Types
 * ============================================================
 */

export type ChatCategory = 'chat' | 'project';

/**
 * Structured, editable project memory. Injected into the system prompt for
 * every chat linked to this project so the model has stable, global context
 * (framework, backend, architecture, theme, coding style, deps, …).
 */
export interface ProjectMemory {
  framework?: string;
  stateManagement?: string;
  backend?: string;
  architecture?: string;
  theme?: string;
  codingStyle?: string;
  dependencies?: string[];
  notes?: string;
  updatedAt?: string;
}

export const EMPTY_PROJECT_MEMORY: ProjectMemory = {};

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

  /**
   * Structured project memory — the global, chat-independent context.
   */
  memory?: ProjectMemory;

  /**
   * Id of the most recent commit (version pointer). The full file state lives
   * in the IndexedDB `project_files` store; this is just a quick reference.
   */
  currentCommitId?: string;

  /**
   * Optional emoji/icon for display in the sidebar.
   */
  icon?: string;

  /**
   * Optional color accent (tailwind color token) for sidebar display.
   */
  accent?: string;

  /**
   * Globally-stored setup command detected from the project's files
   * (e.g. `npm install`). Auto-run once per session when the project is
   * loaded so users don't have to ask the AI to run it again.
   */
  setupCommand?: string;

  /**
   * Globally-stored start command detected from the project's files
   * (e.g. `npm run dev`). Auto-run after setup completes.
   */
  startCommand?: string;

  /**
   * Detected project type (Node.js, Python, etc.) — drives the auto-run UI.
   */
  projectType?: string;

  /**
   * Best-effort followup message from the command detector (kept for parity
   * with the existing `detectProjectCommands` utility).
   */
  followupMessage?: string;

  /**
   * Whether `setupCommand` has been executed at least once and the project
   * is considered "bootstrapped" (deps installed). Cleared on demand when
   * the user wants to force a re-setup.
   */
  isSetupComplete?: boolean;
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

/*
 * ============================================================
 * Constants
 * ============================================================
 */

const PROJECT_STORE_KEY = 'amplify_projects';

/*
 * ============================================================
 * Store Implementation
 * ============================================================
 */

function loadProjectData(): ProjectStoreData {
  // Guard: localStorage is not available on the server
  if (typeof window === 'undefined') {
    return { projects: [], chatToProject: {}, chatCategories: {} };
  }

  try {
    const raw = localStorage.getItem(PROJECT_STORE_KEY);

    if (raw) {
      return JSON.parse(raw);
    }
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

  /*
   * ============================================================
   * Chat Categorization
   * ============================================================
   */

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

      if (project) {
        return project;
      }
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
    this._notify(projectId);
    console.log(`[ProjectStore] Chat "${chatId}" promoted to project "${projectId}"`);

    return project;
  }

  /**
   * Links an additional chat to an existing project.
   */
  linkChatToProject(chatId: string, projectId: string): void {
    const project = this._data.projects.find((p) => p.id === projectId);

    if (!project) {
      return;
    }

    if (!project.chatIds.includes(chatId)) {
      project.chatIds.push(chatId);
    }

    this._data.chatToProject[chatId] = projectId;
    this._data.chatCategories[chatId] = 'project';
    project.updatedAt = new Date().toISOString();

    saveProjectData(this._data);
    this._notify(projectId);
  }

  /*
   * ============================================================
   * Project Management
   * ============================================================
   */

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

    if (!projectId) {
      return undefined;
    }

    return this.getProject(projectId);
  }

  /**
   * Gets all projects.
   */
  getAllProjects(): Project[] {
    return [...this._data.projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Updates a project's metadata.
   */
  updateProject(
    projectId: string,
    updates: Partial<
      Pick<
        Project,
        | 'name'
        | 'description'
        | 'technologies'
        | 'icon'
        | 'accent'
        | 'currentCommitId'
        | 'setupCommand'
        | 'startCommand'
        | 'projectType'
        | 'followupMessage'
        | 'isSetupComplete'
      >
    >,
  ): void {
    const project = this.getProject(projectId);

    if (!project) {
      return;
    }

    Object.assign(project, updates, { updatedAt: new Date().toISOString() });
    saveProjectData(this._data);
    this._notify(projectId);
  }

  /**
   * Persist the detected setup / start commands + project type on the project
   * so they can be auto-run later without asking the AI. Only fills in fields
   * that aren't already set (so user overrides survive).
   */
  setProjectCommands(
    projectId: string,
    commands: {
      type?: string;
      setupCommand?: string;
      startCommand?: string;
      followupMessage?: string;
    },
    overwrite = false,
  ): void {
    const project = this.getProject(projectId);

    if (!project) {
      return;
    }

    const updates: Partial<Project> = {};

    if (commands.type && (overwrite || !project.projectType)) {
      updates.projectType = commands.type;
    }

    if (commands.setupCommand && (overwrite || !project.setupCommand)) {
      updates.setupCommand = commands.setupCommand;
    }

    if (commands.startCommand && (overwrite || !project.startCommand)) {
      updates.startCommand = commands.startCommand;
    }

    if (commands.followupMessage && (overwrite || !project.followupMessage)) {
      updates.followupMessage = commands.followupMessage;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    Object.assign(project, updates, { updatedAt: new Date().toISOString() });
    saveProjectData(this._data);
    this._notify(projectId);
  }

  /*
   * ============================================================
   * Project Memory
   * ============================================================
   */

  /**
   * Get a project's structured memory (empty object if unset).
   */
  getProjectMemory(projectId: string): ProjectMemory {
    return this.getProject(projectId)?.memory ?? EMPTY_PROJECT_MEMORY;
  }

  /**
   * Replace a project's structured memory. Merges by default; pass `replace`
   * to overwrite wholesale.
   */
  updateProjectMemory(projectId: string, memory: Partial<ProjectMemory>, replace = false): void {
    const project = this.getProject(projectId);

    if (!project) {
      return;
    }

    const next: ProjectMemory = replace
      ? { ...memory, updatedAt: new Date().toISOString() }
      : { ...project.memory, ...memory, updatedAt: new Date().toISOString() };

    project.memory = next;
    project.updatedAt = new Date().toISOString();
    saveProjectData(this._data);
    this._notify(projectId);
  }

  /**
   * Add a dependency to the project memory (dedup, sorted).
   */
  addDependency(projectId: string, dep: string): void {
    const trimmed = dep.trim();

    if (!trimmed) {
      return;
    }

    const project = this.getProject(projectId);

    if (!project) {
      return;
    }

    const mem = project.memory ?? {};
    const deps = new Set(mem.dependencies ?? []);
    deps.add(trimmed);
    project.memory = { ...mem, dependencies: Array.from(deps).sort(), updatedAt: new Date().toISOString() };
    project.updatedAt = new Date().toISOString();
    saveProjectData(this._data);
    this._notify(projectId);
  }

  /**
   * Deletes a project and unlinks all associated chats. Also schedules
   * cleanup of the project's global files + commits in IndexedDB (best-effort,
   * async — the store itself is localStorage and synchronous).
   */
  deleteProject(projectId: string): void {
    const project = this.getProject(projectId);

    if (!project) {
      return;
    }

    // Unlink all chats
    for (const chatId of project.chatIds) {
      delete this._data.chatToProject[chatId];
      this._data.chatCategories[chatId] = 'chat';
    }

    // Remove the project
    this._data.projects = this._data.projects.filter((p) => p.id !== projectId);
    saveProjectData(this._data);
    this._notify(projectId);

    // Best-effort cleanup of project files + commits in IndexedDB.
    if (typeof window !== 'undefined') {
      import('~/lib/persistence')
        .then(({ db }) => {
          if (!db) {
            return undefined;
          }

          return import('~/lib/persistence/project-files').then(({ deleteProjectFiles }) =>
            deleteProjectFiles(db, projectId),
          );
        })
        .catch(() => undefined);
    }
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

  /*
   * ============================================================
   * Reactivity
   * ============================================================
   */

  /**
   * nanostores map keyed by projectId. Bumped whenever a project changes so
   * React components subscribed via `useProjectStore(projectId)` re-render.
   */
  private _versionStore = map<Record<string, number>>({});

  private _notify(projectId: string) {
    const cur = this._versionStore.get()[projectId] ?? 0;
    this._versionStore.setKey(projectId, cur + 1);
  }

  /**
   * React hook: subscribe to a project's version counter so the component
   * re-renders whenever the project (or its memory) changes.
   */
  useProject(projectId: string | undefined): Project | undefined {
    const version = useStore(this._versionStore);

    // touch version so the hook re-runs on change
    void (version[projectId ?? ''] ?? 0);

    return projectId ? this.getProject(projectId) : undefined;
  }
}

export const projectStore = ProjectStore.getInstance();

/**
 * Convenience: format a project's memory into a compact text block suitable
 * for injection into the system prompt as `projectContext`.
 */
export function formatProjectMemoryForPrompt(memory: ProjectMemory | undefined): string {
  if (!memory) {
    return '';
  }

  const lines: string[] = [];

  if (memory.framework) {
    lines.push(`Framework: ${memory.framework}`);
  }

  if (memory.stateManagement) {
    lines.push(`State: ${memory.stateManagement}`);
  }

  if (memory.backend) {
    lines.push(`Backend: ${memory.backend}`);
  }

  if (memory.architecture) {
    lines.push(`Architecture: ${memory.architecture}`);
  }

  if (memory.theme) {
    lines.push(`Theme: ${memory.theme}`);
  }

  if (memory.codingStyle) {
    lines.push(`Coding Style: ${memory.codingStyle}`);
  }

  if (memory.dependencies && memory.dependencies.length > 0) {
    lines.push(`Dependencies: ${memory.dependencies.join(', ')}`);
  }

  if (memory.notes) {
    lines.push(`Notes: ${memory.notes}`);
  }

  return lines.join('\n');
}
