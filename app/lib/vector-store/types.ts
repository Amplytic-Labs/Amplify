/**
 * Vector Store Type Definitions
 *
 * Defines all data types used by the UserProfile and ProjectContext vector stores.
 * These stores use Orama (full-text search with BM25 ranking) persisted to IndexedDB.
 */

export type UserProfileEntryCategory =
  | 'preference'
  | 'tech_stack'
  | 'coding_style'
  | 'domain_knowledge'
  | 'workflow'
  | 'communication_style'
  | 'project_preference'
  | 'general';

export interface UserProfileEntry {
  id: string;
  content: string;
  category: UserProfileEntryCategory;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  source?: string;
  confidence: number;
}

export type ProjectContextEntryType =
  | 'requirement'
  | 'decision'
  | 'error'
  | 'fix'
  | 'pattern'
  | 'architecture'
  | 'constraint'
  | 'file_context'
  | 'conversation_summary'
  | 'tool_usage'
  | 'flow_definition'
  | 'screen_connection';

export interface ProjectContextEntry {
  id: string;
  projectId: string;
  content: string;
  type: ProjectContextEntryType;
  createdAt: string;
  updatedAt: string;
  sourceChatId?: string;
  planPointId?: string;
  files?: string[];
  tags?: string[];
}

export interface VectorSearchResult<T> {
  entry: T;
  score: number;
}

export interface VectorSearchOptions {
  limit?: number;
  threshold?: number;
  category?: string;
  tags?: string[];
  properties?: string[];
}

export interface UserProfileSchema {
  id: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  source?: string;
  confidence: number;
  [key: string]: any;
}

export interface ProjectContextSchema {
  id: string;
  projectId: string;
  content: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  sourceChatId?: string;
  planPointId?: string;
  files?: string[];
  tags?: string[];
  [key: string]: any;
}
