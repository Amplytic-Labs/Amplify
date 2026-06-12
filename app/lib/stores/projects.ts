import { atom, map, computed } from 'nanostores';
import type { Project } from '~/lib/planning/types';
import { getAllProjects, setProject, deleteProject: deleteProjectFromDb, addChatToProject, removeChatFromProject } from '~/lib/persistence/db-v3';
import { createScopedLogger } from '~/utils/logger';

const log = createScopedLogger('ProjectsStore');

// Current project ID (null = no project selected)
export const currentProjectIdStore = atom<string | null>(null);

// Map of all projects
export const projectsMapStore = map<Record<string, Project>>({});

// Loading state
export const projectsLoadingStore = atom<boolean>(false);

// Computed store for the currently selected project
export const currentProjectStore = computed(
  [currentProjectIdStore, projectsMapStore],
  (currentProjectId, projectsMap): Project | undefined => {
    if (!currentProjectId) {
      return undefined;
    }

    return projectsMap[currentProjectId];
  },
);

// Load all projects from IndexedDB
export async function loadProjects(): Promise<void> {
  projectsLoadingStore.set(true);

  try {
    const projects = await getAllProjects();
    const mapData: Record<string, Project> = {};

    for (const project of projects) {
      mapData[project.id] = project;
    }

    projectsMapStore.set(mapData);
    log.debug(`Loaded ${projects.length} projects`);
  } catch (error) {
    console.error('Failed to load projects:', error);
  } finally {
    projectsLoadingStore.set(false);
  }
}

// Create a new project
export async function createProject(name: string, description?: string, template?: string): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    description: description || '',
    template: template || '',
    chatIds: [],
    createdAt: now,
    updatedAt: now,
  };

  try {
    await setProject(project);

    const currentMap = projectsMapStore.get();
    projectsMapStore.set({ ...currentMap, [project.id]: project });

    log.debug(`Created project: ${project.name} (${project.id})`);
  } catch (error) {
    console.error('Failed to create project:', error);
  }

  return project;
}

// Delete a project and all its data (plans, sub-chats, vector store)
export async function deleteProject(id: string): Promise<void> {
  try {
    // Clear the current project selection if it matches
    if (currentProjectIdStore.get() === id) {
      currentProjectIdStore.set(null);
    }

    await deleteProjectFromDb(id);

    const currentMap = projectsMapStore.get();
    const { [id]: _, ...rest } = currentMap;
    projectsMapStore.set(rest);

    log.debug(`Deleted project: ${id}`);
  } catch (error) {
    console.error('Failed to delete project:', error);
  }
}

// Select a project (set currentProjectId)
export function selectProject(id: string | null): void {
  currentProjectIdStore.set(id);
}

// Rename a project
export async function renameProject(id: string, name: string): Promise<void> {
  try {
    const currentMap = projectsMapStore.get();
    const project = currentMap[id];

    if (!project) {
      log.warn(`Cannot rename: project ${id} not found`);
      return;
    }

    const updated: Project = {
      ...project,
      name,
      updatedAt: Date.now(),
    };

    await setProject(updated);
    projectsMapStore.set({ ...currentMap, [id]: updated });

    log.debug(`Renamed project ${id} to "${name}"`);
  } catch (error) {
    console.error('Failed to rename project:', error);
  }
}

// Update project description
export async function updateProjectDescription(id: string, description: string): Promise<void> {
  try {
    const currentMap = projectsMapStore.get();
    const project = currentMap[id];

    if (!project) {
      log.warn(`Cannot update description: project ${id} not found`);
      return;
    }

    const updated: Project = {
      ...project,
      description,
      updatedAt: Date.now(),
    };

    await setProject(updated);
    projectsMapStore.set({ ...currentMap, [id]: updated });

    log.debug(`Updated description for project ${id}`);
  } catch (error) {
    console.error('Failed to update project description:', error);
  }
}

// Get the currently selected project
export function getCurrentProject(): Project | undefined {
  const id = currentProjectIdStore.get();

  if (!id) {
    return undefined;
  }

  return projectsMapStore.get()[id];
}

// Get chats for a specific project
export function getProjectChatIds(projectId: string): string[] {
  const project = projectsMapStore.get()[projectId];

  if (!project) {
    return [];
  }

  return project.chatIds || [];
}

// Get all projects as an array (sorted by updatedAt desc)
export function getProjectsArray(): Project[] {
  const projectsMap = projectsMapStore.get();

  return Object.values(projectsMap).sort((a, b) => b.updatedAt - a.updatedAt);
}