// ─── Planning Execution Engine ─────────────────────────────
//
// This module provides the plan → sub-chat execution pipeline:
// 1. PlanCreator: creates and manages plan objects
// 2. ContextBuilder: builds context bundles from vector stores
// 3. SubChatRunner: executes isolated AI conversations for each point
// 4. PlanExecutor: orchestrates the full execution pipeline
//
// All types are defined in ./types.ts

// ─── Types ────────────────────────────────────────────────
export type {
  Plan,
  PlanPoint,
  PlanStatus,
  PointStatus,
  VerificationType,
  SubChat,
  ContextBundle,
  PlanCreationRequest,
  PointVerification,
  PlanVerification,
  VerificationError,
  FlowIssue,
  CustomCheck,
  TokenUsage,
  PlanEvent,
  PlanEventType,
  Project,
  ProjectSettings,
} from './types';

// ─── Plan Creator ─────────────────────────────────────────
export { planCreator, PlanCreator } from './plan-creator';
export type { CreatePlanParams } from './plan-creator';

// ─── Context Builder ──────────────────────────────────────
export { contextBuilder, ContextBuilder } from './context-builder';

// ─── Sub-Chat Runner ──────────────────────────────────────
export { subChatRunner, SubChatRunner } from './sub-chat-runner';
export type { SubChatConfig } from './sub-chat-runner';

// ─── Plan Executor ────────────────────────────────────────
export { planExecutor, PlanExecutor, planExecutionStore } from './plan-executor';
