/**
 * Skill Context Builder
 *
 * Invokes skills BEFORE the worker starts and converts each skill's
 * raw markdown content into a structured SkillContext — a uniform
 * interface that the worker always knows how to consume.
 *
 * Key design decisions (from the GPT architecture conversation):
 *  1. Skills are treated as tools that produce structured outputs,
 *     not just static prompts appended to context.
 *  2. Only the skills the planner marked as required are loaded —
 *     keeping worker context lean.
 *  3. Every skill returns the SAME structure, so the worker always
 *     knows how to consume a skill's output.
 *  4. Skills return both guidance AND executable artifacts (suggested
 *     tools), giving the worker not just knowledge but an execution
 *     strategy.
 */

import type { SkillContext } from './types';

/*
 * ============================================================
 * Section markers used to parse skill markdown into structured fields
 * ============================================================
 */

interface SectionPattern {
  field: keyof Pick<
    SkillContext,
    'architectureNotes' | 'implementationRules' | 'commonPitfalls' | 'recommendedApis' | 'codeStandards' | 'references'
  >;
  patterns: RegExp[];
}

const SECTION_PATTERNS: SectionPattern[] = [
  {
    field: 'architectureNotes',
    patterns: [
      /##\s*Architecture[^#\n]*/i,
      /##\s*Design Principles[^#\n]*/i,
      /##\s*Overview[^#\n]*/i,
      /##\s*Best Practices[^#\n]*/i,
    ],
  },
  {
    field: 'implementationRules',
    patterns: [/##\s*Guidelines[^#\n]*/i, /##\s*Implementation[^#\n]*/i, /##\s*Rules[^#\n]*/i],
  },
  {
    field: 'commonPitfalls',
    patterns: [/##\s*Pitfalls[^#\n]*/i, /##\s*Common (?:Mistakes|Pitfalls)[^#\n]*/i, /##\s*Anti-?Patterns[^#\n]*/i],
  },
  {
    field: 'recommendedApis',
    patterns: [
      /##\s*(?:Recommended )?APIs?[^#\n]*/i,
      /##\s*(?:Recommended )?(?:Libraries|Packages)[^#\n]*/i,
      /##\s*Patterns[^#\n]*/i,
    ],
  },
  {
    field: 'codeStandards',
    patterns: [/##\s*Code Standards[^#\n]*/i, /##\s*Coding (?:Style|Standards)[^#\n]*/i, /##\s*Formatting[^#\n]*/i],
  },
  {
    field: 'references',
    patterns: [/##\s*References[^#\n]*/i, /##\s*(?:Further )?Reading[^#\n]*/i, /##\s*(?:External )?Links[^#\n]*/i],
  },
];

/*
 * ============================================================
 * Parsing helpers
 * ============================================================
 */

/**
 * Extracts bullet points from a markdown section.
 * Handles both `- item` and `* item` formats.
 */
function extractBullets(sectionText: string): string[] {
  const lines = sectionText.split('\n');
  const bullets: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Match bullet points: "- text" or "* text" or "• text"
    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)/);

    if (bulletMatch) {
      bullets.push(bulletMatch[1].trim());
      continue;
    }

    // Also match numbered items: "1. text"
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)/);

    if (numberedMatch) {
      bullets.push(numberedMatch[1].trim());
    }
  }

  return bullets;
}

/**
 * Finds the first matching section in the markdown for the given patterns
 * and returns its bullet points.
 */
