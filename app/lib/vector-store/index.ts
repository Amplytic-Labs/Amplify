/**
 * Vector Store Barrel Export
 *
 * Public API for the vector store system.
 */

export { UserProfileVectorStore, userProfileStore } from './user-profile-store';
export { ProjectContextVectorStore, projectContextStore } from './project-context-store';
export { saveOramaToIDB, loadOramaFromIDB, deleteOramaFromIDB, listOramaDatabases } from './persistence';
export type {
  UserProfileEntry,
  UserProfileEntryCategory,
  ProjectContextEntry,
  ProjectContextEntryType,
  VectorSearchOptions,
  VectorSearchResult,
  UserProfileSchema,
  ProjectContextSchema,
} from './types';