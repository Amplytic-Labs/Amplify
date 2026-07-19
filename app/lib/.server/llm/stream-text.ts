import {
  convertToModelMessages,
  streamText as _streamText,
  type UIMessage,
  type UIMessageStreamWriter,
  isToolUIPart,
} from 'ai';
import { MAX_TOKENS, PROVIDER_COMPLETION_LIMITS, isReasoningModel, type FileMap } from './constants';
import { getSystemPrompt } from '~/lib/common/prompts/new-prompt';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, MODIFICATIONS_TAG_NAME, PROVIDER_LIST, WORK_DIR } from '~/utils/constants';
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

export type Messages = UIMessage[];

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

/**
 * Returns true for Google models that support native thinking/reasoning.
 * These models return thought: true parts in the SSE response when
 * thinkingConfig is injected into the request via providerOptions.
 */
function isGoogleThinkingModel(modelName: string): boolean {
  const name = modelName.toLowerCase();
  return (
    name.includes('gemini-2.5') ||
    name.includes('gemini-3') ||
    name.includes('gemma-3-27') ||
    name.includes('gemma-4') ||
    name.includes('learnlm')
  );
}

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

            // Rebuild the part with the truncated output. Keep the FLAT v7
            // shape (`output` directly on the part) as the primary form;
            // also mirror it onto the legacy `toolInvocation.result` for
            // any consumer still expecting the nested v4 shape.
            //
            // Cast through `any` again because the `isToolUIPart` type guard
            // narrows `partAny` to `ToolUIPart | DynamicToolUIPart`, which
            // doesn't include the legacy `toolInvocation` field. We need to
            // access it conditionally for backward compatibility with old
            // persisted v4 messages.
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

  /*
   * ONE-SHOT CHAT NAMING (token-efficient method).
   *
   * On the FIRST user turn of a brand-new chat (i.e. there are NO prior
   * assistant messages in the conversation), append a short instruction
   * asking the model to prepend `<chatname>name</chatname>` to its
   * response. The client extracts the name from that tag and uses it as
   * the chat / project title — NO separate AI call, NO extra round-trip.
   *
   * The instruction is SILENT on every subsequent turn:
   *   - It is only appended when `isFirstMessage` is true (no assistant
   *     messages yet), so it costs zero tokens on turn 2+.
   *   - The `<chatname>` tag the model emits is stripped from prior
   *     assistant messages (see `stripChatName` above) before they are
   *     re-sent, so the model never "sees" its own previous chatname.
   *
   * This replaces the old `/api/chat-title` endpoint which made a whole
   * second LLM call just to name the chat.
   */
  const isFirstMessage = !processedMessages.some((m) => m.role === 'assistant');

  if (isFirstMessage && chatMode === 'build') {
    systemPrompt = `${systemPrompt}

<chat_naming>
  This is the FIRST message of a new conversation. Before your actual
  answer, output a single line of the form:

      <chatname>a short 2-6 word title for this chat</chatname>

  Rules for the title:
  - 2 to 6 words, no quotes, no trailing punctuation.
  - Title Case (capitalize major words).
  - Capture the core intent of the user's request.
  - If the user's message is a bare greeting ("hi", "hello"), use
    "New Conversation".
  - Output the tag ONCE, at the very start of your response, then
    continue with your normal answer (markdown / artifacts / tool calls).
  - Do NOT mention the tag or the title to the user in your answer text.
  - Do NOT output this tag again in any future message — only this first
    response.

  CRITICAL — DO NOT reason, think, or deliberate about this naming
  instruction inside your thinking / reasoning / <thought> channel.
  The <chatname> tag must appear as the very FIRST token of your VISIBLE
  answer — never inside a reasoning block, never as a thought, never
  after a deliberation step. Reasoning about the naming instruction has
  been observed to (a) delay the tag until after a long thought block,
  causing the chat sidebar to fall back to the user's first message as
  the title, and (b) leak fragments like "I should output
  <chatname>New Conversation</chatname>" into the visible thinking
  trace, which is broken and confusing.

  Correct shape:
      <chatname>Build React Dashboard</chatname>
      <thought>...</thought>
      Sure — let's scaffold...

  Wrong shape (DO NOT DO THIS):
      <thought>The user said hi. According to <chat_naming> I should
      output <chatname>New Conversation</chatname>. Let me reply
      politely.</thought>
      <chatname>New Conversation</chatname>
      Hi there!
</chat_naming>
    `;
  }

  logger.info(`Sending llm call to ${provider.name} with model ${modelDetails.name}`);

  // Log reasoning model detection and token parameters
  const isReasoning = isReasoningModel(modelDetails.name);
  logger.info(
    `Model "${modelDetails.name}" is reasoning model: ${isReasoning}, using ${isReasoning ? 'maxCompletionTokens' : 'maxTokens'}: ${safeMaxTokens}`,
  );

  // Validate token limits before API call
  if (safeMaxTokens > (modelDetails.maxTokenAllowed || 128000)) {
    logger.warn(
      `Token limit warning: requesting ${safeMaxTokens} tokens but model supports max ${modelDetails.maxTokenAllowed || 128000}`,
    );
  }

  // Use maxCompletionTokens for reasoning models (o1, GPT-5), maxTokens for traditional models
  const tokenParams = isReasoning ? { maxCompletionTokens: safeMaxTokens } : { maxTokens: safeMaxTokens };

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

  const streamParams = {
    model: modelInstance,
    system: chatMode === 'build' ? systemPrompt : discussPrompt(),
    ...tokenParams,
    messages: await convertToModelMessages(processedMessages as any),
    ...filteredOptions,

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
        description: 'Gets the instructions for a specific skill',
        parameters: z.object({
          name: z.string().describe('The name of the skill folder'),
        }),
        execute: async ({ name }: { name: string }) => {
          try {
            const loader = SkillLoader.getInstance();
            const content = await loader.getSkillContent(name.toLowerCase());

            return content || `Skill "${name}" not found. Use list_skills to see available skills.`;
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
                title: z.string().optional().describe('A title for the imported files artifact'),
              }),
              execute: async ({ templateName, title }: { templateName: string; title?: string }) => {
                try {
                  const result = await getTemplates(templateName, title);

                  if (!result) {
                    return { error: `Template "${templateName}" not found.` };
                  }

                  if (props.dataStream) {
                    props.dataStream.write({ type: 'text-delta', id: 'template', delta: result.assistantMessage });
                  }

                  return {
                    summary: result.summary,
                    userMessage: result.userMessage,

                    /*
                     * IMPORTANT: the template's <amplifyArtifact> XML is
                     * streamed above and parsed/written to the WebContainer
                     * by the client message parser ASYNCHRONOUSLY. This tool
                     * result is returned to the model BEFORE all files are
                     * committed to the workspace.
                     *
                     * The client-side readiness gate delays auto-approval of
                     * read-only tools and the application of file mutations
                     * until the file count has stabilized, so by the time a
                     * subsequent read_file / list_dir / mutate call is
                     * permitted to execute, the files will exist.
                     *
                     * Do NOT immediately attempt to read or modify files
                     * that were just injected — they may not be written yet.
                     * If you must verify, prefer list_dir first.
                     */
                    warning:
                      'Template files are being written to the workspace asynchronously. Wait for the workspace to finish loading before reading or modifying files, otherwise operations may fail on non-existent files.',
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
