/**
 * Plan Store
 *
 * Manages the lifecycle of Plans and their PlanPoints.
 * Persists everything to IndexedDB (amplify_plans_db) for reliable storage
 * beyond the ~5MB localStorage limit.
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

const PLAN_DB_NAME = 'amplify_plans_db';
const PLAN_DB_VERSION = 1;
const PLAN_STORE_NAME = 'plans';
const PLAN_DATA_KEY = 'plan_store_data';

const DEFAULT_VERIFICATION_CHECKS: VerificationCheckType[] = ['lint', 'type_check', 'flow_verification'];

const EMPTY_DATA: PlanStoreData = { plans: [], chatToPlan: {}, projectPlans: {} };

/*
 * ============================================================
 * IndexedDB helpers
 * ============================================================
 */

/**
 * Opens (or creates) the plan IndexedDB database.
 * Exported so the auto-start script can pre-create the DB if needed.
 */
export async function openPlanDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PLAN_DB_NAME, PLAN_DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(PLAN_STORE_NAME)) {
        db.createObjectStore(PLAN_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

/**
 * Loads the plan store data from IndexedDB.
 * Returns the default empty data if not found or on error.
 */
async function loadPlanDataFromIDB(): Promise<PlanStoreData> {
  if (typeof window === 'undefined') {
    return { ...EMPTY_DATA };
  }

  try {
    const db = await openPlanDB();

    return new Promise((resolve, _reject) => {
      const tx = db.transaction(PLAN_STORE_NAME, 'readonly');
      const store = tx.objectStore(PLAN_STORE_NAME);
      const request = store.get(PLAN_DATA_KEY);

      request.onsuccess = () => {
        const result = request.result;
        db.close();
        resolve(result?.data ? (result.data as PlanStoreData) : { ...EMPTY_DATA });
      };

      request.onerror = () => {
        db.close();
        console.error('[PlanStore] Failed to load plan data from IDB:', request.error);
        resolve({ ...EMPTY_DATA });
      };
    });
  } catch (e) {
    console.error('[PlanStore] Failed to open plan DB:', e);
    return { ...EMPTY_DATA };
  }
}

/**
 * Persists the plan store data to IndexedDB.
 */
async function savePlanDataToIDB(data: PlanStoreData): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const db = await openPlanDB();

    // eslint-disable-next-line consistent-return
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAN_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PLAN_STORE_NAME);
      const request = store.put({
        id: PLAN_DATA_KEY,
        data,
        updatedAt: new Date().toISOString(),
      });

      request.onsuccess = () => {
        db.close();
        resolve();
      };

      request.onerror = () => {
        db.close();
        console.error('[PlanStore] Failed to save plan data to IDB:', request.error);
        reject(request.error);
      };
    });
  } catch (e) {
    console.error('[PlanStore] Failed to open plan DB for save:', e);
  }
}

export class PlanStore {
  private static _instance: PlanStore;
  private _data: PlanStoreData = { ...EMPTY_DATA };
  private _activePlanId: string | null = null;
  private _executionAbortController: AbortController | null = null;
  private _initialized = false;
  private _initPromise: Promise<void> | null = null;

  private constructor() {
    /*
     * Synchronous constructor — data is loaded lazily on first access.
     * If we're on the server, we stay with empty data and skip IDB entirely.
     */
  }

  /**
   * Ensures the in-memory data has been loaded from IndexedDB.
   * Uses a promise-gate so concurrent callers share a single init.
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  private async ensureInit(): Promise<void> {
    if (this._initialized) {
      return;
    }

    if (this._initPromise) {
      await this._initPromise;
      return;
    }

    // Server-side guard: already have empty data, mark as initialized.
    if (typeof window === 'undefined') {
      this._initialized = true;
      return;
    }

    this._initPromise = (async () => {
      try {
        this._data = await loadPlanDataFromIDB();
        logger.info('Plan data loaded from IndexedDB');
      } catch (e) {
        console.error('[PlanStore] Init failed, using empty data:', e);
        this._data = { ...EMPTY_DATA };
      }
      this._initialized = true;
    })();

    await this._initPromise;
  }

  /**
   * Fire-and-forget persist to IndexedDB. Errors are logged but never thrown
   * so the caller doesn't need to await.
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  private persist(): void {
    savePlanDataToIDB(this._data).catch((e) => {
      console.error('[PlanStore] Background persist failed:', e);
    });
  }

  static getInstance(): PlanStore {
    if (!PlanStore._instance) {
      PlanStore._instance = new PlanStore();
    }

    return PlanStore._instance;
  }

  /*
   * ============================================================
   * Plan CRUD
   * ============================================================
   */

