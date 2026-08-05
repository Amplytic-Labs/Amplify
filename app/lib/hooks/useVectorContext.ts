/**
 * useVectorContext Hook
 *
 * Client-side hook that queries the vector stores before each
 * chat message is sent and returns formatted context strings.
 * These are passed to the /api/chat endpoint which injects
 * them into the system prompt.
 *
 * Usage in Chat.client.tsx:
 * ```
 * const { userContext, projectContext, isReady } = useVectorContext(lastUserMessage);
 * ```
 * Then include `userContext` and `projectContext` in the `useChat({ body: { ... } })` call.
 */

import { useState, useEffect, useCallback } from 'react';
import { userProfileStore } from '~/lib/vector-store/user-profile-store';
import { projectContextStore } from '~/lib/vector-store/project-context-store';
import { projectStore } from '~/lib/persistence/project-store';
import { chatId } from '~/lib/persistence/useChatHistory';

interface VectorContextResult {
  /** Formatted user context for system prompt injection */
  userContext: string;

  /** Formatted project context for system prompt injection */
  projectContext: string;

  /** Whether the vector stores are initialized and ready */
  isReady: boolean;

  /** The project ID if this is a project chat */
  projectId: string | null;
}

/**
 * Initializes vector stores and provides context for a given query.
 * The context is updated whenever the query changes (i.e., new user message).
 */
export function useVectorContext(query: string): VectorContextResult {
  const [userContext, setUserContext] = useState('');
  const [projectContext, setProjectContext] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);

  // Initialize vector stores on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await userProfileStore.initialize();

        if (!cancelled) {
          setIsReady(true);
          console.log('[useVectorContext] Vector stores initialized');
        }
      } catch (error) {
        console.warn('[useVectorContext] Failed to initialize vector stores:', error);

        // Still mark as ready so chat works without vector context
        if (!cancelled) {
          setIsReady(true);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  // Query vector stores when the user message changes
  useEffect(() => {
    if (!query || !isReady) {
      setUserContext('');
      setProjectContext('');

      return;
    }

    let cancelled = false;

    async function queryContext() {
      try {
        // Query user profile vector store
        const userCtx = await userProfileStore.formatContextForPrompt(query, 500);

        if (!cancelled) {
          setUserContext(userCtx);
        }

        // Check if this is a project chat
        const currentChatId = chatId.get();
        const project = currentChatId ? projectStore.getProjectByChat(currentChatId) : null;

        if (project) {
          setProjectId(project.id);

          // Query project context vector store
          const projCtx = await projectContextStore.formatContextForPrompt(project.id, query, 1000);

          if (!cancelled) {
            setProjectContext(projCtx);
          }
        } else {
          setProjectId(null);
          setProjectContext('');
        }
      } catch (error) {
        console.warn('[useVectorContext] Failed to query context:', error);
      }
    }

    // Debounce the query to avoid excessive searches during typing
    const timer = setTimeout(queryContext, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isReady]);

  return { userContext, projectContext, isReady, projectId };
}

/**
 * Utility: Auto-extract user preferences from a message pair
 * and store them in the user profile vector store.
 * Called after each AI response.
 */
export async function extractAndStoreUserFacts(userMessage: string, assistantMessage: string): Promise<void> {
  // Simple heuristic: look for explicit user statements about preferences
  const preferencePatterns = [
    { pattern: /i (?:prefer|like|want|use|always use|never use) (\w[\w\s]{5,80})/i, category: 'preference' as const },
    {
      pattern:
        /(?:use|using|with|in) (typescript|javascript|python|rust|go|java|react|vue|svelte|angular|next\.?js|express|fastify|prisma|drizzle|tailwind|scss|sass)/i,
      category: 'tech_stack' as const,
    },
  ];

  for (const { pattern, category } of preferencePatterns) {
    const match = userMessage.match(pattern);

    if (match) {
      const fact = match[0].trim();
      await userProfileStore.add({
        content: fact,
        category,
        confidence: 0.9, // Explicit user statement
        source: 'user_message',
      });
    }
  }
}

/**
 * Utility: Auto-extract project context from assistant actions
 * and store in the project context vector store.
 * Called after file writes in the workbench.
 */
export async function extractAndStoreProjectContext(
  projId: string,
  actionDescription: string,
  type: any,
  files?: string[],
): Promise<void> {
  if (!projId) {
    return;
  }

  await projectContextStore.add(projId, {
    projectId: projId,
    content: actionDescription,
    type,
    files,
  });
}
