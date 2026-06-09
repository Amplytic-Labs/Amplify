/**
 * Utilities for managing Skill identifiers and metadata.
 */

/**
 * Normalizes a skill identifier to ensure case-insensitive lookups.
 *
 * @param skillId The raw skill identifier.
 * @returns The normalized, lowercase skill identifier.
 *
 * @example
 * normalizeSkillId('Frontend-Design') // returns 'frontend-design'
 */
export function normalizeSkillId(skillId: string): string {
  if (!skillId) return '';
  return skillId.trim().toLowerCase();
}

/**
 * Validates if a skill identifier follows the required kebab-case format.
 *
 * @param skillId The identifier to validate.
 * @returns True if the identifier is valid.
 */
export function isValidSkillId(skillId: string): boolean {
  const kebabCaseRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  return kebabCaseRegex.test(normalizeSkillId(skillId));
}
