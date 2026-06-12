import type { Plan, PlanPoint, PlanStatus, VerificationType } from './types';
import { openDatabaseV3, setPlan, getPlan } from '../persistence/db-v3';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('PlanCreator');

/** Shape of a raw point as provided by the AI (MCP tool output). */
interface RawPlanPoint {
  title: string;
  description: string;
  verificationTypes: string[];
  dependencies: number[];
  requiredFiles: string[];
}

/** Parameters for creating a new plan. */
export interface CreatePlanParams {
  title: string;
  description: string;
  projectId: string;
  chatId: string;
  points: RawPlanPoint[];
}

// ─── Plan Creator ──────────────────────────────────────────

/**
 * PlanCreator — Creates and manages plan objects.
 *
 * The AI generates a plan via the create_plan MCP tool.
 * This module converts the AI's output into a structured Plan object
 * and provides CRUD operations for editing plans before approval.
 */
export class PlanCreator {
  /**
   * Create a new plan from the AI's request.
   *
   * @param request - The plan creation parameters
   * @returns The created Plan object
   */
  async createPlan(request: CreatePlanParams): Promise<Plan> {
    const { title, description, projectId, chatId, points: rawPoints } = request;

    logger.info(`Creating plan: "${title}" with ${rawPoints.length} points`);

    // 1. Map raw points to PlanPoint objects
    const points: PlanPoint[] = rawPoints.map((raw, index) => ({
      index,
      title: raw.title,
      description: raw.description,
      status: 'pending' as const,
      verificationTypes: this.parseVerificationTypes(raw.verificationTypes),
      dependencies: raw.dependencies.filter(
        (dep) => dep >= 0 && dep < rawPoints.length,
      ),
      requiredFiles: raw.requiredFiles ?? [],
    }));

    // 2. Calculate estimated tokens (rough: 2000 per point)
    const totalEstimatedTokens = points.length * 2000;

    // 3. Create the Plan object
    const plan: Plan = {
      id: crypto.randomUUID(),
      projectId,
      chatId,
      title,
      description,
      status: 'creating',
      points,
      totalEstimatedTokens,
      createdAt: new Date().toISOString(),
    };

    // 4. Persist to IndexedDB
    const db = await openDatabaseV3();

    if (db) {
      try {
        await setPlan(db, plan);
        logger.debug(`Plan persisted: ${plan.id}`);
      } catch (err) {
        logger.error('Failed to persist plan to IndexedDB', err);
      }
    } else {
      logger.warn('IndexedDB not available — plan will not be persisted');
    }

    return plan;
  }

  /**
   * Approve a plan (transition from 'creating' to 'approved').
   */
  async approvePlan(planId: string): Promise<void> {
    const db = await openDatabaseV3();

    if (!db) {
      throw new Error('IndexedDB is not available');
    }

    const plan = await getPlan(db, planId);

    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    if (plan.status !== 'creating') {
      logger.warn(`Cannot approve plan in "${plan.status}" status (expected "creating")`);
      return;
    }

    plan.status = 'approved';
    await setPlan(db, plan);

    logger.info(`Plan approved: "${plan.title}" (${planId})`);
  }

  /**
   * Update a plan point (e.g., user modifies a point before approval).
   */
  async updatePoint(
    planId: string,
    pointIndex: number,
    updates: Partial<PlanPoint>,
  ): Promise<void> {
    const db = await openDatabaseV3();

    if (!db) {
      throw new Error('IndexedDB is not available');
    }

    const plan = await getPlan(db, planId);

    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    const point = plan.points[pointIndex];

    if (!point) {
      throw new Error(
        `Point ${pointIndex} not found in plan ${planId} (plan has ${plan.points.length} points)`,
      );
    }

    // Apply updates — only allow modification of editable fields
    if (updates.title !== undefined) {
      point.title = updates.title;
    }
    if (updates.description !== undefined) {
      point.description = updates.description;
    }
    if (updates.verificationTypes !== undefined) {
      point.verificationTypes = updates.verificationTypes;
    }
    if (updates.dependencies !== undefined) {
      point.dependencies = updates.dependencies.filter(
        (dep) => dep >= 0 && dep < plan.points.length && dep !== pointIndex,
      );
    }
    if (updates.requiredFiles !== undefined) {
      point.requiredFiles = updates.requiredFiles;
    }
    if (updates.contextQuery !== undefined) {
      point.contextQuery = updates.contextQuery;
    }

    await setPlan(db, plan);

    logger.debug(`Updated point ${pointIndex} in plan ${planId}`);
  }

