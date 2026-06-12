'use client';

import { memo } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileCode,
  GitBranch,
  Route,
} from 'lucide-react';
import type { PointVerification } from '~/lib/planning/types';

// ─── Props ────────────────────────────────────────────────

interface VerificationResultsProps {
  result: PointVerification;
}

// ─── Error Row ─────────────────────────────────────────────

function ErrorRow({
  file,
  line,
  column,
  message,
  rule,
}: {
  file: string;
  line?: number;
  column?: number;
  message: string;
  rule?: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5 px-2 rounded-md bg-zinc-800/80">
      <FileCode className="w-3.5 h-3.5 text-zinc-500 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-400 font-mono truncate">{file}</span>
          {line != null && (
            <span className="text-zinc-600 flex-shrink-0">
              :{line}
              {column != null ? `:${column}` : ''}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-300 mt-0.5">{message}</p>
        {rule && (
          <span className="inline-block mt-0.5 text-[10px] text-zinc-500 font-mono bg-zinc-800 px-1 py-0.5 rounded">
            {rule}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Flow Issue Row ────────────────────────────────────────

function FlowIssueRow({
  type,
  severity,
  file,
  line,
  description,
  suggestion,
}: {
  type: string;
  severity: 'error' | 'warning';
  file: string;
  line?: number;
  description: string;
  suggestion: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5 px-2 rounded-md bg-zinc-800/80">
      <Route className="w-3.5 h-3.5 text-zinc-500 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-medium ${
              severity === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'
            }`}
          >
            {severity === 'error' ? <XCircle className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}
            {type}
          </span>
          <span className="text-zinc-500 font-mono truncate">{file}</span>
          {line != null && <span className="text-zinc-600 flex-shrink-0">:{line}</span>}
        </div>
        <p className="text-xs text-zinc-300 mt-0.5">{description}</p>
        {suggestion && (
          <p className="text-xs text-zinc-500 mt-0.5 italic">
            Suggestion: {suggestion}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────

function VerificationSection({
  icon: Icon,
  label,
  passed,
  errorCount,
  children,
}: {
  icon: typeof CheckCircle2;
  label: string;
  passed: boolean;
  errorCount: number;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon
          className={`w-3.5 h-3.5 ${passed ? 'text-green-400' : 'text-red-400'}`}
        />
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        {passed ? (
          <CheckCircle2 className="w-3 h-3 text-green-400" />
        ) : (
          <span className="inline-flex items-center gap-0.5 text-xs text-red-400">
            <XCircle className="w-3 h-3" />
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Verification Results ──────────────────────────────────

export const VerificationResults = memo(function VerificationResults({
  result,
}: VerificationResultsProps) {
  const hasLintErrors = result.lintErrors.length > 0;
  const hasTypeErrors = result.typeErrors.length > 0;
  const hasFlowIssues = result.flowIssues.length > 0;
  const hasContent = hasLintErrors || hasTypeErrors || hasFlowIssues;

  // If everything passed, show compact success
  if (result.allPassed && !hasContent) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-500/5 border border-green-500/20">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
        <span className="text-xs text-green-400">All checks passed</span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-zinc-700/50 bg-zinc-900 p-2.5 space-y-3">
      {/* ESLint Section */}
      <VerificationSection
        icon={FileCode}
        label="ESLint"
        passed={result.lintPassed}
        errorCount={result.lintErrors.length}
      >
        {hasLintErrors && (
          <div className="space-y-1.5">
            {result.lintErrors.map((err, i) => (
              <ErrorRow
                key={`lint-${i}`}
                file={err.file}
                line={err.line}
                column={err.column}
                message={err.message}
                rule={err.rule}
              />
            ))}
          </div>
        )}
      </VerificationSection>

      {/* TypeScript Section */}
      <VerificationSection
        icon={GitBranch}
        label="TypeScript"
        passed={result.typeCheckPassed}
        errorCount={result.typeErrors.length}
      >
        {hasTypeErrors && (
          <div className="space-y-1.5">
            {result.typeErrors.map((err, i) => (
              <ErrorRow
                key={`type-${i}`}
                file={err.file}
                line={err.line}
                column={err.column}
                message={err.message}
              />
            ))}
          </div>
        )}
      </VerificationSection>

      {/* Flow Verification Section */}
      <VerificationSection
        icon={Route}
        label="Flow Verification"
        passed={result.flowVerified}
        errorCount={result.flowIssues.length}
      >
        {hasFlowIssues && (
          <div className="space-y-1.5">
            {result.flowIssues.map((issue, i) => (
              <FlowIssueRow
                key={`flow-${i}`}
                type={issue.type}
                severity={issue.severity}
                file={issue.file}
                line={issue.line}
                description={issue.description}
                suggestion={issue.suggestion}
              />
            ))}
          </div>
        )}
      </VerificationSection>
    </div>
  );
});
