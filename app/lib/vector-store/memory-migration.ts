import { memoryStore } from '~/lib/persistence/memoryStore';
import { userProfileStore } from './user-profile-store';
import { embeddingService } from './embedding-service';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('MemoryMigration');

const MIGRATION_KEY = 'vector_memory_migration_completed';

export async function migrateMemoriesToVectorStore(): Promise<void> {
  // Check if migration already completed
  if (localStorage.getItem(MIGRATION_KEY) === 'true') {
    return;
  }

  // Check if embedding service is available
  const isAvailable = await embeddingService.isAvailable();
  if (!isAvailable) {
    logger.info('Embedding service not available — skipping memory migration');
    return;
  }

  try {
    const memories = memoryStore.getMemories();

    if (memories.length === 0) {
      logger.info('No memories to migrate');
      localStorage.setItem(MIGRATION_KEY, 'true');
      return;
    }

    logger.info(`Starting migration of ${memories.length} memories to vector store...`);

    const validCategories = ['preference', 'behavior', 'fact', 'feedback', 'skill-level'];
    let migrated = 0;

    for (const memory of memories) {
      try {
        const category = validCategories.includes(memory.category || '')
          ? memory.category
          : 'fact';

        await userProfileStore.add({
          type: category as any,
          content: memory.content,
          confidence: 0.7, // Slightly lower confidence for migrated data
          sourceChatId: undefined,
        });

        migrated++;
      } catch (err) {
        logger.warn(`Failed to migrate memory: ${memory.content.slice(0, 50)}...`, err);
      }
    }

    logger.info(`Migration complete: ${migrated}/${memories.length} memories migrated`);
    localStorage.setItem(MIGRATION_KEY, 'true');
  } catch (error) {
    logger.error('Memory migration failed:', error);
    // Don't set the flag — will retry next time
  }
}
