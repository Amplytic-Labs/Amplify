/**
 * MODULE-LEVEL dedup guard for tool-call auto-approval.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (the duplication root cause)
 * ──────────────────────────────────────────────────────────────────────────
 * Three separate React effects ALL auto-approve pending tool calls:
 *
 *   1. Chat.client.tsx    — read-only native tools + client-side tools
 *   2. ToolInvocations.tsx — ALL tools (except execute_plan & client-side)
 *   3. ToolProgress.tsx    — ALL tools (except client-side)
 *
 * For a read-only tool like `list_dir`, ALL THREE fire `addToolResult` for
 * the SAME toolCallId. Each call:
 *   a. sets the tool part state to `output-available`
 *   b. triggers `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`
 *   c. if the predicate is true, the SDK sends a follow-up /api/chat request
 *   d. each follow-up produces a new STEP (reasoning + text parts) appended
 *      to the SAME assistant message
 *
 * Result: 2–3 follow-up requests → 2–3 sets of reasoning + text parts in
 * one message → the user sees duplicated thought blocks and duplicated
 * message text. This is especially visible when a tool ERRORS because the
 * AI tends to retry, compounding the duplication.
 *
 * The previous fix gave each component its OWN `useRef<Set<string>>` guard.
 * That prevented infinite loops WITHIN one component, but did NOT prevent
 * the three components from each firing once — so 2–3 `addToolResult` calls
 * still happened per toolCallId.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE FIX
 * ──────────────────────────────────────────────────────────────────────────
 * A SINGLE module-level Set shared across ALL components. Once ANY component
 * marks a toolCallId as approved, the others skip. This guarantees at most
 * ONE `addToolResult` call per toolCallId across the entire app.
 *
 * toolCallIds are UUIDs — globally unique across chats, sessions, and
 * re-mounts — so there is no conflict risk. The Set lives for the lifetime
 * of the page (cleared on full reload, which is fine because all toolCallIds
 * are new after reload).
 *
 * This is a PERMANENT fix: new tools, new error types, new edge cases —
 * none of them can cause duplication because the dedup is at the
 * toolCallId level, not the error-message level.
 */

const approvedToolCallIds = new Set<string>();

/**
 * Returns true if a toolCallId has already been approved (or is being
 * approved) by ANY component. If this returns false, the caller should
 * IMMEDIATELY call `markToolCallApproved` before doing anything else,
 * to atomically claim the toolCallId.
 */
export function isToolCallApproved(toolCallId: string): boolean {
  return approvedToolCallIds.has(toolCallId);
}

/**
 * Mark a toolCallId as approved. Must be called IMMEDIATELY after
 * `isToolCallApproved` returns false, BEFORE calling `addToolResult`,
 * so that parallel effects in other components see the claim and skip.
 */
export function markToolCallApproved(toolCallId: string): void {
  approvedToolCallIds.add(toolCallId);
}

/**
 * Atomic check-and-claim. Returns true if the caller should proceed
 * with the approval (i.e. this is the first component to see this
 * toolCallId), false if another component already claimed it.
 *
 * This is the PREFERRED API — it eliminates the race window between
 * `isToolCallApproved` and `markToolCallApproved`.
 */
export function tryClaimToolCallApproval(toolCallId: string): boolean {
  if (approvedToolCallIds.has(toolCallId)) {
    return false;
  }
  approvedToolCallIds.add(toolCallId);
  return true;
}

/**
 * Reset all tracked approvals. Called when switching chats to prevent
 * stale state from a previous chat's toolCallIds lingering (unlikely
 * to matter since IDs are UUIDs, but keeps memory bounded).
 */
export function resetToolCallApprovals(): void {
  approvedToolCallIds.clear();
}
