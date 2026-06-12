/**
 * Vector DB MCP Tools
 * 
 * New internal MCP tools for the planning and vector store system.
 * These are registered in mcpService.ts's _registerInternalTools().
 */

import { z } from 'zod';
import { planCreator } from '~/lib/planning/plan-creator';
import { planExecutor } from '~/lib/planning/plan-executor';
import { projectContextStore } from '~/lib/vector-store/project-context-store';
import { userProfileStore } from '~/lib/vector-store/user-profile-store';

/**
 * Returns the tool definitions for vector DB and planning tools.
 * These get merged into the internalTools object in mcpService.ts.
 */
export function getVectorDBTools() {
  return {
    // ─── User Insight Storage ─────────────────────────────────

    store_user_insight: {
      description: `Store a new insight about the user into the semantic memory system. Use this when you observe:
- A clear preference ("I always use Tailwind", "No indigo colors", "Prefer functional components")
- A repeated behavior pattern (seen across multiple messages)
- Positive or negative feedback on your output
- A fact about the user's skill level or workflow
- Technical preferences (framework choices, coding style, deployment preferences)

This stores the insight as a vector embedding for semantic retrieval. Next time a related topic comes up, the most relevant insights will be automatically retrieved.

Categories:
- preference: Explicit likes/dislikes (e.g., "prefers dark mode", "doesn't like animations")
- behavior: Repeated patterns (e.g., "often asks for responsive design", "usually works on React projects")
- fact: Objective facts (e.g., "senior developer", "deploys to Vercel", "uses TypeScript")
- feedback: Reactions to AI output (e.g., "liked the clean UI", "didn't want that library")
- skill-level: Technical ability assessment (e.g., "comfortable with advanced React patterns")`,
      parameters: z.object({
        category: z
          .enum(['preference', 'behavior', 'fact', 'feedback', 'skill-level'])
          .describe('The type of insight'),
        content: z.string().describe('The insight content to store (be specific and concise)'),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('How confident you are this insight is accurate (0-1, default 0.8)'),
      }),
      execute: async ({ category, content, confidence }: { category: string; content: string; confidence?: number }) => {
        try {
          await userProfileStore.add({
            type: category as any,
            content,
            confidence: confidence ?? 0.8,
          });
          return `User insight stored successfully: [${category}] ${content}`;
        } catch (error) {
          return `Failed to store user insight: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      },
    },

    // ─── Project Knowledge Storage ────────────────────────────

    store_project_knowledge: {
      description: `Store knowledge about the current project into the project context vector store. This knowledge persists across all chats linked to this project.

Types:
- decision: Architectural or design decisions (e.g., "Using Prisma for ORM", "Auth via NextAuth.js")
- error: Errors encountered (include error message)
- fix: How an error was fixed
- pattern: Established coding patterns (e.g., "All components use shadcn/ui", "API routes follow REST conventions")
- requirement: Project requirements (e.g., "Must support dark mode", "Mobile-first responsive design")
- architecture: High-level architecture decisions
- dont: Things to NEVER do in this project (e.g., "Never use inline styles", "Never use class components")`,
      parameters: z.object({
        type: z
          .enum(['decision', 'error', 'fix', 'pattern', 'requirement', 'architecture', 'dont'])
          .describe('The type of project knowledge'),
        content: z.string().describe('The knowledge content'),
        filePaths: z
          .array(z.string())
          .optional()
          .describe('Related file paths'),
        metadata: z
          .object({
            error: z.string().optional().describe('The error message (for type=error)'),
            fix: z.string().optional().describe('How it was fixed (for type=fix)'),
            reason: z.string().optional().describe('Why this decision was made (for type=decision)'),
            severity: z.enum(['critical', 'major', 'minor']).optional().describe('Severity level'),
          })
          .optional()
          .describe('Additional metadata'),
      }),
      execute: async ({ type, content, filePaths, metadata }: { type: string; content: string; filePaths?: string[]; metadata?: Record<string, any> }) => {
        try {
          // We need a projectId — for now, store it and the caller ensures project context
          // The projectId comes from the current project context
          const projectId = (globalThis as any).__currentProjectId;
          if (!projectId) {
            return 'No active project. Project knowledge can only be stored when working on a project.';
          }

          await projectContextStore.add(projectId, {
            type: type as any,
            content,
            filePaths,
            metadata,
          });
          return `Project knowledge stored: [${type}] ${content}`;
        } catch (error) {
          return `Failed to store project knowledge: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      },
    },

    // ─── Plan Creation ───────────────────────────────────────

    create_plan: {
      description: `Create a structured execution plan for a complex task. Use this when the user's request requires:
- Multiple steps that should be executed independently
- File modifications across different areas of the project
- Verification after each step (lint, type-check, flow verification)
- A task too complex for a single AI response

The plan will be shown to the user for approval before execution.
Each point should be:
- Independent (can be executed with minimal context from other points)
- Verifiable (has clear success criteria)
- Ordered (dependencies declared via dependency indices)

Verification types per point:
- lint: Run ESLint on modified files
- type-check: Run TypeScript type checker
- flow-verify: Verify "Every Button Does Something" + "Every Screen is Connected"
- custom: Custom verification
- none: Skip verification`,
      parameters: z.object({
        title: z.string().describe('Short title for the plan'),
        description: z.string().describe('Brief description of what the plan accomplishes'),
        points: z
          .array(
            z.object({
              title: z.string().describe('Point title'),
              description: z.string().describe('What this point accomplishes'),
              verificationTypes: z
                .array(z.enum(['lint', 'type-check', 'flow-verify', 'custom', 'none']))
                .describe('Verification types to run after this point'),
              dependencies: z
                .array(z.number())
                .describe('Indices of points this depends on (0-based)'),
              requiredFiles: z
                .array(z.string())
                .describe('Files this point will likely create or modify'),
            }),
          )
          .min(1)
          .describe('The plan points in execution order'),
      }),
      execute: async ({ title, description, points }: { title: string; description: string; points: any[] }) => {
        try {
          const projectId = (globalThis as any).__currentProjectId;
          const chatId = (globalThis as any).__currentChatId;

          if (!projectId || !chatId) {
            return 'Cannot create plan: no active project or chat. Ensure a workspace is open.';
          }

          const plan = await planCreator.createPlan({
            title,
            description,
            projectId,
            chatId,
            points,
          });

          return `Plan created successfully (ID: ${plan.id}).

Title: ${plan.title}
Points: ${plan.points.length}

The plan is now awaiting user approval. The user will see the plan and can:
- Approve it to start execution
- Modify individual points
- Add or remove points
- Reorder points

Continue by informing the user about the plan and asking for approval.`;
        } catch (error) {
          return `Failed to create plan: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      },
    },

    // ─── Query User Profile (for explicit AI queries) ─────────

    query_user_profile: {
      description: `Query the user's profile vector store for relevant memories. Use this when you need to recall specific information about the user's preferences, skills, or past behavior.`,
      parameters: z.object({
        query: z.string().describe('What to search for in the user profile'),
      }),
      execute: async ({ query }: { query: string }) => {
        try {
          const results = await userProfileStore.search(query, { topK: 10 });
          if (results.length === 0) {
            return 'No relevant user profile information found.';
          }
          return userProfileStore.formatForPrompt(results);
        } catch (error) {
          return `Profile query failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      },
    },

    // ─── Query Project Context (for explicit AI queries) ──────

    query_project_context: {
      description: `Query the project's context vector store for relevant knowledge. Use this when you need to recall specific information about the project's decisions, patterns, errors, or requirements.`,
      parameters: z.object({
        query: z.string().describe('What to search for in the project context'),
        types: z
          .array(z.enum(['decision', 'error', 'fix', 'pattern', 'requirement', 'architecture', 'dont']))
          .optional()
          .describe('Filter by knowledge types'),
      }),
      execute: async ({ query, types }: { query: string; types?: string[] }) => {
        try {
          const projectId = (globalThis as any).__currentProjectId;
          if (!projectId) {
            return 'No active project.';
          }

          const results = await projectContextStore.search(projectId, query, {
            topK: 15,
            types: types as any,
          });
          if (results.length === 0) {
            return 'No relevant project context found.';
          }
          return projectContextStore.formatForPrompt(results);
        } catch (error) {
          return `Project context query failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      },
    },
  } as const;
}