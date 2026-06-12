import type { ContextBundle } from './types';
import { projectContextStore } from '../vector-store';
import { userProfileStore } from '../vector-store';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ContextBuilder');

/**
 * ContextBuilder — Builds the context bundle for sub-chats by querying vector stores.
 *
 * For each plan point, it assembles:
 * 1. Project context (decisions, patterns, architecture) via vector search
 * 2. User preferences (always included as behavioral guidance)
 * 3. Critical constraints / "don'ts" (always included, never filtered)
 *
 * The result is a `ContextBundle` with formatted strings ready for prompt injection.
 */
export class ContextBuilder {
  /**
   * Build the full context bundle for a sub-chat point.
   *
   * @param params.projectId - The project ID
   * @param params.pointDescription - The plan point's title + description
   * @param params.contextQuery - Optional additional query for vector search
   * @param params.requiredFiles - Files this point will modify (for targeted search)
   * @returns ContextBundle with formatted strings for prompt injection
   */
  async buildContext(params: {
    projectId: string;
    pointDescription: string;
    contextQuery?: string;
    requiredFiles?: string[];
  }): Promise<ContextBundle> {
    const { projectId, pointDescription, contextQuery, requiredFiles } = params;

    try {
      // 1. Build the search query from point description + optional contextQuery
      const searchQuery = [pointDescription, contextQuery, requiredFiles?.join(' ')]
        .filter(Boolean)
        .join(' ');

      // 2. Query project context store for relevant decisions, patterns, architecture
      const projectResults = await projectContextStore.search(projectId, searchQuery, {
        topK: 15,
        types: ['decision', 'pattern', 'architecture'],
      });

      // 3. Query all donts — ALWAYS include all critical constraints
      let dontsResults: Awaited<ReturnType<typeof projectContextStore.getDonts>> = [];
      try {
        dontsResults = await projectContextStore.getDonts(projectId);
      } catch (err) {
        logger.warn('Failed to fetch donts for project', err);
      }

      // 4. Query user profile store for relevant preferences
      let userProfileResults: Awaited<ReturnType<typeof userProfileStore.search>> = [];
      try {
        userProfileResults = await userProfileStore.search(searchQuery, { topK: 5 });
      } catch (err) {
        logger.warn('Failed to search user profile', err);
      }

      // 5. Format each into prompt-ready strings
      const projectContext = this.formatProjectContext(projectResults);
      const userProfile = this.formatUserProfile(userProfileResults);
      const donts = this.formatDonts(dontsResults);

      // 6. Collect all retrieved IDs for tracking
      const retrievedIds = [
        ...projectResults.map((r) => r.id),
        ...dontsResults.map((r) => r.id),
        ...userProfileResults.map((r) => r.id),
      ];

      return {
        projectContext,
        userProfile,
        donts,
        retrievedIds,
      };
    } catch (err) {
      logger.error('Failed to build context bundle', err);

      // Return an empty bundle on error so execution can continue
      return {
        projectContext: '',
        userProfile: '',
        donts: '',
        retrievedIds: [],
      };
    }
  }

  /**
   * Format project context results for prompt injection.
   * Groups by type with XML tags.
   */
  private formatProjectContext(
    results: Array<{
      type: string;
      content: string;
      filePaths?: string[];
      metadata?: { reason?: string; error?: string; fix?: string };
    }>,
  ): string {
    if (!results.length) {
      return '';
    }

    const grouped = new Map<string, typeof results>();

    for (const result of results) {
      const existing = grouped.get(result.type) ?? [];
      existing.push(result);
      grouped.set(result.type, existing);
    }

    const sections: string[] = [];

    // Decisions
    const decisions = grouped.get('decision');
    if (decisions?.length) {
      sections.push('<project_decisions>');
      for (const d of decisions) {
        const files = d.filePaths?.length ? ` (files: ${d.filePaths.join(', ')})` : '';
        const reason = d.metadata?.reason ? ` (reason: ${d.metadata.reason})` : '';
        sections.push(`- ${d.content}${reason}${files}`);
      }
      sections.push('</project_decisions>');
      sections.push('');
    }

    // Patterns
    const patterns = grouped.get('pattern');
    if (patterns?.length) {
      sections.push('<project_patterns>');
      for (const p of patterns) {
        sections.push(`- ${p.content}`);
      }
      sections.push('</project_patterns>');
      sections.push('');
    }

    // Architecture
    const architecture = grouped.get('architecture');
    if (architecture?.length) {
      sections.push('<project_architecture>');
      for (const a of architecture) {
        sections.push(`- ${a.content}`);
      }
      sections.push('</project_architecture>');
      sections.push('');
    }

    // Any other types
    for (const [type, entries] of Array.from(grouped.entries())) {
      if (type === 'decision' || type === 'pattern' || type === 'architecture') {
        continue;
      }
      sections.push(`<project_${type}>`);
      for (const entry of entries) {
        sections.push(`- ${entry.content}`);
      }
      sections.push(`</project_${type}>`);
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * Format user profile results for prompt injection.
   */
  private formatUserProfile(
    results: Array<{
      type: string;
      content: string;
      confidence: number;
    }>,
  ): string {
    if (!results.length) {
      return '';
    }

    const lines: string[] = ['<user_preferences>', ''];

    for (const r of results) {
      const confidence = Math.round(r.confidence * 100);
      const label = this.formatCategoryLabel(r.type);
      lines.push(`- [${label}] ${r.content} (confidence: ${confidence}%)`);
    }

    lines.push('');
    lines.push('</user_preferences>');

    return lines.join('\n');
  }

  /**
   * Format donts as critical constraints.
   * These are the highest-priority instructions — the AI MUST obey them.
   */
  private formatDonts(
    donts: Array<{
      content: string;
      filePaths?: string[];
    }>,
  ): string {
    if (!donts.length) {
      return '';
    }

    const lines: string[] = ['<critical_constraints>', ''];

    for (const dont of donts) {
      const source = dont.filePaths?.length ? ` (from file: ${dont.filePaths.join(', ')})` : '';
      lines.push(`⛔ Don't ${dont.content}${source}`);
    }

    lines.push('');
    lines.push('</critical_constraints>');

    return lines.join('\n');
  }

  /**
   * Map user profile category types to readable labels.
   */
  private formatCategoryLabel(type: string): string {
    const labels: Record<string, string> = {
      preference: 'Preference',
      behavior: 'Behavior',
      fact: 'Fact',
      feedback: 'Feedback',
      'skill-level': 'Skill Level',
    };
    return labels[type] ?? type;
  }
}

export const contextBuilder = new ContextBuilder();
