/**
 * Planning Architecture - Barrel Export
 *
 * Architecture overview (from the GPT design conversation):
 *
 *   Planner AI → Task Contract (immutable)
 *       ↓
 *   ExecutionManager → picks next task / handles resume
 *       ↓
 *   ContextBuilder → assembles labeled sections:
 *       TASK / PROJECT / SKILLS / TOOL RESULTS /
 *       WORKSPACE / CONSTRAINTS / USER REQUEST
 *       ↓
 *   Worker (stateless sub-chat) → executes, calls tools
 *       ↓
 *   CheckpointManager → takes structured snapshots every N tool calls
 *       ↓
 *   ExecutionStateManager → tracks mutable progress
 *       ↓
 *   Verification → lint / type-check / flow
 *       ↓
 *   ExecutionManager → marks complete/failed, picks next task
 */

export { planStore } from './plan-store';
export { executePlan, resumePlan } from './sub-chat-engine';
export { ExecutionManager } from './execution-manager';
export { ExecutionStateManager } from './execution-state';
export { CheckpointManager } from './checkpoint';
export { ContextBuilder } from './context-builder';
export { SkillContextBuilder } from './skill-context';
export { toolOutputCache } from './tool-output-cache';
export { PLANNER_SYSTEM_PROMPT, extractPlanFromResponse } from './planner-prompt';
export { generatePlan, enrichSignalWithPlan } from './planner';
export type {
  PlannerResult,
  PlannerPlanPoint,
  PlannerToolOutputReference,
  PlannerConstraints,
  DraftPlanPoint,
  ExecutePlanSignal,
  GeneratePlanParams,
} from './planner';

export type {
  Plan,
  PlanStatus,
  PlanPoint,
  PlanPointStatus,
  PlanStoreData,
  SubChat,
  SubChatMessage,
  ToolInvocationRecord,
  VerificationCheckType,
  VerificationResult,
  VerificationIssue,

  // New types
  TaskContract,
  TaskConstraints,
  ToolOutputReference,
  TaskExecutionState,
  ExecutionStatus,
  Checkpoint,
  SkillContext,
} from './types';
