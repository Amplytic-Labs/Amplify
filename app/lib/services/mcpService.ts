import { type UIMessage, type UIMessageStreamWriter, convertToModelMessages, isToolUIPart } from 'ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import type { ToolCallAnnotation } from '~/types/context';
import { SkillLoader } from '~/lib/services/skillLoader';
import { memoryStore } from '~/lib/persistence/memoryStore';

/*
 * NOTE: userProfileStore, projectContextStore, and projectStore use browser-only APIs
 * (IndexedDB, localStorage). They CANNOT be statically imported in mcpService.ts
 * which runs on the server. Instead, they are lazily imported inside tool execute
 * functions that are only invoked client-side, or guarded with typeof window checks.
 */
import {
  TOOL_EXECUTION_APPROVAL,
  TOOL_EXECUTION_DENIED,
  TOOL_EXECUTION_ERROR,
  TOOL_NO_EXECUTE_FUNCTION,
  WORK_DIR,
} from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';
import { buildNativeTools, type NativeFileMap } from '~/lib/tools/nativeTools';

const logger = createScopedLogger('mcp-service');

export const stdioServerConfigSchema = z
  .object({
    type: z.enum(['stdio']).optional(),
    command: z.string().min(1, 'Command cannot be empty'),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
  })
  .transform((data) => ({
    ...data,
    type: 'stdio' as const,
  }));
export type STDIOServerConfig = z.infer<typeof stdioServerConfigSchema>;

export const sseServerConfigSchema = z
  .object({
    type: z.enum(['sse']).optional(),
    url: z.string().url('URL must be a valid URL format'),
    headers: z.record(z.string()).optional(),
  })
  .transform((data) => ({
    ...data,
    type: 'sse' as const,
  }));
export type SSEServerConfig = z.infer<typeof sseServerConfigSchema>;

export const streamableHTTPServerConfigSchema = z
  .object({
    type: z.enum(['streamable-http']).optional(),
    url: z.string().url('URL must be a valid URL format'),
    headers: z.record(z.string()).optional(),
  })
  .transform((data) => ({
    ...data,
    type: 'streamable-http' as const,
  }));

export type StreamableHTTPServerConfig = z.infer<typeof streamableHTTPServerConfigSchema>;

export const mcpServerConfigSchema = z.union([
  stdioServerConfigSchema,
  sseServerConfigSchema,
  streamableHTTPServerConfigSchema,
]);
export type MCPServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerConfigSchema),
});
export type MCPConfig = z.infer<typeof mcpConfigSchema>;

/**
 * ToolSet type compatible with AI SDK v7.
 * v7 no longer exports ToolSet directly; it is Record<string, Tool>.
 */
type ToolSet = Record<string, any>;

/**
 * MCPClient wraps an @modelcontextprotocol/sdk Client.
 * Replaces the old experimental_createMCPClient wrapper.
 */
export type MCPClient = {
  tools: () => Promise<ToolSet>;
  close: () => Promise<void>;
  serverName: string;
  _sdkClient: Client;
};

export type ToolCall = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type MCPServerTools = Record<string, MCPServer>;

export type MCPServerAvailable = {
  status: 'available';
  tools: Record<string, any>;
  client: MCPClient;
  config: MCPServerConfig;
};
export type MCPServerUnavailable = {
  status: 'unavailable';
  error: string;
  client: MCPClient | null;
  config: MCPServerConfig;
};
export type MCPServer = MCPServerAvailable | MCPServerUnavailable;

export class MCPService {
  private static _instance: MCPService;
  private _tools: Record<string, any> = {};
  private _toolsWithoutExecute: Record<string, any> = {};
  private _mcpToolsPerServer: MCPServerTools = {};
  private _toolNamesToServerNames = new Map<string, string>();
  private _config: MCPConfig = {
    mcpServers: {},
  };

  constructor() {
    this._registerInternalTools();
    SkillLoader.getInstance().loadSkills();
  }

  static getInstance(): MCPService {
    if (!MCPService._instance) {
      MCPService._instance = new MCPService();
    }

    return MCPService._instance;
  }

