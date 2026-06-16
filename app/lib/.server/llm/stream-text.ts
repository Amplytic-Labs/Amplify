import {
  convertToCoreMessages,
  streamText as _streamText,
  type Message,
  formatDataStreamPart,
  type DataStreamWriter,
} from 'ai';
import { MAX_TOKENS, PROVIDER_COMPLETION_LIMITS, isReasoningModel, type FileMap } from './constants';
import { getSystemPrompt } from '~/lib/common/prompts/new-prompt';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, MODIFICATIONS_TAG_NAME, PROVIDER_LIST, WORK_DIR } from '~/utils/constants';
import type { IProviderSetting } from '~/types/model';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { allowedHTMLElements } from '~/utils/markdown';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';
import { createFilesContext, extractPropertiesFromMessage } from './utils';
import { discussPrompt } from '~/lib/common/prompts/discuss-prompt';
import type { DesignScheme } from '~/types/design-scheme';
import { z } from 'zod';
import { fetchWebPage } from '~/lib/utils/web-fetch';
import { getTemplates } from '~/utils/selectStarterTemplate';
import { SkillLoader } from '~/lib/services/skillLoader';

export type Messages = Message[];

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

  return sanitized.trim();
}

export async function streamText(props: {
  messages: Omit<Message, 'id'>[];
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
  dataStream?: DataStreamWriter;
  userContext?: string;
  projectContext?: string;
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
  } = props;
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  let processedMessages = messages.map((message) => {
    const newMessage = { ...message };

    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;
      newMessage.content = sanitizeText(content);
    } else if (message.role == 'assistant') {
      newMessage.content = sanitizeText(message.content);
    }

    // Sanitize all text parts in parts array, if present
    if (Array.isArray(message.parts)) {
      newMessage.parts = message.parts.map((part) =>
        part.type === 'text' ? { ...part, text: sanitizeText(part.text) } : part,
      );
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
    const codeContext = createFilesContext(contextFiles, true);

    systemPrompt = `${systemPrompt}

    Below is the artifact containing the context loaded into context buffer for you to have knowledge of and might need changes to fullfill current user request.
    CONTEXT BUFFER:
    ---
    ${codeContext}
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
    messages: convertToCoreMessages(processedMessages as any),
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
            if (systems.length === 0) return 'No design systems found.';
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
            if (skills.length === 0) return 'No specialized skills currently available.';
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
      inject_template: {
        description:
          'Injects a starter template into the workspace. Use this when starting a new project or adding a base structure for a component.',
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
            if (!result) return { error: `Template "${templateName}" not found.` };

            if (props.dataStream) {
              props.dataStream.write(formatDataStreamPart('text', result.assistantMessage));
            }

            return {
              summary: result.summary,
              userMessage: result.userMessage,
            };
          } catch (e: any) {
            return { error: e.message };
          }
        },
      },
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

  const result = await _streamText(streamParams);

  return result;
}
