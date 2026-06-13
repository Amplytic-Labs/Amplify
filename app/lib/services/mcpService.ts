import {
  experimental_createMCPClient,
  type ToolSet,
  type Message,
  type DataStreamWriter,
  convertToCoreMessages,
  formatDataStreamPart,
} from 'ai';
import { Experimental_StdioMCPTransport } from 'ai/mcp-stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import type { ToolCallAnnotation } from '~/types/context';
import { SkillLoader } from '~/lib/services/skillLoader';
import { memoryStore } from '~/lib/persistence/memoryStore';
// NOTE: userProfileStore, projectContextStore, and projectStore use browser-only APIs
// (IndexedDB, localStorage). They CANNOT be statically imported in mcpService.ts
// which runs on the server. Instead, they are lazily imported inside tool execute
// functions that are only invoked client-side, or guarded with typeof window checks.
import {
  TOOL_EXECUTION_APPROVAL,
  TOOL_EXECUTION_DENIED,
  TOOL_EXECUTION_ERROR,
  TOOL_NO_EXECUTE_FUNCTION,
} from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';

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

export type MCPClient = {
  tools: () => Promise<ToolSet>;
  close: () => Promise<void>;
} & {
  serverName: string;
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
  tools: ToolSet;
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
  private _tools: ToolSet = {};
  private _toolsWithoutExecute: ToolSet = {};
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
    const loader = SkillLoader.getInstance();

    const internalTools: ToolSet = {
      list_skills: {
        description:
          'Lists all available specialized skills. Call this BEFORE starting any task to check if a relevant skill exists. Returns skill IDs and descriptions.',
        parameters: z.object({}),
        execute: async () => {
          const skills = loader.getSkills();
          if (skills.length === 0) return 'No specialized skills currently available.';

          return (
            'Available skills:\n' +
            skills.map((s) => `- ${s.id}: ${s.description}`).join('\n') +
            '\n\nUse `get_skill` with the skill ID to load full instructions.'
          );
        },
      },
      get_skill: {
        description:
          'Loads the full procedural instructions for a specific skill. Always call `list_skills` first to find the right skill ID, then call this to get the complete instructions.',
        parameters: z.object({
          skillId: z.string().describe('The ID of the skill to load (from list_skills output)'),
        }),
        execute: async ({ skillId }) => {
          const content = await loader.getSkillContent(skillId.toLowerCase());
          return content || `Skill "${skillId}" not found. Use list_skills to see available skills.`;
        },
      },
      read_skill: {
        description: 'Alias for get_skill. Reads the full content of a specific skill by its ID.',
        parameters: z.object({
          skillId: z.string().describe('The ID of the skill to read'),
        }),
        execute: async ({ skillId }) => {
          const content = await loader.getSkillContent(skillId.toLowerCase());
          return content || 'Skill not found';
        },
      },
      list_design_systems: {
        description:
          'Lists all available design systems. Use this when building UI-heavy applications to find a high-quality design language to follow.',
        parameters: z.object({
          category: z
            .string()
            .optional()
            .describe('Optional category filter (e.g., "AI & LLM", "Fintech & Crypto", "Developer Tools")'),
        }),
        execute: async ({ category }) => {
          let systems = loader.getDesignSystems();
          if (category) {
            systems = systems.filter((s) => s.category.toLowerCase() === category.toLowerCase());
          }
          if (systems.length === 0)
            return 'No design systems found' + (category ? ` for category "${category}"` : '') + '.';

          const grouped = systems.reduce<Record<string, typeof systems>>((acc, ds) => {
            const cat = ds.category || 'General';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(ds);
            return acc;
          }, {});

          let output = 'Available design systems:\n';
          for (const [cat, items] of Object.entries(grouped)) {
            output += `\n**${cat}:**\n`;
            for (const ds of items) {
              output += `- ${ds.id}: ${ds.label}${ds.summary ? ` — ${ds.summary}` : ''}\n`;
            }
          }
          output += '\nUse `get_design_system` with the ID to load full instructions.';
          return output;
        },
      },
      get_design_system: {
        description:
          'Loads the full design system instructions for a specific design system ID. Use after `list_design_systems` to get detailed styling guidance.',
        parameters: z.object({
          id: z.string().describe('The ID of the design system to load'),
        }),
        execute: async ({ id }) => {
          const content = await loader.getDesignSystemContent(id);
          return content || `Design system "${id}" not found. Use list_design_systems to see available options.`;
        },
      },
      inject_template: {
        description:
          'Signals the system to inject a starter template into the workspace. Call this when a skill or task requires a specific project template. The system will fetch template files, inject them, and run npm install automatically.',
        parameters: z.object({
          templateName: z
            .string()
            .describe('The name of the template to inject (e.g., "Expo App", "Vite React", "Vanilla Vite")'),
        }),
        execute: async ({ templateName }) => {
          // This is a signal tool - the actual injection happens via the client-side
          // template selection flow. Returns confirmation with template info.
          return `Template "${templateName}" injection requested. The system will handle fetching and injecting the template files. Continue with your implementation after the template is available.`;
        },
      },
      update_user_memory: {
        description: "Updates or adds a fact about the user to the AI's long-term memory.",
        parameters: z.object({
          content: z.string().describe('The fact to remember about the user'),
          category: z.string().optional().describe('Optional category for the memory'),
        }),
        execute: async ({ content, category }) => {
          const memory = memoryStore.addMemory(content, category);
          return `Memory stored: ${memory.content} (ID: ${memory.id})`;
        },
      },
      read_user_memory: {
        description: 'Retrieves stored facts about the user. Can be filtered by a query.',
        parameters: z.object({
          query: z.string().optional().describe('Optional query to filter memories'),
        }),
        execute: async ({ query }) => {
          const memories = query ? memoryStore.searchMemories(query) : memoryStore.getMemories();

          if (memories.length === 0) {
            return 'No memories found.';
          }

          return memories.map((m) => `[${m.timestamp}] ${m.category ? `(${m.category}) ` : ''}${m.content}`).join('\n');
        },
      },
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
            if (results.length === 0) return 'No relevant user context found.';
            return results.map((r) => `[${r.entry.category}] ${r.entry.content} (score: ${r.score?.toFixed(2) || 'N/A'})`).join('\n');
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
            if (!projectId) return 'No project ID provided. Project context requires an explicit projectId.';
            const { projectContextStore } = await import('~/lib/vector-store/project-context-store');
            const results = await projectContextStore.search(projectId, query, { limit: 5 });
            if (results.length === 0) return 'No relevant project context found.';
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
            .enum(['requirement', 'decision', 'error', 'fix', 'pattern', 'architecture', 'constraint', 'file_context', 'conversation_summary', 'tool_usage', 'flow_definition', 'screen_connection'])
            .describe('Type of context entry'),
          projectId: z.string().describe('The project ID to store context in. Must be provided explicitly.'),
        }),
        execute: async ({ content, type, projectId }: { content: string; type: string; projectId: string }) => {
          // Guard: vector store uses IndexedDB which is browser-only
          if (typeof window === 'undefined') {
            return 'Project context storage is not available on the server. This tool can only be used client-side.';
          }
          try {
            if (!projectId) return 'No project ID provided. Cannot store project context.';
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
          'Creates and executes a plan by breaking a complex task into sequential plan points. Each plan point runs as an isolated sub-chat with full system prompt and app builder capabilities. Use this for complex multi-step implementation tasks that require 3+ distinct steps.',
        parameters: z.object({
          taskDescription: z.string().describe('The overall task to plan and execute'),
          planPoints: z
            .array(z.object({
              title: z.string().describe('Short title for this plan point'),
              description: z.string().describe('What this plan point should accomplish'),
              expectedFiles: z.array(z.string()).optional().describe('Files this point will create or modify'),
              verificationRules: z.array(z.string()).optional().describe('Rules to verify after this point'),
            }))
            .describe('Array of plan points to execute in order'),
        }),
        execute: async ({ taskDescription, planPoints }: { taskDescription: string; planPoints: Array<{ title: string; description: string; expectedFiles?: string[]; verificationRules?: string[] }> }) => {
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

    const client = await experimental_createMCPClient({
      transport: new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: {
          headers: config.headers,
        },
      }),
    });

    return Object.assign(client, { serverName });
  }

  private async _createSSEClient(serverName: string, config: SSEServerConfig): Promise<MCPClient> {
    logger.debug(`Creating SSE client for ${serverName} with URL: ${config.url}`);

    const client = await experimental_createMCPClient({
      transport: config,
    });

    return Object.assign(client, { serverName });
  }

  private async _createStdioClient(serverName: string, config: STDIOServerConfig): Promise<MCPClient> {
    logger.debug(
      `Creating STDIO client for '${serverName}' with command: '${config.command}' ${config.args?.join(' ') || ''}`,
    );

    const client = await experimental_createMCPClient({ transport: new Experimental_StdioMCPTransport(config) });

    return Object.assign(client, { serverName });
  }

  private _registerTools(serverName: string, tools: ToolSet) {
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

  processToolCall(toolCall: ToolCall, dataStream: DataStreamWriter): void {
    const { toolCallId, toolName } = toolCall;

    if (this.isValidToolName(toolName)) {
      const { description = 'No description available' } = this.toolsWithoutExecute[toolName];
      const serverName = this._toolNamesToServerNames.get(toolName);

      if (serverName) {
        dataStream.writeMessageAnnotation({
          type: 'toolCall',
          toolCallId,
          serverName,
          toolName,
          toolDescription: description,
        } satisfies ToolCallAnnotation);
      }
    }
  }

  async processToolInvocations(messages: Message[], dataStream: DataStreamWriter): Promise<Message[]> {
    const lastMessage = messages[messages.length - 1];
    const parts = lastMessage.parts;

    if (!parts) {
      return messages;
    }

    const processedParts = await Promise.all(
      parts.map(async (part) => {
        // Only process tool invocations parts
        if (part.type !== 'tool-invocation') {
          return part;
        }

        const { toolInvocation } = part;
        const { toolName, toolCallId } = toolInvocation;

        // return part as-is if tool does not exist, or if it's not a tool call result
        if (!this.isValidToolName(toolName) || toolInvocation.state !== 'result') {
          return part;
        }

        let result;

        if (toolInvocation.result === TOOL_EXECUTION_APPROVAL.APPROVE) {
          const toolInstance = this._tools[toolName];

          if (toolInstance && typeof toolInstance.execute === 'function') {
            logger.debug(`calling tool "${toolName}" with args: ${JSON.stringify(toolInvocation.args)}`);

            try {
              result = await toolInstance.execute(toolInvocation.args, {
                messages: convertToCoreMessages(messages),
                toolCallId,
              });
            } catch (error) {
              logger.error(`error while calling tool "${toolName}":`, error);
              result = TOOL_EXECUTION_ERROR;
            }
          } else {
            result = TOOL_NO_EXECUTE_FUNCTION;
          }
        } else if (toolInvocation.result === TOOL_EXECUTION_APPROVAL.REJECT) {
          result = TOOL_EXECUTION_DENIED;
        } else {
          // For any unhandled responses, return the original part.
          return part;
        }

        // Forward updated tool result to the client.
        dataStream.write(
          formatDataStreamPart('tool_result', {
            toolCallId,
            result,
          }),
        );

        // Return updated toolInvocation with the actual result.
        return {
          ...part,
          toolInvocation: {
            ...toolInvocation,
            result,
          },
        };
      }),
    );

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