  private _registerInternalTools() {
    /*
     * NOTE: list_skills, get_skill, read_skill, list_design_systems, get_design_system,
     * and inject_template are NOT registered here because they are already defined
     * with full execute implementations in stream-text.ts. Defining them here would
     * cause tool name conflicts (mcpService tools get overridden by stream-text tools
     * anyway, but the param name mismatches — e.g. "skillId" vs "name" — would
     * confuse the AI when it sees the toolWithoutExecute schema).
     */

    const internalTools: Record<string, any> = {
      /*
       * ─────────────────────────────────────────────────────────────
       * Native Copilot-style tools (read_file, list_dir, grep_search,
       * replace_string_in_file, multi_replace_string_in_file,
       * create_file, find_files, web_search).
       *
       * These give the AI the same power over the workspace that
       * VSCode Copilot's built-in tools give it over the IDE:
       *   - read-only tools operate on the `files` map shipped with
       *     every /api/chat request (see processToolInvocations below)
       *   - mutating tools return a JSON "mutation signal" that the
       *     browser applies to the workbench store (see Chat.client.tsx)
       * ─────────────────────────────────────────────────────────────
       */
      ...buildNativeTools(),

      search_user_context: {
        description:
          'Searches the user profile vector store for relevant context about the user. Use this to recall user preferences, tech stack, coding style, etc. NOTE: This tool is only available in the browser context.',
        parameters: z.object({
          query: z.string().describe('The search query to find relevant user context'),
        }),
        execute: async ({ query }: { query: string }) => {
          // Guard: vector store uses IndexedDB which is browser-only
          if (typeof window === 'undefined') {
            return 'User context search is not available on the server. This tool can only be used client-side.';
          }

          try {
            const { userProfileStore } = await import('~/lib/vector-store/user-profile-store');
            await userProfileStore.initialize();

            const results = await userProfileStore.search(query, { limit: 5 });

            if (results.length === 0) {
              return 'No relevant user context found.';
            }

            return results
              .map((r) => `[${r.entry.category}] ${r.entry.content} (score: ${r.score?.toFixed(2) || 'N/A'})`)
              .join('\n');
          } catch (e: any) {
            return `Error searching user context: ${e.message}`;
          }
        },
      },
      store_user_fact: {
        description:
          'Stores a fact about the user in the user profile vector store for future retrieval. Use this to remember user preferences, tech stack choices, coding style, etc. NOTE: This tool is only available in the browser context.',
        parameters: z.object({
          content: z.string().describe('The fact to remember'),
          category: z
            .enum(['preference', 'tech_stack', 'coding_style', 'project_type', 'design_preference', 'general'])
            .optional()
            .describe('Category for the fact'),
        }),
        execute: async ({ content, category }: { content: string; category?: string }) => {
          // Guard: vector store uses IndexedDB which is browser-only
          if (typeof window === 'undefined') {
            return 'User fact storage is not available on the server. This tool can only be used client-side.';
          }

          try {
            const { userProfileStore } = await import('~/lib/vector-store/user-profile-store');
            await userProfileStore.initialize();
            await userProfileStore.add({
              content,
              category: (category as any) || 'general',
              source: 'conversation',
              confidence: 0.8,
            });

            return `User fact stored successfully: "${content}" (category: ${category || 'general'})`;
          } catch (e: any) {
            return `Error storing user fact: ${e.message}`;
          }
        },
      },
      search_project_context: {
        description:
          'Searches the project context vector store for relevant project information. Use this to recall architecture decisions, error history, patterns, and constraints.',
        parameters: z.object({
          query: z.string().describe('The search query'),
          projectId: z.string().describe('The project ID to search in. Must be provided explicitly.'),
        }),
        execute: async ({ query, projectId }: { query: string; projectId: string }) => {
          // Guard: vector store uses IndexedDB which is browser-only
          if (typeof window === 'undefined') {
            return 'Project context search is not available on the server. This tool can only be used client-side.';
          }

          try {
            if (!projectId) {
              return 'No project ID provided. Project context requires an explicit projectId.';
            }

            const { projectContextStore } = await import('~/lib/vector-store/project-context-store');
            const results = await projectContextStore.search(projectId, query, { limit: 5 });

            if (results.length === 0) {
              return 'No relevant project context found.';
            }

            return results.map((r) => `[${r.entry.type}] ${r.entry.content}`).join('\n');
          } catch (e: any) {
            return `Error searching project context: ${e.message}`;
          }
        },
      },
      store_project_context: {
        description:
          'Stores a context entry in the project context vector store. Use this to record decisions, errors, fixes, patterns, and architecture notes.',
        parameters: z.object({
          content: z.string().describe('The context to store'),
          type: z
            .enum([
              'requirement',
              'decision',
              'error',
              'fix',
              'pattern',
              'architecture',
              'constraint',
              'file_context',
              'conversation_summary',
              'tool_usage',
              'flow_definition',
              'screen_connection',
            ])
            .describe('Type of context entry'),
          projectId: z.string().describe('The project ID to store context in. Must be provided explicitly.'),
        }),
        execute: async ({ content, type, projectId }: { content: string; type: string; projectId: string }) => {
          // Guard: vector store uses IndexedDB which is browser-only
          if (typeof window === 'undefined') {
            return 'Project context storage is not available on the server. This tool can only be used client-side.';
          }

          try {
            if (!projectId) {
              return 'No project ID provided. Cannot store project context.';
            }

            const { projectContextStore } = await import('~/lib/vector-store/project-context-store');
            await projectContextStore.add(projectId, { projectId, content, type: type as any });

            return `Project context stored: [${type}] ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`;
          } catch (e: any) {
            return `Error storing project context: ${e.message}`;
          }
        },
      },
      execute_plan: {
        description:
          "YOU decide when to call this. Use it when you judge the task is too big for a single response (3+ distinct steps, 3+ files, multi-component feature, or large refactor). Calling this creates a plan from your draft points — a dedicated planner enriches them into full task contracts, then the user approves before execution. Do NOT call this for simple single-step tasks. Do NOT ask the user whether to plan — if it's genuinely complex, just call it.",
        parameters: z.object({
          taskDescription: z.string().describe('The overall task to plan and execute'),
          planPoints: z
            .array(
              z.object({
                title: z.string().describe('Short title for this plan point'),
                description: z.string().describe('What this plan point should accomplish'),
                expectedFiles: z.array(z.string()).optional().describe('Files this point will create or modify'),
                verificationRules: z.array(z.string()).optional().describe('Rules to verify after this point'),
              }),
            )
            .describe('Array of plan points to execute in order'),
        }),
        execute: async ({
          taskDescription,
          planPoints,
        }: {
          taskDescription: string;
          planPoints: Array<{
            title: string;
            description: string;
            expectedFiles?: string[];
            verificationRules?: string[];
          }>;
        }) => {
          // Return a structured signal that the client-side will detect and execute
          const planSignal = {
            type: 'execute_plan_signal',
            taskDescription,
            planPoints: planPoints.map((p, i) => ({
              title: p.title || `Step ${i + 1}`,
              description: p.description,
              expectedFiles: p.expectedFiles || [],
              verificationRules: p.verificationRules || [],
            })),
          };
          return JSON.stringify(planSignal);
        },
      },
    };

    for (const [toolName, tool] of Object.entries(internalTools)) {
      this._tools[toolName] = tool;
      this._toolsWithoutExecute[toolName] = { ...tool, execute: undefined };
    }
  }

