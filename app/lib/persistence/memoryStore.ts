import { getLocalStorage, setLocalStorage } from './localStorage';

export interface Memory {
  id: string;
  content: string;
  timestamp: string;
  category?: string;
}

const MEMORY_STORAGE_KEY = 'bolt_user_memories';

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

  /**
   * Clears all memories.
   */
  public clearAll(): void {
    setLocalStorage(MEMORY_STORAGE_KEY, []);
  }
}

export const memoryStore = MemoryStore.getInstance();