  /**
   * Add a point to an existing plan.
   * The new point is appended at the end with the next sequential index.
   */
  async addPoint(
    planId: string,
    point: Omit<PlanPoint, 'index' | 'status'>,
  ): Promise<void> {
    const db = await openDatabaseV3();

    if (!db) {
      throw new Error('IndexedDB is not available');
    }

    const plan = await getPlan(db, planId);

    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    const newIndex = plan.points.length;

    const newPoint: PlanPoint = {
      ...point,
      index: newIndex,
      status: 'pending',
    };

    plan.points.push(newPoint);

    // Recalculate estimated tokens
    plan.totalEstimatedTokens = plan.points.length * 2000;

    await setPlan(db, plan);

    logger.info(`Added point ${newIndex} ("${newPoint.title}") to plan ${planId}`);
  }

  /**
   * Remove a point from a plan.
   * Remaining points are re-indexed and dependencies are adjusted.
   */
  async removePoint(planId: string, pointIndex: number): Promise<void> {
    const db = await openDatabaseV3();

    if (!db) {
      throw new Error('IndexedDB is not available');
    }

    const plan = await getPlan(db, planId);

    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    if (pointIndex < 0 || pointIndex >= plan.points.length) {
      throw new Error(
        `Invalid point index ${pointIndex} for plan with ${plan.points.length} points`,
      );
    }

    // Remove the point
    const removed = plan.points.splice(pointIndex, 1)[0];
    logger.debug(`Removed point ${pointIndex} ("${removed.title}") from plan ${planId}`);

    // Re-index remaining points and adjust dependencies
    for (let i = 0; i < plan.points.length; i++) {
      plan.points[i].index = i;

      // Adjust dependencies: any dep > removedIndex should be decremented
      plan.points[i].dependencies = plan.points[i].dependencies
        .filter((dep) => dep !== pointIndex) // Remove deps on removed point
        .map((dep) => (dep > pointIndex ? dep - 1 : dep)); // Shift higher indices down
    }

    // Recalculate estimated tokens
    plan.totalEstimatedTokens = plan.points.length * 2000;

    await setPlan(db, plan);
  }

  /**
   * Reorder points in a plan.
   * newOrder is an array of current indices in the desired order.
   * Points are re-indexed after reordering.
   */
  async reorderPoints(planId: string, newOrder: number[]): Promise<void> {
    const db = await openDatabaseV3();

    if (!db) {
      throw new Error('IndexedDB is not available');
    }

    const plan = await getPlan(db, planId);

    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    if (newOrder.length !== plan.points.length) {
      throw new Error(
        `newOrder length (${newOrder.length}) does not match point count (${plan.points.length})`,
      );
    }

    // Validate all indices are within bounds and unique
    const indexSet = new Set(newOrder);
    if (indexSet.size !== newOrder.length) {
      throw new Error('newOrder contains duplicate indices');
    }
    for (const idx of newOrder) {
      if (idx < 0 || idx >= plan.points.length) {
        throw new Error(`Invalid index in newOrder: ${idx}`);
      }
    }

    // Reorder the points array
    const reordered = newOrder.map((idx) => plan.points[idx]);
    plan.points = reordered;

    // Re-index and rebuild dependency mapping
    const oldToNew = new Map<number, number>();
    for (let newIdx = 0; newIdx < newOrder.length; newIdx++) {
      oldToNew.set(newOrder[newIdx], newIdx);
    }

    for (let i = 0; i < plan.points.length; i++) {
      plan.points[i].index = i;

      // Map old dependency indices to new ones
      plan.points[i].dependencies = plan.points[i].dependencies
        .map((dep) => oldToNew.get(dep))
        .filter((dep): dep is number => dep !== undefined);
    }

    await setPlan(db, plan);

    logger.info(`Reordered ${plan.points.length} points in plan ${planId}`);
  }

  /**
   * Parse and validate verification types from string input.
   * Handles common variations like 'typecheck', 'type_check', 'typeCheck'.
   */
  private parseVerificationTypes(types: string[]): VerificationType[] {
    const normalized: VerificationType[] = [];

    for (const type of types) {
      const lower = type.toLowerCase().replace(/[-_\s]+/g, '-');

      switch (lower) {
        case 'lint':
        case 'eslint':
          normalized.push('lint');
          break;
        case 'type-check':
        case 'typecheck':
        case 'typescript':
        case 'tsc':
          normalized.push('type-check');
          break;
        case 'flow-verify':
        case 'flow-verify':
        case 'flow':
          normalized.push('flow-verify');
          break;
        case 'custom':
          normalized.push('custom');
          break;
        case 'none':
          // 'none' is handled separately — if it's the only type, skip verification
          break;
        default:
          logger.warn(`Unknown verification type: "${type}" — skipping`);
      }
    }

    return normalized;
  }
}

export const planCreator = new PlanCreator();
