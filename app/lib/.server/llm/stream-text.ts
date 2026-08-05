import {
  convertToModelMessages,
  streamText as _streamText,
  type UIMessage,
  type UIMessageStreamWriter,
  isToolUIPart,
} from 'ai';
import { MAX_TOKENS, PROVIDER_COMPLETION_LIMITS, isReasoningModel, type FileMap } from './constants';
import { getSystemPrompt } from '~/lib/common/prompts/new-prompt';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  MODIFICATIONS_TAG_NAME,
  PROVIDER_LIST,
  STARTER_TEMPLATES,
  WORK_DIR,
} from '~/utils/constants';
import type { IProviderSetting } from '~/types/model';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { allowedHTMLElements } from '~/utils/markdown';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';
import { extractPropertiesFromMessage, simplifyBoltActions } from './utils';
import { discussPrompt } from '~/lib/common/prompts/discuss-prompt';
import type { DesignScheme } from '~/types/design-scheme';
import { z } from 'zod';
import { fetchWebPage } from '~/lib/utils/web-fetch';
import { getTemplates } from '~/utils/selectStarterTemplate';
import { SkillLoader } from '~/lib/services/skillLoader';
import { stripChatName } from '~/lib/chat/chatname';
import { getToolState, getToolOutput } from '~/lib/chat/tool-parts';
import { buildThinkingProviderOptions, supportsThinkingConfig } from './thinking';
import { preFlightCheck, estimateRequestTokens, shrinkMessagesToFit, type RateLimitConfig } from './rate-limit';

export type Messages = UIMessage[];

/**
 * Enforce strict user/assistant message alternation for providers like
 * Google Gemini that reject malformed turn sequences.
 *
 * Rules enforced:
 *   1. First message must be from the user (drop leading assistant messages).
 *   2. No consecutive same-role messages — merge consecutive user messages
 *      and consecutive assistant messages.
 *   3. Assistant messages with tool calls that have no corresponding function
 *      response (orphaned tool calls) are stripped of those tool parts.
 *   4. If an assistant message ends up empty after stripping, it is dropped.
 */
function enforceMessageAlternation(messages: any[], logger: ReturnType<typeof createScopedLogger>): any[] {
  if (!messages.length) {
    return messages;
  }

  // Step 1: Drop leading assistant messages (first turn must be user)
  let result = [...messages];

  while (result.length > 0 && result[0].role === 'assistant') {
    logger.debug('[alternation] Dropped leading assistant message');
    result = result.slice(1);
  }

  if (!result.length) {
    return result;
  }

  // Step 2: Merge consecutive same-role messages
  const merged: UIMessage[] = [result[0]];

  for (let i = 1; i < result.length; i++) {
    const msg = result[i];
    const last = merged[merged.length - 1];

    if (msg.role === last.role) {
      // Same role — merge parts and content
      const lastParts = (last as any).parts || [];
      const msgParts = (msg as any).parts || [];

      (last as any).parts = [...lastParts, ...msgParts];

      // Also merge content string if present
      const lastContent = (last as any).content || '';
      const msgContent = (msg as any).content || '';

      if (msgContent) {
        (last as any).content = lastContent + msgContent;
      }

      // Merge annotations
      const lastAnnotations = (last as any).annotations || [];
      const msgAnnotations = (msg as any).annotations || [];
      (last as any).annotations = [...lastAnnotations, ...msgAnnotations];

      logger.debug(`[alternation] Merged consecutive ${msg.role} messages`);
    } else {
      merged.push(msg);
    }
  }

  /*
   * Step 3: Strip orphaned tool calls from assistant messages
   * A tool call is "orphaned" if it appears in the LAST assistant message
   * (no subsequent user message with function response to follow it).
   * For Gemini, the last assistant message's tool calls are fine because
   * the model will generate the next response. But tool calls in earlier
   * assistant messages that have no matching function response are problematic.
   * The convertToModelMessages function handles this, but we need to ensure
   * that tool calls in non-last assistant messages have been resolved.
   */

  // Step 4: Drop empty assistant messages after all cleanup
  const final = merged.filter((msg, _idx) => {
    if (msg.role !== 'assistant') {
      return true;
    }

    const parts = (msg as any).parts || [];
    const content = (msg as any).content || '';

    // Has text content? Keep it.
    const hasText =
      parts.some((p: any) => p.type === 'text' && typeof p.text === 'string' && p.text.trim().length > 0) ||
      (typeof content === 'string' && content.trim().length > 0);

    // Has reasoning content? Keep it.
    const hasReasoning = parts.some((p: any) => p.type === 'reasoning');

    // Has tool parts with results? Keep it.
    const hasToolResult = parts.some((p: any) => {
      const isToolPart = (typeof p.type === 'string' && p.type.startsWith('tool-')) || !!p.toolCallId;
      return isToolPart;
    });

    if (!hasText && !hasReasoning && !hasToolResult) {
      logger.debug('[alternation] Dropped empty assistant message after merge');
      return false;
    }

    return true;
  });

  /*
   * Step 5: Re-enforce alternation after filtering (filtering may have created
   * consecutive same-role messages again)
   */
  const reenforced: UIMessage[] = final.length > 0 ? [final[0]] : [];

  for (let i = 1; i < final.length; i++) {
    const msg = final[i];
    const last = reenforced[reenforced.length - 1];

    if (msg.role === last.role) {
      // Same role again after filtering — merge
      const lastParts = (last as any).parts || [];
      const msgParts = (msg as any).parts || [];
      (last as any).parts = [...lastParts, ...msgParts];

      const lastContent = (last as any).content || '';
      const msgContent = (msg as any).content || '';

      if (msgContent) {
        (last as any).content = lastContent + msgContent;
      }

      logger.debug(`[alternation] Re-merged consecutive ${msg.role} messages after cleanup`);
    } else {
      reenforced.push(msg);
    }
  }

  return reenforced;
}