  /**
   * M-5 fix: Async version of createPlan that ensures IDB data is loaded
   * before modifying state, preventing data loss from the race condition
   * where createPlan is called before ensureInit resolves.
   */
  async createPlanAsync(params: {
    projectId: string;
    chatId: string;
    userRequest: string;
    description: string;
    points: Omit<PlanPoint, 'id' | 'status' | 'dependencies'>[];
    verificationChecks?: VerificationCheckType[];
  }): Promise<Plan> {
    await this.ensureInit();
    return this.createPlan(params);
  }

  /**
   * Creates a plan with full Task Contracts (goal, requirements,
   * success criteria, required skills, tool output references,
   * constraints). Also initializes the mutable ExecutionState for
   * each point.
   *
   * This is the preferred creation path for the new architecture —
   * it separates the immutable contract from the mutable execution
   * state at creation time.
   */
  async createPlanWithContractsAsync(params: {
    projectId: string;
    chatId: string;
    userRequest: string;
    description: string;
    plannerNotes?: string;
    points: Array<{
      title: string;
      goal: string;
      description: string;
      requirements: string[];
      successCriteria: string[];
      requiredSkills: string[];
      requiredToolOutputs: Array<{
        tool: string;
        id: string;
        args?: Record<string, unknown>;
        label?: string;
      }>;
      expectedFiles: string[];
      verificationChecks?: VerificationCheckType[];
      constraints?: {
        doNotModify?: string[];
        doNotInstall?: string[];
        additional?: string[];
      };
    }>;
    verificationChecks?: VerificationCheckType[];
  }): Promise<Plan> {
    await this.ensureInit();

    const planId = crypto.randomUUID();
    const now = new Date().toISOString();

    const points: PlanPoint[] = params.points.map((point, index) => ({
      id: `pp_${planId}_${index}`,
      title: point.title,
      goal: point.goal,
      description: point.description,
      requirements: point.requirements,
      successCriteria: point.successCriteria,
      requiredSkills: point.requiredSkills,
      requiredToolOutputs: point.requiredToolOutputs,
      constraints: point.constraints,
      status: 'pending' as PlanPointStatus,
      order: index,
      dependencies: index > 0 ? [`pp_${planId}_${index - 1}`] : [],
      expectedFiles: point.expectedFiles,
      verificationChecks: point.verificationChecks ?? params.verificationChecks ?? DEFAULT_VERIFICATION_CHECKS,

      // Initialize the mutable execution state — the runtime owns this.
      executionState: {
        status: 'pending' as const,
        startedAt: now,
        lastActivity: now,
        completedSteps: [],
        toolCallIds: [],
        filesModified: [],
        checkpointIndex: -1,
        canResume: true,
        retryCount: 0,
      },
      checkpoints: [],
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
      createdAt: now,
      updatedAt: now,
    };

    this._data.plans.push(plan);
    this._data.chatToPlan[params.chatId] = planId;

    if (!this._data.projectPlans[params.projectId]) {
      this._data.projectPlans[params.projectId] = [];
    }

    this._data.projectPlans[params.projectId].push(planId);

    this.persist();
    logger.info(`Created plan ${planId} with ${points.length} task contracts`);

    return plan;
  }

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

    this.persist();
    logger.info(`Created plan ${planId} with ${points.length} points`);

    return plan;
  }

  /**
   * Gets a plan by ID. M-5 fix: async version that ensures init.
   */
  async getPlanAsync(planId: string): Promise<Plan | undefined> {
    await this.ensureInit();
    return this.getPlan(planId);
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

    if (!planId) {
      return undefined;
    }

    return this.getPlan(planId);
  }

  /**
   * Gets all plans for a project.
   */
  getPlansByProject(projectId: string): Plan[] {
    const planIds = this._data.projectPlans[projectId] ?? [];
    return planIds.map((id) => this.getPlan(id)).filter((p): p is Plan => p !== undefined);
  }

  /**
   * Updates a plan's status.
   */
  updatePlanStatus(planId: string, status: PlanStatus): void {
    const plan = this.getPlan(planId);

    if (!plan) {
      return;
    }

    plan.status = status;
    plan.updatedAt = new Date().toISOString();

    if (status === 'executing' && !plan.startedAt) {
      plan.startedAt = new Date().toISOString();
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      plan.completedAt = new Date().toISOString();
    }

    this.persist();
  }

  /**
   * Updates a specific plan point.
   */
  updatePlanPoint(planId: string, pointId: string, updates: Partial<PlanPoint>): void {
    const plan = this.getPlan(planId);

    if (!plan) {
      return;
    }

    const point = plan.points.find((p) => p.id === pointId);

    if (!point) {
      return;
    }

    Object.assign(point, updates);
    plan.updatedAt = new Date().toISOString();
    this.persist();
  }

  /**
   * Adds a sub-chat to a plan point.
   */
  addSubChat(planId: string, pointId: string, subChat: Omit<SubChat, 'id' | 'createdAt' | 'updatedAt'>): SubChat {
    const plan = this.getPlan(planId);

    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const point = plan.points.find((p) => p.id === pointId);

    if (!point) {
      throw new Error(`PlanPoint ${pointId} not found`);
    }

    const newSubChat: SubChat = {
      ...subChat,
      id: `sc_${planId}_${pointId}_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    point.subChat = newSubChat;
    plan.updatedAt = new Date().toISOString();
    this.persist();

    return newSubChat;
  }

  /**
   * Adds a tool invocation record to a sub-chat.
   *
   * V7 MIGRATION: This stores invocations in the legacy toolInvocations array
   * for backward compatibility. In v7, tool invocations are typically in message.parts,
   * but we maintain this separate record for plan tracking/verification purposes.
   */
  addToolInvocation(planId: string, pointId: string, invocation: Omit<ToolInvocationRecord, 'timestamp'>): void {
    const plan = this.getPlan(planId);

    if (!plan) {
      return;
    }

    const point = plan.points.find((p) => p.id === pointId);

    if (!point?.subChat) {
      return;
    }

    // Ensure toolInvocations array exists (legacy format)
    if (!Array.isArray(point.subChat.toolInvocations)) {
      point.subChat.toolInvocations = [];
    }

    // Store in legacy format for plan tracking
    point.subChat.toolInvocations.push({
      ...invocation,
      timestamp: new Date().toISOString(),
    });
    point.subChat.updatedAt = new Date().toISOString();
    plan.updatedAt = new Date().toISOString();
    this.persist();
  }

  /**
   * Sets verification results for a plan point.
   */
  setVerificationResults(planId: string, pointId: string, results: VerificationResult[]): void {
    const plan = this.getPlan(planId);

    if (!plan) {
      return;
    }

    const point = plan.points.find((p) => p.id === pointId);

    if (!point) {
      return;
    }

    point.verificationResults = results;
    plan.updatedAt = new Date().toISOString();
    this.persist();
  }

  /**
   * Adds a modified file to a sub-chat.
   */
  addModifiedFile(planId: string, pointId: string, filePath: string): void {
    const plan = this.getPlan(planId);

    if (!plan) {
      return;
    }

    const point = plan.points.find((p) => p.id === pointId);

    if (!point?.subChat) {
      return;
    }

    if (!point.subChat.modifiedFiles.includes(filePath)) {
      point.subChat.modifiedFiles.push(filePath);
    }

    this.persist();
  }

  /*
   * ============================================================
   * Plan Execution Control
   * ============================================================
   */

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

    if (!plan) {
      return undefined;
    }

    const completedPoints = new Set(plan.points.filter((p) => p.status === 'completed').map((p) => p.id));

    return plan.points.find(
      (point) => point.status === 'pending' && point.dependencies.every((depId) => completedPoints.has(depId)),
    );
  }

  /**
   * Deletes a plan and all its sub-chats.
   */
  deletePlan(planId: string): void {
    const plan = this.getPlan(planId);

    if (!plan) {
      return;
    }

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

    this.persist();
  }

  /**
   * Returns all plans (for debugging/admin).
   */
  getAllPlans(): Plan[] {
    return [...this._data.plans];
  }
}

export const planStore = PlanStore.getInstance();
