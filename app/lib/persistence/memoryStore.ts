import { getLocalStorage, setLocalStorage } from './localStorage';

export interface Memory {
  id: string;
  content: string;
  timestamp: string;
  category?: string;
}

const MEMORY_STORAGE_KEY = 'amplify_user_memories';

export class MemoryStore {
  private static instance: MemoryStore;

  private constructor() {}

  public static getInstance(): MemoryStore {
    if (!MemoryStore.instance) {
      MemoryStore.instance = new MemoryStore();
    }
    return MemoryStore.instance;
  }

  /**
   * Retrieves all stored memories.
   */
  public getMemories(): Memory[] {
    const memories = getLocalStorage(MEMORY_STORAGE_KEY);
    return Array.isArray(memories) ? memories : [];
  }

  /**
   * Adds a new memory to the store.
   */
  public addMemory(content: string, category?: string): Memory {
    const memories = this.getMemories();

    // Basic deduplication: check if a similar memory already exists
    const existingMemory = memories.find((m) => m.content.toLowerCase().trim() === content.toLowerCase().trim());

    if (existingMemory) {
      // Update timestamp of existing memory instead of adding a duplicate
      const updatedMemories = memories.map((m) =>
        m.id === existingMemory.id ? { ...m, timestamp: new Date().toISOString() } : m,
      );
      setLocalStorage(MEMORY_STORAGE_KEY, updatedMemories);
      return existingMemory;
    }

    const newMemory: Memory = {
      id: crypto.randomUUID(),
      content,
      timestamp: new Date().toISOString(),
      category,
    };

    setLocalStorage(MEMORY_STORAGE_KEY, [...memories, newMemory]);
    return newMemory;
  }

  /**
   * Updates an existing memory.
   */
  public updateMemory(id: string, content: string): Memory | null {
    const memories = this.getMemories();
    const index = memories.findIndex((m) => m.id === id);

    if (index === -1) return null;

    const updatedMemory = {
      ...memories[index],
      content,
      timestamp: new Date().toISOString(),
    };

    const newMemories = [...memories];
    newMemories[index] = updatedMemory;

    setLocalStorage(MEMORY_STORAGE_KEY, newMemories);
    return updatedMemory;
  }

  /**
   * Deletes a memory from the store.
   */
  public deleteMemory(id: string): boolean {
    const memories = this.getMemories();
    const filteredMemories = memories.filter((m) => m.id !== id);

    if (memories.length === filteredMemories.length) {
      return false;
    }

    setLocalStorage(MEMORY_STORAGE_KEY, filteredMemories);
    return true;
  }

  /**
   * Searches memories for a specific query.
   */
  public searchMemories(query: string): Memory[] {
    const memories = this.getMemories();
    const lowerQuery = query.toLowerCase();
    return memories.filter(
      (m) =>
        m.content.toLowerCase().includes(lowerQuery) || (m.category && m.category.toLowerCase().includes(lowerQuery)),
    );
  }

  formatForPrompt(): string {
    const memories = this.getMemories();
    if (memories.length === 0) return 'No persistent memory available for this user.';

    return memories.map((m) => `- ${m.content}${m.category ? ` (${m.category})` : ''}`).join('\n');
  }

  /**
   * Clears all memories.
   */
  public clearAll(): void {
    setLocalStorage(MEMORY_STORAGE_KEY, []);
  }
}

export const memoryStore = MemoryStore.getInstance();
