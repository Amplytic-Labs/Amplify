/**
 * Planning System — /docs/advanced/planning
 * Documents Amplify's ACTUAL planning system.
 */
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'Task contracts', href: '#task-contracts', level: 2 },
  { title: 'Execution engine', href: '#execution', level: 2 },
  { title: 'Sub-chat engine', href: '#sub-chat', level: 2 },
  { title: 'Checkpoints', href: '#checkpoints', level: 2 },
  { title: 'Plan approval', href: '#approval', level: 2 },
];

export default function PlanningPage() {
  return (
    <DocsArticle title="Planning System" toc={toc} back="/docs" metadata="Task contracts, sub-chat engine, and checkpoint-based execution">
      <h2 id="overview">Overview</h2>
      <p>
        Amplify includes a sophisticated <strong>planning system</strong> (<code>app/lib/planning/</code>) 
        that breaks complex requests into structured task steps. When the AI determines a request 
        requires multiple steps, it creates a plan with <strong>Task Contracts</strong> — enriched 
        descriptions of each step that guide execution.
      </p>
      <p>
        The planner runs as a client-side LLM wrapper that generates a structured plan, 
        then the execution engine processes each step sequentially with sub-conversations.
      </p>

      <h2 id="task-contracts">Task contracts</h2>
      <p>
        Each plan step is defined as a <code>DraftPlanPoint</code> or <code>PlannerPlanPoint</code> 
        with:
      </p>
      <ul>
        <li><strong>Task description</strong> — What the step accomplishes</li>
        <li><strong>Context</strong> — Relevant files, dependencies, and state</li>
        <li><strong>Skill resolution</strong> — Which skills to apply for this step</li>
        <li><strong>Expected output</strong> — What the step should produce</li>
      </ul>
      <p>
        The <code>SkillLoader</code> resolves relevant skills for each step, 
        injecting them into the sub-chat context.
      </p>

      <h2 id="execution">Execution engine</h2>
      <p>
        The <code>ExecutionManager</code> processes plan steps sequentially:
      </p>
      <ul>
        <li><code>execution-state.ts</code> — Mutable execution tracking</li>
        <li><code>execution-manager.ts</code> — Step execution logic with error handling</li>
        <li><code>tool-output-cache.ts</code> — Caches tool outputs for reuse across steps</li>
      </ul>
      <p>
        Steps are executed via the <code>addToExecutionQueue</code> method in the workbench store, 
        which runs actions serially.
      </p>

      <h2 id="sub-chat">Sub-chat engine</h2>
      <p>
        The <code>SubChatEngine</code> creates separate mini-conversations for each plan step. 
        Each sub-chat:
      </p>
      <ul>
        <li>Has its own context built from the task contract</li>
        <li>Uses the <code>ContextBuilder</code> to assemble relevant files and history</li>
        <li>Can invoke native tools independently</li>
        <li>Returns results that feed into the next step</li>
      </ul>

      <h2 id="checkpoints">Checkpoints</h2>
      <p>
        The <code>Checkpoint</code> system saves the file state before each plan step. 
        This enables:
      </p>
      <ul>
        <li>Rollback to any previous step if execution fails</li>
        <li>Version history for reviewing what changed at each step</li>
        <li>Comparison between steps to track progress</li>
      </ul>

      <h2 id="approval">Plan approval</h2>
      <p>
        Before executing a plan, Amplify shows a <strong>PlanApprovalDialog</strong> with 
        the full plan outline. You can:
      </p>
      <ul>
        <li>Review each step before execution begins</li>
        <li>Approve or reject the entire plan</li>
        <li>Modify individual steps (future feature)</li>
      </ul>
      <p>
        The <code>PlanView</code> component renders the plan with numbered steps 
        and visual progress indicators.
      </p>
    </DocsArticle>
  );
}
