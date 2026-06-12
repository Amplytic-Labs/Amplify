import type { Message } from 'ai';

// ─── Project ──────────────────────────────────────────────
export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  chatIds: string[];
  techStack: string[];
  template?: string;
  settings: ProjectSettings;
}

export interface ProjectSettings {
  autoVerify: boolean;
  maxRetries: number;
  verifyOnEachPoint: boolean;
  flowVerification: boolean;
}

// ─── Plan ─────────────────────────────────────────────────
export type PlanStatus = 'creating' | 'approved' | 'executing' | 'paused' | 'completed' | 'failed';
export type PointStatus = 'pending' | 'executing' | 'verifying' | 'completed' | 'failed' | 'skipped';
export type VerificationType = 'lint' | 'type-check' | 'flow-verify' | 'custom' | 'none';

export interface Plan {
  id: string;
  projectId: string;
  chatId: string;
  title: string;
  description: string;
  status: PlanStatus;
  points: PlanPoint[];
  totalEstimatedTokens: number;
  createdAt: string;
  completedAt?: string;
  verificationResults?: PlanVerification;
}

export interface PlanPoint {
  index: number;
  title: string;
  description: string;
  status: PointStatus;
  verificationTypes: VerificationType[];
  dependencies: number[];
  contextQuery?: string;
  requiredFiles: string[];
  subChatId?: string;
  verificationResult?: PointVerification;
  tokenUsage?: TokenUsage;
}

// ─── Verification ─────────────────────────────────────────
export interface PointVerification {
  lintPassed: boolean;
  lintErrors: VerificationError[];
  typeCheckPassed: boolean;
  typeErrors: VerificationError[];
  flowVerified: boolean;
  flowIssues: FlowIssue[];
  customChecks: CustomCheck[];
  allPassed: boolean;
}

export interface PlanVerification {
  pointsTotal: number;
  pointsPassed: number;
  pointsFailed: number;
  pointsSkipped: number;
  totalTokenUsage: TokenUsage;
}

export interface VerificationError {
  file: string;
  line?: number;
  column?: number;
  message: string;
  rule?: string;
  severity: 'error' | 'warning';
}

export interface FlowIssue {
  type: 'button-no-action' | 'screen-not-reachable' | 'broken-link' | 'missing-import' | 'stub-function';
  severity: 'error' | 'warning';
  file: string;
  line?: number;
  description: string;
  suggestion: string;
}

export interface CustomCheck {
  name: string;
  passed: boolean;
  details: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ─── Sub-Chat ─────────────────────────────────────────────
export interface SubChat {
  id: string;
  planId: string;
  pointIndex: number;
  projectId: string;
  messages: Message[];
  contextUsed: string[];
  verificationResult?: PointVerification;
  tokenUsage: TokenUsage;
  startedAt: string;
  completedAt?: string;
  artifacts: string[];
}

// ─── Context Bundle (passed to sub-chats) ──────────────────
export interface ContextBundle {
  projectContext: string;
  userProfile: string;
  donts: string;
  retrievedIds: string[];
}

// ─── Plan Creation Request ────────────────────────────────
export interface PlanCreationRequest {
  title: string;
  description: string;
  points: {
    title: string;
    description: string;
    verificationTypes: VerificationType[];
    dependencies: number[];
    requiredFiles: string[];
  }[];
}

// ─── Plan Execution Events ────────────────────────────────
export type PlanEventType =
  | 'point-start'
  | 'point-complete'
  | 'point-fail'
  | 'plan-complete'
  | 'verification-result'
  | 'progress'
  | 'sub-chat-update';

export interface PlanEvent {
  type: PlanEventType;
  planId: string;
  pointIndex?: number;
  timestamp: string;
  data: Record<string, any>;
}