/**
 * Project-marker filenames that indicate the workspace already contains an
 * initialized project (via inject_template, a GitHub clone, or a user-picked
 * template). When ANY of these are present, the `inject_template` tool is
 * withheld from the model so it cannot hallucinate a re-injection.
 */
const PROJECT_MARKER_FILES = [
  'package.json', // JS / TS / Node
  'index.html', // Vite / static
  'Cargo.toml', // Rust
  'go.mod', // Go
  'requirements.txt', // Python (pip)
  'pyproject.toml', // Python (modern)
  'Gemfile', // Ruby
  'pom.xml', // Java (Maven)
  'build.gradle', // Java (Gradle)
  'composer.json', // PHP
  'pubspec.yaml', // Flutter / Dart
];

/**
 * Returns true when the workspace FileMap already contains an initialized
 * project. This covers all three project-initiation paths:
 *   1. AI called `inject_template` (files were written to the WebContainer)
 *   2. User picked a starter template (same — files written)
 *   3. User cloned a GitHub repo (files written)
 *
 * Detection: any known project-marker file at the root, OR a non-trivial
 * number of files (>5) indicating an established workspace.
 */
function workspaceHasProject(files: FileMap | undefined): boolean {
  if (!files) {
    return false;
  }

  const entries = Object.keys(files);

  if (entries.length === 0) {
    return false;
  }

  // Check for a known project-marker file at the workspace root.
  const hasMarker = entries.some((path) => {
    // Normalize: strip leading ./ or / and check exact match at root.
    const normalized = path.replace(/^\.{0,2}\//, '');
    return PROJECT_MARKER_FILES.includes(normalized);
  });

  if (hasMarker) {
    return true;
  }

  /*
   * Fallback: a workspace with more than 5 files is almost certainly an
   * established project, even without a recognized marker.
   */
  return entries.length > 5;
}

export interface StreamingOptions extends Omit<Parameters<typeof _streamText>[0], 'model'> {
  supabaseConnection?: {
    isConnected: boolean;
    hasSelectedProject: boolean;
    credentials?: {
      anonKey?: string;
      supabaseUrl?: string;
    };
  };
}

const logger = createScopedLogger('stream-text');

function getCompletionTokenLimit(modelDetails: any): number {
  // 1. If model specifies completion tokens, use that
  if (modelDetails.maxCompletionTokens && modelDetails.maxCompletionTokens > 0) {
    return modelDetails.maxCompletionTokens;
  }

  // 2. Use provider-specific default
  const providerDefault = PROVIDER_COMPLETION_LIMITS[modelDetails.provider];

  if (providerDefault) {
    return providerDefault;
  }

  // 3. Final fallback to MAX_TOKENS, but cap at reasonable limit for safety
  return Math.min(MAX_TOKENS, 16384);
}

function sanitizeText(text: string): string {
  let sanitized = text.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
  sanitized = sanitized.replace(/<(think|thought)>.*?<\/(think|thought)>/s, '');
  sanitized = sanitized.replace(/<boltAction type="file" filePath="package-lock\.json">[\s\S]*?<\/boltAction>/g, '');

  /*
   * Strip the CONTENTS of every <amplifyAction type="file"> tag before the
   * text reaches the LLM. The file PATH (filePath attribute) is preserved so
   * the model still knows which files exist in the workspace (the "file
   * tree"), but the raw source code is removed. This prevents a single
   * cloned-repo / template-injection message — which can carry hundreds of KB
   * of source — from consuming the entire context window on EVERY subsequent
   * turn. The model can retrieve actual contents on demand via read_file.
   *
   * The full contents remain in the stored messages (IndexedDB) so the
   * client message parser can still write them to the WebContainer on load;
   * this only affects the text sent to the model.
   */
  sanitized = simplifyBoltActions(sanitized);

  return sanitized.trim();
}

export async function streamText(props: {
  messages: Omit<UIMessage, 'id'>[];
  env?: Env;
  options?: StreamingOptions;
  apiKeys?: Record<string, string>;
  files?: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  contextFiles?: FileMap;
  summary?: string;
  messageSliceId?: number;
  chatMode?: 'discuss' | 'build';
  designScheme?: DesignScheme;
  skills?: string;
  memory?: string;
  dataStream?: UIMessageStreamWriter;
  userContext?: string;
  projectContext?: string;

  /**
   * True when the chat is continuing work inside an ALREADY-LOADED project
   * workspace (i.e. the WebContainer has the project's files and a running
   * dev server). When true, a dedicated continuation prompt is appended so
   * the model works WITH the existing workspace instead of reinitializing.
   */
  projectContinuation?: boolean;

  /**
   * Unified thinking/reasoning config from the ChatBox settings popup.
   * Translated into per-provider `providerOptions` via
   * `buildThinkingProviderOptions` (see ./thinking.ts).
   */
  modelConfig?: {
    thinkingEnabled: boolean;
    budgetTokens: number;
    effort: 'low' | 'medium' | 'high';
    maxOutputTokens: number;
  };

  /**
   * Per-provider rate-limit config (RPM / TPM / RPD) entered by the user.
   * Used for pre-flight TPM checks and RPM throttling before the API call.
   */
  rateLimit?: {
    rpm: number;
    tpm: number;
    rpd: number;
    autoShrinkToTpm: boolean;
  };
}) {
  const {
    messages,
    env: serverEnv,
    options,
    apiKeys,
    files,
    providerSettings,
    promptId,
    contextOptimization,
    contextFiles,
    summary,
    chatMode,
    designScheme,
    skills,
    memory,
    userContext,
    projectContext,
    projectContinuation,
    modelConfig,
    rateLimit,
  } = props;
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  let processedMessages = messages.map((message) => {
    const newMessage = { ...message };

    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;

      // In UIMessage, content is accessed via parts; store sanitized content for compatibility
      if (typeof content === 'string') {
        (newMessage as any).content = sanitizeText(content);
      }
    } else if (message.role == 'assistant') {
      const textContent = Array.isArray(message.parts)
        ? message.parts
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('')
        : (message as any).content || '';

      /*
       * Strip any `<chatname>…</chatname>` tag the model emitted on a
       * PREVIOUS turn. The tag is a one-shot naming signal consumed by
       * the client on the first response; it must NEVER be re-sent to
       * the model on subsequent turns (the model should not "see" its
       * own prior chatname, and the user should never see it either).
       */
      (newMessage as any).content = sanitizeText(stripChatName(textContent));
    }

    // Sanitize all text parts in parts array, if present
    if (Array.isArray(message.parts)) {
      newMessage.parts = message.parts.map((part) => {
        if (part.type === 'text') {
          /*
           * For ASSISTANT text parts, also strip `<chatname>` tags so the
           * one-shot naming signal never leaks back into the model's
           * context on subsequent turns. (For user parts this is a no-op
           * since users never emit the tag.)
           */
          const stripped = message.role === 'assistant' ? stripChatName(part.text) : part.text;

          return { ...part, text: sanitizeText(stripped) };
        }

        /*
         * Truncate large tool results (read_file, grep_search, etc.) to
         * prevent token bloat from accumulating file contents in message
         * history. On every turn ALL previous messages (including tool
         * results) are re-sent to the LLM, so un-truncated read_file
         * results cause exponential token growth.
         *
         * We replace the full result with a summary so the model knows
         * the file was read but must re-read it if it needs the content.
         *
         * V7 MIGRATION (Task 3b): tool parts now use the FLAT v7 shape —
         * `type: 'tool-<name>'` / `'dynamic-tool'`, with `output` instead
         * of nested `toolInvocation.result`. We use `isToolUIPart` from
         * `ai` for the type check (accepts both static and dynamic), and
         * the shared `getToolState` / `getToolOutput` helpers so legacy
         * v4 parts (still in IndexedDB for old chats) are also truncated.
         */
        const partAny = part as any;

        if (isToolUIPart(partAny)) {
          const partState = getToolState(partAny);
          const result = getToolOutput(partAny);

          if (
            (partState === 'output-available' || partState === 'result') &&
            typeof result === 'string' &&
            result.length > 3000
          ) {
            const truncatedResult =
              result.slice(0, 2000) + '\n\n... [truncated for context efficiency — use read_file to re-read if needed]';

            const legacy: any = partAny as any;
            const updatedPart: any = { ...partAny, output: truncatedResult };

            if (legacy.toolInvocation) {
              updatedPart.toolInvocation = { ...legacy.toolInvocation, result: truncatedResult };
            }

            return updatedPart as any;
          }
        }

        return part;
      });
    }

    return newMessage;
  });

  /*
   * GEMINI / STRICT-ALTERNATION SANITIZATION
   * ------------------------------------------
   * Google Gemini (and some other providers) require that every function-call
   * part in an assistant turn is IMMEDIATELY followed by a function-response
   * turn. Tool parts that are still in `input-available` or `input-streaming`
   * state have NOT received a result yet — they are incomplete. If we send
   * them to the API, Gemini rejects with:
   *
   *   "Please ensure that function call turn comes immediately after a user
   *    turn or after a function response turn."
   *
   * This happens when:
   *   1. A tool call failed (error thrown before the result was persisted).
   *   2. The user submitted a new message before the previous tool resolved.
   *   3. A client-side tool (search_user_context, store_user_fact) ran on the
   *      browser but its result wasn't yet flushed back to the SDK.
   *
   * Fix: strip all tool parts whose state is NOT a terminal result state
   * ('output-available', 'output-error', 'output-denied', legacy 'result').
   * If stripping leaves an assistant message with no meaningful content,
   * drop that message entirely.
   */
  const TERMINAL_TOOL_STATES = new Set(['output-available', 'output-error', 'output-denied', 'result']);

  processedMessages = processedMessages.filter((message) => {
    if (message.role !== 'assistant') {
      return true;
    }

    if (!Array.isArray((message as any).parts)) {
      return true;
    }

    // Strip incomplete tool parts in-place
    const cleanedParts = (message as any).parts.filter((part: any) => {
      const isToolPart = (typeof part.type === 'string' && part.type.startsWith('tool-')) || !!part.toolCallId;

      if (!isToolPart) {
        return true; // keep non-tool parts (text, reasoning, etc.)
      }

      const state: string = part.state || part.toolInvocation?.state || '';

      // Keep only tool parts that have a terminal result
      return TERMINAL_TOOL_STATES.has(state);
    });

    // Check if the message still has any meaningful content after stripping
    const hasText = cleanedParts.some(
      (p: any) => p.type === 'text' && typeof p.text === 'string' && p.text.trim().length > 0,
    );
    const hasToolResult = cleanedParts.some((p: any) => {
      const isToolPart = (typeof p.type === 'string' && p.type.startsWith('tool-')) || !!p.toolCallId;
      return isToolPart;
    });

    if (!hasText && !hasToolResult) {
      // Nothing left — drop the entire message to avoid an empty assistant turn
      logger.debug('[sanitize] Dropped empty assistant message (all tool parts were incomplete)');
      return false;
    }

    // Update the parts in-place
    (message as any).parts = cleanedParts;

    return true;
  });

  /*
   * GEMINI / STRICT-ALTERNATION — ENFORCE VALID TURN ORDER
   * -------------------------------------------------------
   * After the incomplete-tool sanitization above, the message sequence
   * may still violate Gemini's strict alternation rules:
   *
   *   - Every functionCall must be immediately followed by a functionResponse
   *   - No consecutive assistant turns (each assistant turn must be followed
   *     by a user turn or a functionResponse turn)
   *   - The first message must be a user turn
   *
   * Common causes after sanitization:
   *   1. Dropping an empty assistant message leaves two user messages adjacent
   *   2. An assistant message with only tool calls (no text) followed by another
   *      assistant message creates consecutive assistant turns
   *   3. A tool call whose function response was in a later dropped message
   *
   * Fix: walk the message list and enforce strict user/assistant alternation.
   * If we find consecutive same-role messages, merge them. If we find an
   * assistant message with tool calls that has no matching function response
   * (because the response was in a dropped message), strip those orphaned
   * tool calls.
   */
  processedMessages = enforceMessageAlternation(processedMessages, logger) as typeof processedMessages;

  const provider = PROVIDER_LIST.find((p) => p.name === currentProvider) || DEFAULT_PROVIDER;
  const staticModels = LLMManager.getInstance().getStaticModelListFromProvider(provider);
  let modelDetails = staticModels.find((m) => m.name === currentModel);

  if (!modelDetails) {
    const modelsList = [
      ...(provider.staticModels || []),
      ...(await LLMManager.getInstance().getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv: serverEnv as any,
      })),
    ];

    if (!modelsList.length) {
      throw new Error(`No models found for provider ${provider.name}`);
    }

    modelDetails = modelsList.find((m) => m.name === currentModel);

    if (!modelDetails) {
      // Fallback to first model with warning
      logger.warn(
        `MODEL [${currentModel}] not found in provider [${provider.name}]. Falling back to first model. ${modelsList[0].name}`,
      );
      modelDetails = modelsList[0];
    }
  }

  const dynamicMaxTokens = modelDetails ? getCompletionTokenLimit(modelDetails) : Math.min(MAX_TOKENS, 16384);

  // Use model-specific limits directly - no artificial cap needed
  const safeMaxTokens = dynamicMaxTokens;

  logger.info(
    `Token limits for model ${modelDetails.name}: maxTokens=${safeMaxTokens}, maxTokenAllowed=${modelDetails.maxTokenAllowed}, maxCompletionTokens=${modelDetails.maxCompletionTokens}`,
  );

  let systemPrompt =
    PromptLibrary.getPropmtFromLibrary(promptId || 'default', {
      cwd: WORK_DIR,
      allowedHtmlElements: allowedHTMLElements,
      modificationTagName: MODIFICATIONS_TAG_NAME,
      designScheme,
      skills,
      memory,
      userContext,
      projectContext,
      supabase: {
        isConnected: options?.supabaseConnection?.isConnected || false,
        hasSelectedProject: options?.supabaseConnection?.hasSelectedProject || false,
        credentials: options?.supabaseConnection?.credentials || undefined,
      },
    }) ??
    getSystemPrompt({
      cwd: WORK_DIR,
      allowedHtmlElements: allowedHTMLElements,
      modificationTagName: MODIFICATIONS_TAG_NAME,
    });

  const isFirstMessage = !processedMessages.some((m) => m.role === 'assistant');

  const chatNamingInstruction = isFirstMessage
    ? `<chat_naming>
  CRITICAL — This is the FIRST message of a new conversation. Your
  response MUST begin with a single line of the form:

      <chatname>a short 2-6 word title for this chat</chatname>

  This tag MUST be the VERY FIRST thing you output — before any
  reasoning, before any thought block, before any tool calls, before
  any markdown. The runtime extracts this tag to name the chat in the
  sidebar; if you don't emit it, the chat stays unnamed.

  Rules for the title:
  - 2 to 6 words, no quotes, no trailing punctuation.
  - Title Case (capitalize major words).
  - Capture the core intent of the user's request.
  - Output the tag ONCE, at the very start of your response, then
    continue with your normal answer.
  - Do NOT mention the tag or the title to the user.
  - Do NOT output this tag again in any future message.

  CORRECT:
      <chatname>Build React Dashboard</chatname>
      Sure — let's scaffold...

  WRONG (tag inside reasoning):
      <thought>The user wants a dashboard. I should output
      <chatname>Build Dashboard</chatname></thought>
      <chatname>Build React Dashboard</chatname>
      Sure...

  WRONG (tag omitted):
      Sure, let's build that dashboard...
</chat_naming>\n\n`
    : '';

  if (chatNamingInstruction && chatMode === 'build') {
    systemPrompt = chatNamingInstruction + systemPrompt;
  }

  /*
   * CURRENT DATE — injected on every request so the AI knows what "today"
   * is. Without this, the AI hallucinates dates (e.g. claims a 2024 release
   * is "recent" when it's actually 2026) and conflicts with web_search
   * results that contain the real current date. The AI must defer to web
   * search results for any time-sensitive fact.
   */
  const now = new Date();
  const dateString = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const timeString = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

  systemPrompt = `<current_datetime>
  Today's date: ${dateString}
  Current time (UTC): ${timeString}

  CRITICAL — Your training data has a cutoff date and is STALE for anything
  time-sensitive (library versions, release dates, recent events, current
  prices, API changes). When a user asks about anything that could have
  changed since your training cutoff:
    1. Use \`web_search\` to get the CURRENT information.
    2. PRIORITIZE web search results over your internal knowledge — your
       internal knowledge may be outdated by months or years.
    3. If web search results conflict with what you "remember", trust the
       web search results (they are more recent).
    4. Always cite the source URL when providing time-sensitive information.
</current_datetime>

${systemPrompt}`;

  if (chatMode === 'build' && contextFiles && contextOptimization) {
    /*
     * List only the PATHS of the context files — NOT their full contents.
     *
     * Previously this called createFilesContext(contextFiles, true) which
     * injected the full source code of ~5 files into the system prompt on
     * every turn. That caused:
     *   1. Token bloat (~7-8k extra prompt tokens per turn)
     *   2. The AI could answer file-content questions WITHOUT calling any
     *      tool, because the contents were already in its context — which
     *      looked like "silent code leakage" to the user.
     *
     * Now the AI sees only the file paths and must use its tools
     * (read_file / str_replace_editor) to access actual contents when it
     * needs them.
     */
    const contextPaths = Object.keys(contextFiles)
      .filter((p) => contextFiles[p]?.type === 'file')
      .map((p) => p.replace('/home/project/', ''));

    systemPrompt = `${systemPrompt}

    Below is the list of files currently in the project workspace that you may need to read or modify to fulfill the user's request. Use your file-reading tools to access their contents when needed — do NOT assume you already know their contents.
    WORKSPACE FILES:
    ---
    ${contextPaths.map((p) => `- ${p}`).join('\n')}
    ---
    `;

    if (summary) {
      systemPrompt = `${systemPrompt}
      below is the chat history till now
      CHAT SUMMARY:
      ---
      ${props.summary}
      ---
      `;

      if (props.messageSliceId) {
        processedMessages = processedMessages.slice(props.messageSliceId);
      } else {
        const lastMessage = processedMessages.pop();

        if (lastMessage) {
          processedMessages = [lastMessage];
        }
      }
    }
  }

  const effectiveLockedFilePaths = new Set<string>();

  if (files) {
    for (const [filePath, fileDetails] of Object.entries(files)) {
      if (fileDetails?.isLocked) {
        effectiveLockedFilePaths.add(filePath);
      }
    }
  }

  if (effectiveLockedFilePaths.size > 0) {
    const lockedFilesListString = Array.from(effectiveLockedFilePaths)
      .map((filePath) => `- ${filePath}`)
      .join('\n');
    systemPrompt = `${systemPrompt}

    IMPORTANT: The following files are locked and MUST NOT be modified in any way. Do not suggest or make any changes to these files. You can proceed with the request but DO NOT make any changes to these files specifically:
    ${lockedFilesListString}
    ---
    `;
  } else {
    console.log('No locked files found from any source for prompt.');
  }

  /*
   * Guardrail: when the workspace already contains an initialized project
   * (via inject_template, a GitHub clone, or a user-picked template), tell
   * the model explicitly NOT to re-inject a template or reinitialize the
   * project. This prevents the model from hallucinating a fresh template
   * injection on top of an existing codebase.
   */
  const workspaceInitialized = workspaceHasProject(files);

  if (workspaceInitialized) {
    systemPrompt = `${systemPrompt}

<workspace_guardrails>
  CRITICAL — An existing project is ALREADY loaded in the workspace.

  - Do NOT call inject_template. The project has already been initialized
    (files, dependencies, and a running dev server are in place).
  - Do NOT create a new amplifyArtifact template or attempt to
    re-scaffold the project from scratch.
  - Treat the EXISTING workspace files as the single source of truth. Read
    them, understand the architecture, and make targeted edits.
  - If the user asks for a new feature, implement it within the existing
    project structure — do not start over.
  - Only reinitialize if the user EXPLICITLY asks to replace the entire
    project.
</workspace_guardrails>
    `;
  }

  /*
   * Continuation prompt: when this is a chat inside an already-loaded
   * project workspace (e.g. a "New chat in project" or any subsequent
   * turn in a project chat), append a dedicated prompt so the model
   * understands it should work WITH the existing workspace rather than
   * starting from scratch.
   */
  if (projectContinuation) {
    systemPrompt = `${systemPrompt}

<project_continuation>
  You are continuing work inside an EXISTING project workspace.

  - The WebContainer already has the project's files, dependencies are
    installed, and the dev server is running. You do NOT need to set up
    or install anything to get started.
  - Before making changes, review the project file tree and key files
    (package.json, main entry point, routing) to understand the
    architecture and conventions already in place.
  - Make incremental, surgical edits that fit the existing codebase. 
    Match the project's existing patterns, naming conventions, and 
    structure.
  - If this is the FIRST message in a new chat within the project, start 
    by briefly acknowledging what you see in the workspace, then address 
    the user's request directly.
  - Do NOT re-explain the project setup, re-run install, or re-inject 
    templates unless the user explicitly asks for it.
</project_continuation>
    `;
  }

  logger.info(`Sending llm call to ${provider.name} with model ${modelDetails.name}`);

  // Log reasoning model detection and token parameters
  const isReasoning = isReasoningModel(modelDetails.name, modelDetails.capabilities);
  logger.info(
    `Model "${modelDetails.name}" is reasoning model: ${isReasoning}, using ${isReasoning ? 'maxCompletionTokens' : 'maxTokens'}: ${safeMaxTokens}`,
  );

  // Validate token limits before API call
  if (safeMaxTokens > (modelDetails.maxTokenAllowed || 128000)) {
    logger.warn(
      `Token limit warning: requesting ${safeMaxTokens} tokens but model supports max ${modelDetails.maxTokenAllowed || 128000}`,
    );
  }

  /*
   * Use maxCompletionTokens for reasoning models (o1, GPT-5), maxTokens for traditional models.
   * NOTE: the actual tokenParams used in streamParams are computed later as
   * `effectiveTokenParams` (which folds in the user's maxOutputTokens override).
   * This declaration is kept only for the `isReasoning ? { temperature: 1 }` block below.
   */

  // Filter out unsupported parameters for reasoning models
  const filteredOptions =
    isReasoning && options
      ? Object.fromEntries(
          Object.entries(options).filter(
            ([key]) =>
              ![
                'temperature',
                'topP',
                'presencePenalty',
                'frequencyPenalty',
                'logprobs',
                'topLogprobs',
                'logitBias',
              ].includes(key),
          ),
        )
      : options || {};

  // DEBUG: Log filtered options
  logger.info(
    `DEBUG STREAM: Options filtering for model "${modelDetails.name}":`,
    JSON.stringify(
      {
        isReasoning,
        originalOptions: options || {},
        filteredOptions,
        originalOptionsKeys: options ? Object.keys(options) : [],
        filteredOptionsKeys: Object.keys(filteredOptions),
        removedParams: options ? Object.keys(options).filter((key) => !(key in filteredOptions)) : [],
      },
      null,
      2,
    ),
  );

  const modelInstance = provider.getModelInstance({
    model: modelDetails.name,
    serverEnv,
    apiKeys,
    providerSettings,
  });

  /*
   * RATE-LIMIT PRE-FLIGHT (RPM / TPM / RPD)
   * ----------------------------------------
   * The user inputs their provider's actual limits in the ChatBox
   * settings popup (we cannot reliably know them — they vary by tier,
   * account, and payment status). Here we:
   *
   *   1. Estimate the request's token count from the message bodies.
   *   2. Run the pre-flight check (see ./rate-limit.ts).
   *   3. If the check says to throttle, sleep `throttleMs` before sending.
   *   4. If the check says to auto-shrink, drop older messages from the
   *      head of `processedMessages` until the estimate fits.
   *   5. If the check says to hard-reject, throw with a user-readable
   *      error so the UI surfaces a clear "would exceed X" message
   *      instead of a generic 429 from the provider.
   *
   * NOTE: this runs ON THE SERVER, per-request. The counters are
   * in-memory and per-instance (see ./rate-limit.ts header comment).
   */
  if (rateLimit && (rateLimit.rpm > 0 || rateLimit.tpm > 0 || rateLimit.rpd > 0)) {
    const estimatedTokens = estimateRequestTokens(processedMessages as any, systemPrompt, safeMaxTokens);

    const preFlight = preFlightCheck(provider.name, rateLimit as RateLimitConfig, estimatedTokens);

    if (preFlight.message) {
      logger.info(`[rate-limit] ${provider.name}: ${preFlight.message}`);
    }

    // Hard reject — surface a clean error to the user.
    if (!preFlight.ok) {
      const errMsg =
        preFlight.message ?? `Rate limit (${preFlight.reason?.toUpperCase()}) would be exceeded for ${provider.name}.`;

      logger.warn(`[rate-limit] REJECTING request for ${provider.name}: ${errMsg}`);
      throw new Error(errMsg);
    }

    // Throttle — sleep before sending.
    if (preFlight.throttleMs > 0) {
      logger.info(`[rate-limit] Throttling ${preFlight.throttleMs}ms before sending to ${provider.name}…`);
      await new Promise((resolve) => setTimeout(resolve, preFlight.throttleMs));
    }

    // Auto-shrink — drop older messages from the head.
    if (preFlight.shrinkToTokens !== undefined && preFlight.shrinkToTokens > 0) {
      const shrunk = shrinkMessagesToFit(
        processedMessages as any,
        systemPrompt,
        safeMaxTokens,
        preFlight.shrinkToTokens,
      );

      if (shrunk.length < processedMessages.length) {
        logger.info(
          `[rate-limit] Shrunk ${processedMessages.length - shrunk.length} older message(s) ` +
            `to fit TPM budget for ${provider.name}.`,
        );
        processedMessages = shrunk as typeof processedMessages;
      }
    }
  }

  /*
   * THINKING / REASONING providerOptions
   * ------------------------------------
   * Translate the unified `modelConfig` (edited by the ChatBox settings
   * popup) into the per-provider `providerOptions` shape the Vercel AI
   * SDK expects. This is the CRITICAL wiring that was missing — without
   * it, the thinking toggle / effort slider in the UI had zero effect
   * on the actual API request.
   *
   * For Gemini specifically, `includeThoughts: true` MUST be set or
   * the API silently discards thought tokens even when the model is
   * "thinking" internally.
   *
   * See ./thinking.ts for the full per-provider breakdown.
   */
  const thinkingProviderOptions = buildThinkingProviderOptions(
    provider.name,
    modelDetails.name,
    modelConfig,
    modelDetails.capabilities,
  );

  const hasThinkingOpts = supportsThinkingConfig(provider.name, modelDetails.name, modelDetails.capabilities);

  if (hasThinkingOpts) {
    logger.info(
      `[thinking] providerOptions for ${provider.name}/${modelDetails.name}: ` +
        JSON.stringify(thinkingProviderOptions),
    );
  }

  /*
   * User-configured maxOutputTokens (from the ChatBox "Max Output Cap"
   * slider) overrides the model's default. 0 = use model default
   * (safeMaxTokens already reflects the model cap).
   */
  const effectiveMaxTokens =
    modelConfig?.maxOutputTokens && modelConfig.maxOutputTokens > 0
      ? Math.min(modelConfig.maxOutputTokens, safeMaxTokens)
      : safeMaxTokens;

  const effectiveTokenParams = isReasoning
    ? { maxCompletionTokens: effectiveMaxTokens }
    : { maxTokens: effectiveMaxTokens };

  const streamParams = {
    model: modelInstance,
    system: chatMode === 'build' ? systemPrompt : chatNamingInstruction + discussPrompt(),
    ...effectiveTokenParams,
    messages: await convertToModelMessages(processedMessages as any),
    ...filteredOptions,

    /*
     * CRITICAL — merge the per-provider thinking options into the
     * streamText call. The AI SDK passes `providerOptions` straight
     * through to the underlying provider's HTTP request body, where:
     *
     *   - Google reads `providerOptions.google.thinkingConfig`
     *   - Anthropic reads `providerOptions.anthropic.thinking`
     *   - OpenAI reads `providerOptions.openai.reasoningEffort`
     *   - xAI (openai-compatible) reads `providerOptions.openaiCompatible.reasoningEffort`
     *   - Mistral reads `providerOptions.mistral.reasoningEffort`
     *
     * Empty object = SDK uses default behavior (no thinking config).
     */
    ...(hasThinkingOpts && Object.keys(thinkingProviderOptions).length > 0
      ? { providerOptions: thinkingProviderOptions }
      : {}),

    tools: {
      ...options?.tools,
      request_capabilities: {
        description:
          'Requests the core capabilities and system instructions required to build applications (artifacts, design guidelines, project structure). MUST be called before building an application.',
        parameters: z.object({
          capability: z.enum(['app_builder']).describe('The capability bundle to load'),
        }),
        execute: async ({ capability }: { capability: string }) => {
          if (capability === 'app_builder') {
            const { getAppBuilderCapabilities } = await import('~/lib/common/prompts/new-prompt');
            return getAppBuilderCapabilities({
              cwd: WORK_DIR,
              allowedHtmlElements: allowedHTMLElements,
              modificationTagName: MODIFICATIONS_TAG_NAME,
              supabase: {
                isConnected: options?.supabaseConnection?.isConnected || false,
                hasSelectedProject: options?.supabaseConnection?.hasSelectedProject || false,
                credentials: options?.supabaseConnection?.credentials || undefined,
              },
              designScheme,
            });
          }

          return { error: 'Unknown capability' };
        },
      },
      list_design_systems: {
        description: 'Lists all available design systems',
        parameters: z.object({
          category: z.string().optional().describe('Optional category filter'),
        }),
        execute: async ({ category }: { category?: string }) => {
          try {
            const loader = SkillLoader.getInstance();
            let systems = loader.getDesignSystems();

            if (category) {
              systems = systems.filter((s) => s.category?.toLowerCase().includes(category.toLowerCase()));
            }

            if (systems.length === 0) {
              return 'No design systems found.';
            }

            const output = systems.map((s) => `- ${s.id}: ${s.label}${s.summary ? ` — ${s.summary}` : ''}`).join('\n');

            return `Available design systems:\n${output}\n\nUse \`get_design_system\` with the ID to load full instructions.`;
          } catch (e: any) {
            return { error: e.message };
          }
        },
      },
      get_design_system: {
        description: 'Gets the instructions for a specific design system',
        parameters: z.object({
          name: z.string().describe('The name of the design system folder or file'),
        }),
        execute: async ({ name }: { name: string }) => {
          try {
            const loader = SkillLoader.getInstance();
            const content = await loader.getDesignSystemContent(name);

            return content || `Design system "${name}" not found. Use list_design_systems to see available options.`;
          } catch (e: any) {
            return { error: e.message };
          }
        },
      },
      list_skills: {
        description:
          'Lists all available specialized skills with descriptions. Call this BEFORE starting any task to find the most relevant skill.',
        parameters: z.object({}),
        execute: async () => {
          try {
            const loader = SkillLoader.getInstance();
            const skills = loader.getSkills();

            if (skills.length === 0) {
              return 'No specialized skills currently available.';
            }

            return (
              'Available skills:\n' +
              skills.map((s) => `- ${s.id}: ${s.description}`).join('\n') +
              '\n\nUse `get_skill` with the skill ID to load full instructions.'
            );
          } catch (e: any) {
            return { error: e.message };
          }
        },
      },
      get_skill: {
        description: 'Gets the instructions for a specific skill. Pass the skill name as the "name" parameter.',
        parameters: z.object({
          name: z.string().describe('The name of the skill (e.g., "webapp-builder", "react-components")'),
          skill: z
            .string()
            .optional()
            .describe('Alternative parameter name for the skill name (deprecated, use "name" instead)'),
        }),
        execute: async ({ name, skill }: { name: string; skill?: string }) => {
          try {
            const skillName = (name || skill || '').toLowerCase();

            if (!skillName) {
              return 'Error: No skill name provided. Use the "name" parameter with the skill ID.';
            }

            const loader = SkillLoader.getInstance();
            const content = await loader.getSkillContent(skillName);

            return content || `Skill "${skillName}" not found. Use list_skills to see available skills.`;
          } catch (e: any) {
            return { error: e.message };
          }
        },
      },

      /*
       * Guardrail: `inject_template` is ONLY available when the workspace
       * does NOT already contain an initialized project. Once a project
       * exists (via inject_template, a GitHub clone, or a user-picked
       * template), the tool is withheld entirely so the model cannot
       * hallucinate a re-injection that would clobber the existing
       * codebase.
       */
      ...(workspaceInitialized
        ? {}
        : {
            inject_template: {
              description:
                'Injects a starter template into the workspace. Use this ONLY when starting a brand-new project from scratch and the workspace is empty. Do NOT use this if the workspace already contains project files.',
              parameters: z.object({
                templateName: z
                  .string()
                  .describe(
                    'The name of the template to inject (e.g., "Vite Shadcn", "Expo App"). Must match a name in STARTER_TEMPLATES.',
                  ),
                template: z
                  .string()
                  .optional()
                  .describe(
                    'Alternative parameter name for the template name (deprecated, use "templateName" instead)',
                  ),
                title: z.string().optional().describe('A title for the imported files artifact'),
              }),
              execute: async ({
                templateName,
                template,
                title,
              }: {
                templateName: string;
                template?: string;
                title?: string;
              }) => {
                try {
                  const resolvedTemplateName = templateName || template || '';

                  if (!resolvedTemplateName) {
                    return {
                      error: 'No template name provided. Use the "templateName" parameter with a valid template name.',
                    };
                  }

                  const result = await getTemplates(resolvedTemplateName, title);

                  if (!result) {
                    const availableTemplates = STARTER_TEMPLATES.map((t: any) => t.name).join(', ');
                    return {
                      error: `Template "${resolvedTemplateName}" not found. Available templates: ${availableTemplates}`,
                    };
                  }

                  /*
                   * Return the file list to the client. The client-side
                   * handler in Chat.client.tsx detects inject_template tool
                   * results and writes files to the WebContainer
                   * SEQUENTIALLY via workbenchStore.addAction/runAction
                   * (same execution queue the message parser uses).
                   *
                   * WHY NOT stream the <amplifyArtifact> XML as text-delta?
                   *
                   *   Streaming the XML as a text part (the previous
                   *   approach) caused THREE regressions:
                   *
                   *   1. CHAIN BREAK: the text part breaks the
                   *      chain-of-thought segment splitter
                   *      (splitPartsIntoSegments), so consecutive tools
                   *      (list_skills → get_skill → inject_template) that
                   *      should be in ONE collapsible "Thinking" panel end
                   *      up as separate flat rows.
                   *
                   *   2. DUPLICATE HEADINGS: Chat.client.tsx replaces ALL
                   *      text parts with the parsedContent (the full
                   *      concatenated parsed output). When inject_template's
                   *      text part is present alongside the model's response
                   *      text parts, every text part gets the SAME full
                   *      parsedContent — so the model's headings (e.g.
                   *      "## Start Expo Application") appear multiple times.
                   *
                   *   3. ARTIFACT TITLE LEAK: the <amplifyArtifact
                   *      title="Start Expo Application"> XML, after parsing
                   *      and the parsedContent replacement, can render the
                   *      title as visible text in the chat.
                   *
                   *   By returning files in the tool RESULT (not as a text
                   *   part), no text part is created, so none of these
                   *   issues occur. The client writes files from the result
                   *   using the same sequential execution queue as the
                   *   message parser — reliable, no parallel-write bug.
                   *
                   * The `files` array is consumed by the
                   * `inject_template` result handler in Chat.client.tsx.
                   * The `userMessage` is kept for the model (template
                   * instructions + file-access rules) but is NOT displayed
                   * in the UI — ToolProgress.renderResult filters it out.
                   */
                  return {
                    summary: result.summary,
                    userMessage: result.userMessage,
                    files: result.files.map((f) => ({ path: f.path, content: f.content })),
                  };
                } catch (e: any) {
                  return { error: e.message };
                }
              },
            },
          }),
      webSearch: {
        description: 'Fetch the content of a web page to get up-to-date information or read documentation.',
        parameters: z.object({
          url: z.string().url().describe('The URL of the web page to fetch'),
        }),
        execute: async ({ url }: { url: string }) => {
          try {
            const result = await fetchWebPage(url);
            return result;
          } catch (error: any) {
            return { error: error.message };
          }
        },
      },
    },

    // Set temperature to 1 for reasoning models (required by OpenAI API)
    ...(isReasoning ? { temperature: 1 } : {}),
  };

  // DEBUG: Log final streaming parameters
  logger.info(
    `DEBUG STREAM: Final streaming params for model "${modelDetails.name}":`,
    JSON.stringify(
      {
        hasTemperature: 'temperature' in streamParams,
        hasMaxTokens: 'maxTokens' in streamParams,
        hasMaxCompletionTokens: 'maxCompletionTokens' in streamParams,
        paramKeys: Object.keys(streamParams).filter((key) => !['model', 'messages', 'system'].includes(key)),
        streamParams: Object.fromEntries(
          Object.entries(streamParams).filter(([key]) => !['model', 'messages', 'system'].includes(key)),
        ),
      },
      null,
      2,
    ),
  );

  const result = await _streamText(streamParams as any);

  return result;
}
