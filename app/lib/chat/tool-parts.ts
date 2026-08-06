/**
 * AI SDK v7 tool-part helpers.
 *
 * The app was originally written against `@ai-sdk/ui-utils` v4, where tool
 * invocations lived on a part with `type: 'tool-invocation'` and a nested
 * `toolInvocation: { toolName, toolCallId, args, result, state }` field.
 *
 * In `ai@7` the runtime emits a FLAT shape:
 *
 *   {
 *     type: 'tool-<toolName>' | 'dynamic-tool',
 *     toolCallId: string,
 *     state: 'input-streaming' | 'input-available' | 'output-available'
 *            | 'output-error' | 'output-denied' | 'approval-requested'
 *            | 'approval-responded',
 *     input: unknown,          // v4 `args`
 *     output: unknown,         // v4 `result` (only on output-available)
 *     errorText?: string,      // only on output-error
 *   }
 *
 * (Dynamic tools also carry a top-level `toolName` string; static tools
 * encode it in the `type` literal and need `getToolName(part)` to extract.)
 *
 * All application code previously checked `part.type === 'tool-invocation'`
 * and read `part.toolInvocation.toolName` etc. — none of that matches v7.
 *
 * This module provides:
 *
 *   - `isToolPart(p)`         — true for both v7 (`tool-*` / `dynamic-tool`)
 *                                AND legacy v4 (`tool-invocation`) parts.
 *   - `getToolNameFromPart(p)`— returns the tool name from either shape.
 *   - `getToolCallId(p)`      — returns the toolCallId from either shape.
 *   - `getToolState(p)`       — returns the v7 state from either shape
 *                                (v4 `'call'` → `'input-available'`,
 *                                 v4 `'partial'` → `'input-streaming'`,
 *                                 v4 `'result'` → `'output-available'`).
 *   - `getToolInput(p)`       — returns the input (v4 `args`).
 *   - `getToolOutput(p)`      — returns the output (v4 `result`).
 *
 * Plus state-predicate constants for the most common checks.
 *
 * The goal: a single import surface so the migration is uniform and a
 * future v4-persistence purge can be done by removing the v4 branches here.
 */

import { isToolUIPart, getToolName } from 'ai';

/**
 * True for ANY tool part — v7 (static `tool-*` or `dynamic-tool`) or the
 * legacy v4 `tool-invocation` shape (still present in IndexedDB-persisted
 * chats from before the v7 migration).
 */
export function isToolPart(part: any): boolean {
  if (!part || typeof part !== 'object') {
    return false;
  }

  // v7 native: `tool-<name>` or `dynamic-tool`.
  if (isToolUIPart(part)) {
    return true;
  }

  // v4 legacy: `tool-invocation` with a nested `toolInvocation` object.
  if (part.type === 'tool-invocation') {
    return true;
  }

  /*
   * Some semi-legacy v7 candidates also carry a `toolCallId` on the flat
   * shape but didn't get the `tool-` prefix; treat them as tool parts too.
   */
  if (typeof part.toolCallId === 'string' && part.type && typeof part.type === 'string') {
    return true;
  }

  return false;
}

/**
 * Extract the tool name from either v7 or v4 shape.
 *
 * v7 static: derived from `part.type` (`tool-<NAME>`).
 * v7 dynamic: `part.toolName`.
 * v4 legacy: `part.toolInvocation.toolName`.
 */
export function getToolNameFromPart(part: any): string {
  if (!part) {
    return '';
  }

  // v7 native (static or dynamic) — use the SDK helper. It handles both.
  if (isToolUIPart(part)) {
    try {
      return getToolName(part) || '';
    } catch {
      // fall through to manual extraction
    }
  }

  // v7 dynamic-tool direct field.
  if (typeof part.toolName === 'string') {
    return part.toolName;
  }

  // v7 static with `tool-` prefix — manual parse fallback.
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    return part.type.slice('tool-'.length);
  }

  // v4 legacy nested shape.
  if (part.toolInvocation && typeof part.toolInvocation.toolName === 'string') {
    return part.toolInvocation.toolName;
  }

  return '';
}

/**
 * Extract the `toolCallId` from either shape.
 */
export function getToolCallId(part: any): string {
  if (!part) {
    return '';
  }

  if (typeof part.toolCallId === 'string') {
    return part.toolCallId;
  }

  if (part.toolInvocation && typeof part.toolInvocation.toolCallId === 'string') {
    return part.toolInvocation.toolCallId;
  }

  return '';
}

/**
 * Normalise the state value to the v7 vocabulary.
 *
 *   v4 `'call'`     → v7 `'input-available'`
 *   v4 `'partial'`  → v7 `'input-streaming'`
 *   v4 `'result'`   → v7 `'output-available'`
 *
 * Already-v7 values are returned unchanged.
 */
export function getToolState(part: any): string {
  if (!part) {
    return '';
  }

  const raw = typeof part.state === 'string' ? part.state : part.toolInvocation?.state;

  if (!raw) {
    return '';
  }

  switch (raw) {
    case 'call':
      return 'input-available';
    case 'partial':
    case 'partial-call':
      return 'input-streaming';
    case 'result':
      return 'output-available';
    default:
      return raw;
  }
}

/**
 * Extract the tool input args (v7 `input`, v4 `args`).
 */
export function getToolInput(part: any): any {
  if (!part) {
    return undefined;
  }

  if (part.input !== undefined) {
    return part.input;
  }

  return part.toolInvocation?.args;
}

/**
 * Extract the tool output (v7 `output`, v4 `result`).
 */
export function getToolOutput(part: any): any {
  if (!part) {
    return undefined;
  }

  if (part.output !== undefined) {
    return part.output;
  }

  if (part.errorText !== undefined) {
    return part.errorText;
  }

  return part.toolInvocation?.result;
}

/**
 * v7 state predicates (named after the v4 concepts they replace).
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ToolState = {
  /** v4 `'call'` — args fully received, awaiting execution. */
  isCall: (state: string) => state === 'input-available' || state === 'call',

  /** v4 `'partial'` — args still streaming in. */
  isPartial: (state: string) => state === 'input-streaming' || state === 'partial' || state === 'partial-call',

  /** v4 `'result'` — tool execution finished (success OR error). */
  isResult: (state: string) =>
    state === 'output-available' || state === 'output-error' || state === 'output-denied' || state === 'result',

  /** Strict success — output available, no error. */
  isSuccess: (state: string) => state === 'output-available' || state === 'result',

  /** Strict error — output-error / output-denied. */
  isError: (state: string) => state === 'output-error' || state === 'output-denied',
} as const;