  private _validateServerConfig(serverName: string, config: any): MCPServerConfig {
    const hasStdioField = config.command !== undefined;
    const hasUrlField = config.url !== undefined;

    if (hasStdioField && hasUrlField) {
      throw new Error(`cannot have "command" and "url" defined for the same server.`);
    }

    if (!config.type && hasStdioField) {
      config.type = 'stdio';
    }

    if (hasUrlField && !config.type) {
      throw new Error(`missing "type" field, only "sse" and "streamable-http" are valid options.`);
    }

    if (!['stdio', 'sse', 'streamable-http'].includes(config.type)) {
      throw new Error(`provided "type" is invalid, only "stdio", "sse" or "streamable-http" are valid options.`);
    }

    // Check for type/field mismatch
    if (config.type === 'stdio' && !hasStdioField) {
      throw new Error(`missing "command" field.`);
    }

    if (['sse', 'streamable-http'].includes(config.type) && !hasUrlField) {
      throw new Error(`missing "url" field.`);
    }

    try {
      return mcpServerConfigSchema.parse(config);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errorMessages = validationError.errors.map((err) => `${err.path.join('.')}: ${err.message}`).join('; ');
        throw new Error(`Invalid configuration for server "${serverName}": ${errorMessages}`);
      }

      throw validationError;
    }
  }

  async updateConfig(config: MCPConfig) {
    logger.debug('updating config', JSON.stringify(config));
    this._config = config;
    await this._createClients();

    return this._mcpToolsPerServer;
  }

  private async _createStreamableHTTPClient(
    serverName: string,
    config: StreamableHTTPServerConfig,
  ): Promise<MCPClient> {
    logger.debug(`Creating Streamable-HTTP client for ${serverName} with URL: ${config.url}`);

    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: config.headers,
      },
    });
    const sdkClient = new Client({ name: `amplify-${serverName}`, version: '1.0.0' });
    await sdkClient.connect(transport);

    return {
      serverName,
      _sdkClient: sdkClient,
      tools: async () => this._convertMCPToolsToToolSet(sdkClient),
      close: () => sdkClient.close(),
    };
  }

  private async _createSSEClient(serverName: string, config: SSEServerConfig): Promise<MCPClient> {
    logger.debug(`Creating SSE client for ${serverName} with URL: ${config.url}`);

    const transport = new SSEClientTransport(new URL(config.url), {
      requestInit: {
        headers: config.headers,
      },
    });
    const sdkClient = new Client({ name: `amplify-${serverName}`, version: '1.0.0' });
    await sdkClient.connect(transport);

    return {
      serverName,
      _sdkClient: sdkClient,
      tools: async () => this._convertMCPToolsToToolSet(sdkClient),
      close: () => sdkClient.close(),
    };
  }

  private async _createStdioClient(serverName: string, config: STDIOServerConfig): Promise<MCPClient> {
    logger.debug(
      `Creating STDIO client for '${serverName}' with command: '${config.command}' ${config.args?.join(' ') || ''}`,
    );

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env as Record<string, string> | undefined,
      cwd: config.cwd,
    });
    const sdkClient = new Client({ name: `amplify-${serverName}`, version: '1.0.0' });
    await sdkClient.connect(transport);

    return {
      serverName,
      _sdkClient: sdkClient,
      tools: async () => this._convertMCPToolsToToolSet(sdkClient),
      close: () => sdkClient.close(),
    };
  }

  /**
   * Convert MCP server tools to AI SDK v7 ToolSet format.
   * The MCP SDK returns tool definitions with JSON Schema input schemas;
   * we wrap them as AI SDK-compatible tool objects.
   */
  private async _convertMCPToolsToToolSet(sdkClient: Client): Promise<ToolSet> {
    const { tools: mcpTools } = await sdkClient.listTools();
    const toolSet: ToolSet = {};

    for (const mcpTool of mcpTools) {
      toolSet[mcpTool.name] = {
        description: mcpTool.description || '',
        parameters: mcpTool.inputSchema,
        execute: async (args: any) => {
          const result = await sdkClient.callTool({
            name: mcpTool.name,
            arguments: args,
          });

          // MCP callTool returns { content: [...], isError?: boolean }
          if (result.content && Array.isArray(result.content)) {
            return result.content
              .map((c: any) => {
                if (c.type === 'text') {
                  return c.text;
                }

                return JSON.stringify(c);
              })
              .join('\n');
          }

          return JSON.stringify(result);
        },
      };
    }

    return toolSet;
  }

  private _registerTools(serverName: string, tools: Record<string, any>) {
    for (const [toolName, tool] of Object.entries(tools)) {
      if (this._tools[toolName]) {
        const existingServerName = this._toolNamesToServerNames.get(toolName);

        if (existingServerName && existingServerName !== serverName) {
          logger.warn(`Tool conflict: "${toolName}" from "${serverName}" overrides tool from "${existingServerName}"`);
        }
      }

      this._tools[toolName] = tool;
      this._toolsWithoutExecute[toolName] = { ...tool, execute: undefined };
      this._toolNamesToServerNames.set(toolName, serverName);
    }
  }

  private async _createMCPClient(serverName: string, serverConfig: MCPServerConfig): Promise<MCPClient> {
    const validatedConfig = this._validateServerConfig(serverName, serverConfig);

    if (validatedConfig.type === 'stdio') {
      return await this._createStdioClient(serverName, serverConfig as STDIOServerConfig);
    } else if (validatedConfig.type === 'sse') {
      return await this._createSSEClient(serverName, serverConfig as SSEServerConfig);
    } else {
      return await this._createStreamableHTTPClient(serverName, serverConfig as StreamableHTTPServerConfig);
    }
  }

  private async _createClients() {
    await this._closeClients();

    const createClientPromises = Object.entries(this._config?.mcpServers || []).map(async ([serverName, config]) => {
      let client: MCPClient | null = null;

      try {
        client = await this._createMCPClient(serverName, config);

        try {
          const tools = await client.tools();

          this._registerTools(serverName, tools);

          this._mcpToolsPerServer[serverName] = {
            status: 'available',
            client,
            tools,
            config,
          };
        } catch (error) {
          logger.error(`Failed to get tools from server ${serverName}:`, error);
          this._mcpToolsPerServer[serverName] = {
            status: 'unavailable',
            error: 'could not retrieve tools from server',
            client,
            config,
          };
        }
      } catch (error) {
        logger.error(`Failed to initialize MCP client for server: ${serverName}`, error);
        this._mcpToolsPerServer[serverName] = {
          status: 'unavailable',
          error: (error as Error).message,
          client,
          config,
        };
      }
    });

    await Promise.allSettled(createClientPromises);
  }

  async checkServersAvailabilities() {
    this._tools = {};
    this._toolsWithoutExecute = {};
    this._toolNamesToServerNames.clear();

    const checkPromises = Object.entries(this._mcpToolsPerServer).map(async ([serverName, server]) => {
      let client = server.client;

      try {
        logger.debug(`Checking MCP server "${serverName}" availability: start`);

        if (!client) {
          client = await this._createMCPClient(serverName, this._config?.mcpServers[serverName]);
        }

        try {
          const tools = await client.tools();

          this._registerTools(serverName, tools);

          this._mcpToolsPerServer[serverName] = {
            status: 'available',
            client,
            tools,
            config: server.config,
          };
        } catch (error) {
          logger.error(`Failed to get tools from server ${serverName}:`, error);
          this._mcpToolsPerServer[serverName] = {
            status: 'unavailable',
            error: 'could not retrieve tools from server',
            client,
            config: server.config,
          };
        }

        logger.debug(`Checking MCP server "${serverName}" availability: end`);
      } catch (error) {
        logger.error(`Failed to connect to server ${serverName}:`, error);
        this._mcpToolsPerServer[serverName] = {
          status: 'unavailable',
          error: 'could not connect to server',
          client,
          config: server.config,
        };
      }
    });

    await Promise.allSettled(checkPromises);

    return this._mcpToolsPerServer;
  }

  private async _closeClients(): Promise<void> {
    const closePromises = Object.entries(this._mcpToolsPerServer).map(async ([serverName, server]) => {
      if (!server.client) {
        return;
      }

      logger.debug(`Closing client for server "${serverName}"`);

      try {
        await server.client.close();
      } catch (error) {
        logger.error(`Error closing client for ${serverName}:`, error);
      }
    });

    await Promise.allSettled(closePromises);
    this._tools = {};
    this._toolsWithoutExecute = {};
    this._mcpToolsPerServer = {};
    this._toolNamesToServerNames.clear();
  }

  isValidToolName(toolName: string): boolean {
    return toolName in this._tools;
  }

  processToolCall(toolCall: ToolCall, writer: UIMessageStreamWriter): void {
    const { toolCallId, toolName } = toolCall;

    if (this.isValidToolName(toolName)) {
      const { description = 'No description available' } = this.toolsWithoutExecute[toolName];
      const serverName = this._toolNamesToServerNames.get(toolName) || 'amplify';

      writer.write({
        type: 'data-annotation',
        data: {
          type: 'toolCall',
          toolCallId,
          serverName,
          toolName,
          toolDescription: description,
        } satisfies ToolCallAnnotation,
      });
    }
  }

  /**
   * Process tool invocations in the last message.
   *
   * For each tool-call result, if the user approved the call, we invoke the
   * tool's `execute` function on the server. The `files` map shipped with
   * the request is passed through to the execute function so native
   * Copilot-style tools (read_file, list_dir, grep_search, etc.) can
   * operate on the workspace snapshot.
   *
   * Mutating tools do NOT touch the file system directly — they return a
   * structured "mutation signal" that the browser applies to the workbench
   * store. This keeps the server stateless and the browser authoritative
   * for file state, matching the existing `execute_plan` pattern.
   */
  async processToolInvocations(
    messages: UIMessage[],
    writer: UIMessageStreamWriter,
    files?: NativeFileMap,
    apiBaseUrl?: string,
  ): Promise<UIMessage[]> {
    const lastMessage = messages[messages.length - 1];
    const parts = lastMessage.parts;

    if (!parts) {
      return messages;
    }

    /*
     * Process tool invocations SEQUENTIALLY (not in parallel) so that when
     * a mutating tool (create_file, replace_string_in_file, etc.) returns a
     * file mutation signal, we can update the `files` map IN-PLACE before
     * the next tool invocation sees it. This way, if the AI creates a file
     * and then reads it in the same multi-step call, the new file is
     * visible.
     *
     * We also maintain a mutable copy of the files map so tool context
     * always reflects the latest state.
     */
    const liveFiles: NativeFileMap = files ? { ...files } : {};
    const processedParts: any[] = [];

    for (const part of parts) {
      /*
       * v7 migration: tool parts now have `type: 'tool-<name>'` or
       * `'dynamic-tool'` (flat shape) — NOT the v4 literal `'tool-invocation'`.
       * Use the SDK's `isToolUIPart` helper to detect both static and dynamic
       * tool parts. We also keep a `toolCallId` fallback so any semi-legacy
       * flat parts still pass through.
       */
      const isToolInvocation = isToolUIPart(part as any) || !!(part as any).toolCallId;

      if (!isToolInvocation) {
        processedParts.push(part);
        continue;
      }

      /*
       * v7 parts are FLAT — `toolCallId`, `state`, `input`, `output` live
       * directly on the part (NOT nested under `toolInvocation`). The
       * `|| part` fallback below keeps the legacy v4 nested shape working
       * for old persisted messages.
       */
      const partAny = part as any;
      const toolInvocation = partAny.toolInvocation || partAny;
      const toolName: string =
        partAny.toolName ||
        (typeof partAny.type === 'string' && partAny.type.startsWith('tool-')
          ? partAny.type.slice('tool-'.length)
          : toolInvocation.toolName) ||
        '';
      const { toolCallId } = toolInvocation;

      /*
       * v7 state values: 'input-available' (== v4 'call') and
       * 'output-available'/'output-error' (== v4 'result').
       *
       * The `state !== 'result'` check below accepts both the v7 result
       * states AND the legacy v4 'result' string (for old persisted chats).
       */
      const state: string = partAny.state || toolInvocation.state || '';
      const isResultState =
        state === 'output-available' || state === 'output-error' || state === 'output-denied' || state === 'result';

      // return part as-is if tool does not exist, or if it's not a tool call result
      if (!this.isValidToolName(toolName) || !isResultState) {
        processedParts.push(part);
        continue;
      }

      const toolOutput = partAny.output !== undefined ? partAny.output : toolInvocation.result;

      let result;

      if (toolOutput === TOOL_EXECUTION_APPROVAL.APPROVE) {
        const toolInstance = this._tools[toolName];

        if (toolInstance && typeof toolInstance.execute === 'function') {
          const toolArgs = partAny.input !== undefined ? partAny.input : toolInvocation.args;
          logger.debug(`calling tool "${toolName}" with args: ${JSON.stringify(toolArgs)}`);

          try {
            const toolContext = {
              files: liveFiles,
              toolCallId,
              messages: await convertToModelMessages(messages),
              apiBaseUrl,
            };
            result = await toolInstance.execute(toolArgs, toolContext);

            /*
             * If the tool result is a file mutation signal, update the
             * liveFiles map in-place so subsequent tool calls in this
             * same batch can see the new/modified file.
             */
            if (typeof result === 'string') {
              try {
                const parsed = JSON.parse(result);

                if (parsed?.type === 'amplify_file_mutation' && Array.isArray(parsed.operations)) {
                  for (const op of parsed.operations) {
                    if (op.op === 'create' && op.filePath && op.content !== undefined) {
                      const key = op.filePath.startsWith('/') ? op.filePath : `${WORK_DIR}/${op.filePath}`;
                      liveFiles[key] = { type: 'file', content: op.content, isBinary: false };
                    } else if (op.op === 'replace' && op.filePath && op.oldString && op.newString) {
                      const key = op.filePath.startsWith('/') ? op.filePath : `${WORK_DIR}/${op.filePath}`;
                      const existing = liveFiles[key];

                      if (existing && existing.type === 'file' && !existing.isBinary) {
                        const newContent = existing.content.replace(op.oldString, op.newString);
                        liveFiles[key] = { ...existing, content: newContent };
                      }
                    } else if (op.op === 'multi_replace' && op.filePath && Array.isArray(op.edits)) {
                      const key = op.filePath.startsWith('/') ? op.filePath : `${WORK_DIR}/${op.filePath}`;
                      const existing = liveFiles[key];

                      if (existing && existing.type === 'file' && !existing.isBinary) {
                        let newContent = existing.content;

                        for (const edit of op.edits) {
                          newContent = newContent.replace(edit.oldString, edit.newString);
                        }

                        liveFiles[key] = { ...existing, content: newContent };
                      }
                    }
                  }
                }
              } catch {
                // Not a mutation signal — that's fine, leave result as-is
              }
            }
          } catch (error) {
            logger.error(`error while calling tool "${toolName}":`, error);
            result = TOOL_EXECUTION_ERROR;
          }
        } else {
          result = TOOL_NO_EXECUTE_FUNCTION;
        }
      } else if (toolOutput === TOOL_EXECUTION_APPROVAL.REJECT) {
        result = TOOL_EXECUTION_DENIED;
      } else {
        // For any unhandled responses, return the original part.
        processedParts.push(part);
        continue;
      }

      // Forward updated tool result to the client.
      writer.write({
        type: 'tool-output-available',
        toolCallId,
        output: result,
      });

      /*
       * v7 migration: build the updated part using the FLAT v7 shape.
       * The previous code nested the result under `toolInvocation.result`;
       * v7 expects `output` directly on the part. We spread the original
       * part (preserving `type`, `toolCallId`, `input`, etc.) and only
       * overwrite `output`/`state`/`errorText`.
       */
      const updatedPart: any = { ...partAny, output: result };

      // Preserve v4 nested shape too, for any consumer still expecting it.
      if (partAny.toolInvocation) {
        updatedPart.toolInvocation = { ...partAny.toolInvocation, result };
      }

      /*
       * Promote state to v7 'output-available' if it's missing or still
       * using a v4 value ('result'). Existing v7 result states
       * ('output-available' / 'output-error' / 'output-denied') are left
       * untouched so we don't clobber error information.
       */
      if (
        partAny.state !== 'output-available' &&
        partAny.state !== 'output-error' &&
        partAny.state !== 'output-denied'
      ) {
        updatedPart.state = 'output-available';
      }

      processedParts.push(updatedPart);
    }

    // Finally return the processed messages
    return [...messages.slice(0, -1), { ...lastMessage, parts: processedParts }];
  }

  get tools() {
    return this._tools;
  }

  get toolsWithoutExecute() {
    return this._toolsWithoutExecute;
  }
}
