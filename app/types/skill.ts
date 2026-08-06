/**
 * Types for the Skill system.
 * Skills are procedural markdown instructions with YAML frontmatter.
 */

export interface SkillFrontmatter {
  /** Unique identifier for the skill (e.g., 'git-expert') */
  name: string;

  /** Concise description used for discovery and token budgeting */
  description: string;

  /** Optional priority score for token budget allocation (higher = more likely to be included) */
  priority?: number;

  /** Optional tags for categorization */
  tags?: string[];

  /** Version of the skill schema */
  version?: string;
}

export interface Skill {
  /** The parsed YAML frontmatter */
  metadata: SkillFrontmatter;

  /** The full markdown content of the skill */
  content: string;

  /** The absolute path to the skill file on disk (if applicable) */
  filePath?: string;
}

export interface SkillRegistryEntry {
  name: string;
  description: string;
  path: string;
  priority: number;
}

export interface SkillRegistry {
  [skillName: string]: SkillRegistryEntry;
}
