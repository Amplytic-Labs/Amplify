/**
 * Token counter utility for estimating LLM token usage.
 * Since exact tokenization depends on the model provider,
 * this provides a reliable approximation.
 */

export interface TokenCountResult {
  tokens: number;
  characters: number;
  approximation: 'exact' | 'estimated';
}

/**
 * Estimates the number of tokens in a string.
 * Uses a heuristic: ~3 characters per token for code-heavy text,
 * and ~4 characters per token for natural language prose.
 *
 * @param text The string to count tokens for.
 * @returns A TokenCountResult containing the estimated token count.
 */
export function countTokens(text: string): TokenCountResult {
  if (!text) {
    return {
      tokens: 0,
      characters: 0,
      approximation: 'exact',
    };
  }

  const characters = text.length;

  // Heuristic to detect code-like content:
  // Check for common code characters: { } [ ] ( ) => ; :
  const codeIndicators = /[{}[\]()=>;: ]/g;
  const matchCount = (text.match(codeIndicators) || []).length;
  const codeDensity = matchCount / characters;

  // If more than 10% of characters are code indicators, treat as code (3 chars/token)
  // Otherwise, treat as prose (4 chars/token)
  const ratio = codeDensity > 0.1 ? 3 : 4;
  const tokens = Math.ceil(characters / ratio);

  return {
    tokens,
    characters,
    approximation: 'estimated',
  };
}

/**
 * Calculates the remaining token budget.
 *
 * @param currentUsage Current token count.
 * @param budget Total token budget.
 * @returns The remaining tokens.
 */
export function getRemainingBudget(currentUsage: number, budget: number): number {
  return Math.max(0, budget - currentUsage);
}