function extractSection(markdown: string, patterns: RegExp[]): string[] {
  for (const pattern of patterns) {
    const match = markdown.match(pattern);

    if (match) {
      // Get everything from the header to the next ## header (or end)
      const startIndex = match.index ?? 0;
      const afterHeader = markdown.slice(startIndex);
      const nextHeaderMatch = afterHeader.slice(match[0].length).match(/\n##\s/);

      const sectionText = nextHeaderMatch
        ? afterHeader.slice(0, match[0].length + (nextHeaderMatch.index ?? 0))
        : afterHeader;

      const bullets = extractBullets(sectionText);

      if (bullets.length > 0) {
        return bullets;
      }
    }
  }

  return [];
}

/**
 * Parses YAML frontmatter from a markdown string.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);

  if (!match) {
    return {};
  }

  const result: Record<string, string> = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);

    if (kvMatch) {
      result[kvMatch[1]] = kvMatch[2].trim();
    }
  }

  return result;
}

/*
 * ============================================================
 * SkillContextBuilder
 * ============================================================
 */

export interface RawSkillInput {
  /**
   * The skill's identifier (e.g. "react-best-practices").
   */
  id: string;

  /**
   * Human-readable label.
   */
  label?: string;

  /**
   * The raw markdown content of the skill (SKILL.md).
   */
  content: string;
}

export class SkillContextBuilder {
  /**
   * Converts a single skill's raw markdown into a structured SkillContext.
   *
   * If the skill doesn't follow the expected section structure, the
   * full content is placed in architectureNotes so nothing is lost.
   */
  static build(raw: RawSkillInput): SkillContext {
    const frontmatter = parseFrontmatter(raw.content);
    const label = raw.label || frontmatter.label || raw.id;
    const purpose = frontmatter.description || `${label} skill`;

    const context: SkillContext = {
      skillId: raw.id,
      label,
      purpose,
      architectureNotes: [],
      implementationRules: [],
      commonPitfalls: [],
      recommendedApis: [],
      codeStandards: [],
      references: [],
      suggestedTools: [],
    };

    for (const { field, patterns } of SECTION_PATTERNS) {
      const bullets = extractSection(raw.content, patterns);
      (context[field] as string[]).push(...bullets);
    }

    /*
     * If nothing was parsed, put the full content into architectureNotes
     * so the worker still gets the guidance.
     */
    const totalParsed =
      context.architectureNotes.length +
      context.implementationRules.length +
      context.commonPitfalls.length +
      context.recommendedApis.length +
      context.codeStandards.length +
      context.references.length;

    if (totalParsed === 0) {
      // Strip frontmatter and put the rest as a single note
      const body = raw.content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();

      if (body) {
        context.architectureNotes = [body.slice(0, 2000)];
      }
    }

    return context;
  }

  /**
   * Builds SkillContexts for multiple skills at once.
   * Only the skills whose IDs are in `requiredSkillIds` are built —
   * the planner decides which skills are relevant.
   */
  static buildMany(skills: RawSkillInput[], requiredSkillIds: string[]): SkillContext[] {
    const requiredSet = new Set(requiredSkillIds);
    return skills.filter((s) => requiredSet.has(s.id)).map((s) => SkillContextBuilder.build(s));
  }

  /**
   * Formats a SkillContext into a labeled text block for injection
   * into the worker's system prompt.
   *
   * Uses the labeled-section format recommended in the architecture:
   *
   *   ===== <LABEL> SKILL =====
   *   Purpose: ...
   *   Architecture Notes:
   *     - ...
   *   ...
   */
  static formatForPrompt(ctx: SkillContext): string {
    const lines: string[] = [];
    const label = ctx.label.toUpperCase().replace(/\s+/g, '_');

    lines.push(`===== ${label} SKILL =====`);
    lines.push(`Purpose: ${ctx.purpose}`);

    const sections: Array<[string, string[]]> = [
      ['Architecture Notes', ctx.architectureNotes],
      ['Implementation Rules', ctx.implementationRules],
      ['Common Pitfalls', ctx.commonPitfalls],
      ['Recommended APIs', ctx.recommendedApis],
      ['Code Standards', ctx.codeStandards],
      ['References', ctx.references],
    ];

    for (const [title, items] of sections) {
      if (items.length === 0) {
        continue;
      }

      lines.push(`${title}:`);

      for (const item of items) {
        lines.push(`  - ${item}`);
      }
    }

    if (ctx.suggestedTools.length > 0) {
      lines.push('Suggested Tools:');

      for (const tool of ctx.suggestedTools) {
        lines.push(`  - ${tool}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Formats multiple SkillContexts into a combined block.
   */
  static formatManyForPrompt(contexts: SkillContext[]): string {
    if (contexts.length === 0) {
      return '';
    }

    return contexts.map((c) => SkillContextBuilder.formatForPrompt(c)).join('\n\n');
  }
}
