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
 * Uses a general approximation of 4 characters per token for English text.
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

  // General rule of thumb: 1 token is approximately 4 characters for English.
  // This is a safe baseline for budgeting.
  const characters = text.length;
  const tokens = Math.ceil(characters / 4);

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
