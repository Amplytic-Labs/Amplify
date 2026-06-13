/**
 * Plan Store
 *
 * Manages the lifecycle of Plans and their PlanPoints.
 * Persists everything to IndexedDB.
 *
 * Key operations:
 * - createPlan: Generate a new plan from a user request
 * - executePlan: Run all plan points as sub-chats
 * - getPlanStatus: Check current plan execution status
 * - cancelPlan: Stop plan execution
 * - getSubChat: Retrieve a sub-chat's messages (for user viewing)
 */

import type {
  Plan,
  PlanStatus,
  PlanPoint,
  PlanPointStatus,
  PlanStoreData,
  SubChat,
  VerificationCheckType,
  VerificationResult,
  ToolInvocationRecord,
} from './types';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('PlanStore');

const PLAN_STORE_KEY = 'bolt_plans';
const DEFAULT_VERIFICATION_CHECKS: VerificationCheckType[] = ['lint', 'type_check', 'flow_verification'];

/**
 * Load plan data from localStorage (simple approach, consistent with MemoryStore).
 */
function loadPlanData(): PlanStoreData {
  // Guard: localStorage is not available on the server
  if (typeof window === 'undefined') {
    return { plans: [], chatToPlan: {}, projectPlans: {} };
  }
  try {
    const raw = localStorage.getItem(PLAN_STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('[PlanStore] Failed to load plan data:', e);
  }
  return { plans: [], chatToPlan: {}, projectPlans: {} };
}

/**
 * Save plan data to localStorage.
 */
function savePlanData(data: PlanStoreData): void {
  // Guard: localStorage is not available on the server
  if (typeof window === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(PLAN_STORE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[PlanStore] Failed to save plan data:', e);
  }
}

export class PlanStore {
  private static _instance: PlanStore;
  private _data: PlanStoreData;
  private _activePlanId: string | null = null;
  private _executionAbortController: AbortController | null = null;

  private constructor() {
    this._data = loadPlanData();
  }

  static getInstance(): PlanStore {
    if (!PlanStore._instance) {
      PlanStore._instance = new PlanStore();
    }
    return PlanStore._instance;
  }

  // ============================================================
  // Plan CRUD
  // ============================================================

  /**
   * Creates a new plan from the AI's structured output.
   */
  createPlan(params: {
    projectId: string;
    chatId: string;
    userRequest: string;
    description: string;
    points: Omit<PlanPoint, 'id' | 'status' | 'dependencies'>[];
    verificationChecks?: VerificationCheckType[];
  }): Plan {
    const planId = crypto.randomUUID();

    // Build dependency chain: each point depends on the previous one
    const points: PlanPoint[] = params.points.map((point, index) => ({
      ...point,
      id: `pp_${planId}_${index}`,
      status: 'pending' as PlanPointStatus,
      dependencies: index > 0 ? [`pp_${planId}_${index - 1}`] : [],
      verificationChecks: point.verificationChecks ?? params.verificationChecks ?? DEFAULT_VERIFICATION_CHECKS,
      order: index,
    }));

    const plan: Plan = {
      id: planId,
      projectId: params.projectId,
      chatId: params.chatId,
      userRequest: params.userRequest,
      description: params.description,
      status: 'draft',
      points,
      defaultVerificationChecks: params.verificationChecks ?? DEFAULT_VERIFICATION_CHECKS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._data.plans.push(plan);
    this._data.chatToPlan[params.chatId] = planId;

    if (!this._data.projectPlans[params.projectId]) {
      this._data.projectPlans[params.projectId] = [];
    }
    this._data.projectPlans[params.projectId].push(planId);

    savePlanData(this._data);
    logger.info(`Created plan ${planId} with ${points.length} points`);

    return plan;
  }

  /**
   * Gets a plan by ID.
   */
  getPlan(planId: string): Plan | undefined {
    return this._data.plans.find((p) => p.id === planId);
  }

  /**
   * Gets the active plan for a chat.
   */
  getPlanByChat(chatId: string): Plan | undefined {
    const planId = this._data.chatToPlan[chatId];
    if (!planId) return undefined;
    return this.getPlan(planId);
  }

  /**
   * Gets all plans for a project.
   */
  getPlansByProject(projectId: string): Plan[] {
    const planIds = this._data.projectPlans[projectId] ?? [];
    return planIds
      .map((id) => this.getPlan(id))
      .filter((p): p is Plan => p !== undefined);
  }

  /**
   * Updates a plan's status.
   */
  updatePlanStatus(planId: string, status: PlanStatus): void {
    const plan = this.getPlan(planId);
    if (!plan) return;

    plan.status = status;
    plan.updatedAt = new Date().toISOString();

    if (status === 'executing' && !plan.startedAt) {
      plan.startedAt = new Date().toISOString();
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      plan.completedAt = new Date().toISOString();
    }

    savePlanData(this._data);
  }

  /**
   * Updates a specific plan point.
   */
  updatePlanPoint(planId: string, pointId: string, updates: Partial<PlanPoint>): void {
    const plan = this.getPlan(planId);
    if (!plan) return;

    const point = plan.points.find((p) => p.id === pointId);
    if (!point) return;

    Object.assign(point, updates);
    plan.updatedAt = new Date().toISOString();
    savePlanData(this._data);
  }

  /**
   * Adds a sub-chat to a plan point.
   */
  addSubChat(planId: string, pointId: string, subChat: Omit<SubChat, 'id' | 'createdAt' | 'updatedAt'>): SubChat {
    const plan = this.getPlan(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const point = plan.points.find((p) => p.id === pointId);
    if (!point) throw new Error(`PlanPoint ${pointId} not found`);

    const newSubChat: SubChat = {
      ...subChat,
      id: `sc_${planId}_${pointId}_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    point.subChat = newSubChat;
    plan.updatedAt = new Date().toISOString();
    savePlanData(this._data);

    return newSubChat;
  }

  /**
   * Adds a tool invocation record to a sub-chat.
   */
  addToolInvocation(planId: string, pointId: string, invocation: Omit<ToolInvocationRecord, 'timestamp'>): void {
    const plan = this.getPlan(planId);
    if (!plan) return;

    const point = plan.points.find((p) => p.id === pointId);
    if (!point?.subChat) return;

    point.subChat.toolInvocations.push({
      ...invocation,
      timestamp: new Date().toISOString(),
    });
    point.subChat.updatedAt = new Date().toISOString();
    plan.updatedAt = new Date().toISOString();
    savePlanData(this._data);
  }

  /**
   * Sets verification results for a plan point.
   */
  setVerificationResults(planId: string, pointId: string, results: VerificationResult[]): void {
    const plan = this.getPlan(planId);
    if (!plan) return;

    const point = plan.points.find((p) => p.id === pointId);
    if (!point) return;

    point.verificationResults = results;
    plan.updatedAt = new Date().toISOString();
    savePlanData(this._data);
  }

  /**
   * Adds a modified file to a sub-chat.
   */
  addModifiedFile(planId: string, pointId: string, filePath: string): void {
    const plan = this.getPlan(planId);
    if (!plan) return;

    const point = plan.points.find((p) => p.id === pointId);
    if (!point?.subChat) return;

    if (!point.subChat.modifiedFiles.includes(filePath)) {
      point.subChat.modifiedFiles.push(filePath);
    }
  }

  // ============================================================
  // Plan Execution Control
  // ============================================================

  /**
   * Cancels the currently executing plan.
   */
  cancelPlan(planId: string): void {
    if (this._executionAbortController) {
      this._executionAbortController.abort();
      this._executionAbortController = null;
    }

    const plan = this.getPlan(planId);
    if (plan) {
      // Mark in-progress points as skipped
      plan.points
        .filter((p) => p.status === 'in_progress' || p.status === 'pending')
        .forEach((p) => {
          p.status = 'skipped';
          p.completedAt = new Date().toISOString();
        });

      this.updatePlanStatus(planId, 'cancelled');
    }
  }

  /**
   * Gets the abort signal for the current plan execution.
   */
  getAbortSignal(): AbortSignal | undefined {
    return this._executionAbortController?.signal;
  }

  /**
   * Sets the abort controller for plan execution.
   */
  setAbortController(controller: AbortController): void {
    this._executionAbortController = controller;
  }

  /**
   * Gets the next pending plan point that has all dependencies met.
   */
  getNextExecutablePoint(planId: string): PlanPoint | undefined {
    const plan = this.getPlan(planId);
    if (!plan) return undefined;

    const completedPoints = new Set(
      plan.points.filter((p) => p.status === 'completed').map((p) => p.id),
    );

    return plan.points.find(
      (point) =>
        point.status === 'pending' &&
        point.dependencies.every((depId) => completedPoints.has(depId)),
    );
  }

  /**
   * Deletes a plan and all its sub-chats.
   */
  deletePlan(planId: string): void {
    const plan = this.getPlan(planId);
    if (!plan) return;

    // Remove from project plans
    const projectPlans = this._data.projectPlans[plan.projectId];
    if (projectPlans) {
      this._data.projectPlans[plan.projectId] = projectPlans.filter((id) => id !== planId);
    }

    // Remove from chat-to-plan mapping
    if (this._data.chatToPlan[plan.chatId] === planId) {
      delete this._data.chatToPlan[plan.chatId];
    }

    // Remove the plan itself
    this._data.plans = this._data.plans.filter((p) => p.id !== planId);

    savePlanData(this._data);
  }

  /**
   * Returns all plans (for debugging/admin).
   */
  getAllPlans(): Plan[] {
    return [...this._data.plans];
  }
}

export const planStore = PlanStore.getInstance();