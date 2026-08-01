/**
 * Client-side tool execution for vector-store tools.
 *
 * PROBLEM:
 *   `store_user_fact`, `search_user_context`, `search_project_context`, and
 *   `store_project_context` all use IndexedDB (via Orama) which is browser-only.
 *   But the server's `processToolInvocations` runs their `execute` function
 *   server-side, where `typeof window === 'undefined'` → they return
 *   "User fact storage is not available on the server. This tool can only
 *   be used client-side." The AI then retries, fails again, and eventually
 *   falls back to `update_user_memory` (which uses a non-persistent in-memory
 *   store). The user's prefs are lost on page reload.
 *
 * SOLUTION:
 *   Intercept these tool calls CLIENT-SIDE. Instead of sending
 *   `TOOL_EXECUTION_APPROVAL.APPROVE` (which tells the server to run execute),
 *   we run the actual IndexedDB operation here and send the real RESULT back
 *   via `addToolResult({ output: <result string>, state: 'output-available' })`.
 *   The server's `processToolInvocations` sees a non-APPROVE output and
 *   passes it through unchanged.
 *
 * This module is imported dynamically (client-side only) by Chat.client.tsx.
 */

import { userProfileStore } from '~/lib/vector-store/user-profile-store';
import { projectContextStore } from '~/lib/vector-store/project-context-store';

/**
 * Set of tool names that MUST be executed client-side (they use IndexedDB).
 * These tools should NOT be auto-approved via the normal APPROVE → server
 * execute path; instead, the client runs them directly.
 */
export const CLIENT_SIDE_TOOLS: ReadonlySet<string> = new Set([
  'store_user_fact',
  'search_user_context',
  'search_project_context',
  'store_project_context',
]);

export function isClientSideTool(toolName: string): boolean {
  return CLIENT_SIDE_TOOLS.has(toolName);
}

/**
 * Execute a client-side tool and return its result string.
 *
 * Mirrors the execute functions in mcpService.ts, but runs them in the
 * browser where IndexedDB is available.
 */
export async function executeClientSideTool(
  toolName: string,
  args: any,
): Promise<string> {
  try {
    switch (toolName) {
      // ─── store_user_fact ──────────────────────────────────────────────
      case 'store_user_fact': {
        const { content, category } = args;
        await userProfileStore.initialize();
        await userProfileStore.add({
          content,
          category: (category as any) || 'general',
          source: 'conversation',
          confidence: 0.8,
        });
        return `User fact stored successfully: "${content}" (category: ${category || 'general'})`;
      }

      // ─── search_user_context ──────────────────────────────────────────
      case 'search_user_context': {
        const { query } = args;
        await userProfileStore.initialize();
        const results = await userProfileStore.search(query, { limit: 5 });

        if (results.length === 0) {
          return 'No relevant user context found.';
        }

        return results
          .map((r: any) => `[${r.entry.category}] ${r.entry.content} (score: ${r.score?.toFixed(2) || 'N/A'})`)
          .join('\n');
      }

      // ─── search_project_context ───────────────────────────────────────
      case 'search_project_context': {
        const { query, projectId } = args;

        if (!projectId) {
          return 'No project ID provided. Project context requires an explicit projectId.';
        }

        const results = await projectContextStore.search(projectId, query, { limit: 5 });

        if (results.length === 0) {
          return 'No relevant project context found.';
        }

        return results.map((r: any) => `[${r.entry.type}] ${r.entry.content}`).join('\n');
      }

      // ─── store_project_context ────────────────────────────────────────
      case 'store_project_context': {
        const { content, type, projectId } = args;

        if (!projectId) {
          return 'No project ID provided. Cannot store project context.';
        }

        await projectContextStore.add(projectId, { projectId, content, type: type as any });

        return `Project context stored: [${type}] ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`;
      }

      default:
        return `Error: Unknown client-side tool "${toolName}".`;
    }
  } catch (e: any) {
    return `Error executing ${toolName}: ${e.message}`;
  }
}
