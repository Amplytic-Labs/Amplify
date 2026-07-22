/**
 * MCP Integration — /docs/integrations/mcp
 * Documents Amplify's ACTUAL MCP system.
 */
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'Transport types', href: '#transports', level: 2 },
  { title: 'Configuration', href: '#configuration', level: 2 },
  { title: 'Tool discovery', href: '#tool-discovery', level: 2 },
  { title: 'Native vs MCP tools', href: '#native-vs-mcp', level: 2 },
  { title: 'Settings UI', href: '#settings-ui', level: 2 },
];

export default function McpPage() {
  return (
    <DocsArticle title="MCP Servers" toc={toc} back="/docs" metadata="Model Context Protocol integration with stdio, SSE, and streamableHttp transports">
      <h2 id="overview">Overview</h2>
      <p>
        Amplify supports the <strong>Model Context Protocol (MCP)</strong> using 
        <code>@modelcontextprotocol/sdk</code> v1.29.0. MCP allows you to connect external 
        tool servers that the AI can invoke during conversations, extending Amplify's capabilities 
        beyond the 8 built-in native tools.
      </p>
      <p>
        MCP is currently in <strong>BETA</strong> status. You can configure MCP servers in 
        Settings → MCP Servers tab.
      </p>

      <h2 id="transports">Transport types</h2>
      <p>Amplify supports three MCP transport types:</p>
      <table>
        <thead><tr><th>Transport</th><th>Description</th><th>Best for</th></tr></thead>
        <tbody>
          <tr><td><code>stdio</code></td><td>Standard input/output — runs a local process</td><td>Local CLI tools, custom scripts</td></tr>
          <tr><td><code>sse</code></td><td>Server-Sent Events — connects to an HTTP endpoint</td><td>Remote MCP servers, cloud services</td></tr>
          <tr><td><code>streamableHttp</code></td><td>Streamable HTTP transport</td><td>High-performance remote connections</td></tr>
        </tbody>
      </table>

      <h2 id="configuration">Configuration</h2>
      <p>
        MCP server configuration uses Zod-validated schemas. Each server entry includes:
      </p>
      <ul>
        <li><strong>Name</strong> — Server identifier</li>
        <li><strong>Transport type</strong> — stdio, sse, or streamableHttp</li>
        <li><strong>Command/URL</strong> — The command to run (stdio) or URL to connect (sse/streamableHttp)</li>
        <li><strong>Arguments</strong> — Command arguments (for stdio)</li>
        <li><strong>Environment variables</strong> — Env vars for the server process</li>
      </ul>
      <p>
        Configuration is persisted in localStorage via the <code>mcpStore</code> (Zustand) 
        and synced with the server via <code>/api/mcp-update-config</code>.
      </p>
      <div className="docs-inline-info">
        <div className="docs-inline-info-title">maxLLMSteps</div>
        <div className="docs-inline-info-content">
          The MCP configuration includes a <code>maxLLMSteps</code> setting (default: 5) 
          that limits how many consecutive tool calls the AI can make in a single response. 
          This prevents runaway tool call chains.
        </div>
      </div>

      <h2 id="tool-discovery">Tool discovery</h2>
      <p>
        When an MCP server is connected, Amplify automatically discovers available tools 
        by listing them from the server. These tools appear alongside native tools in the 
        AI's tool vocabulary and can be invoked during conversations.
      </p>
      <p>
        Server availability is checked via <code>/api/mcp-check</code>. The <code>McpStatusBadge</code> 
        component shows real-time connection status for each configured server.
      </p>

      <h2 id="native-vs-mcp">Native vs MCP tools</h2>
      <p>
        MCP tools coexist with Amplify's 8 native Copilot-style tools. The AI can use 
        both types in the same response. Native tools (read_file, create_file, etc.) 
        operate on the workbench file map, while MCP tools operate through the external 
        server's API.
      </p>
      <p>
        The <code>SkillLoader</code> service also integrates with MCP, injecting skills 
        into context when relevant MCP tools are available.
      </p>

      <h2 id="settings-ui">Settings UI</h2>
      <p>
        Configure MCP servers in <strong>Settings → MCP Servers</strong> tab:
      </p>
      <ul>
        <li><code>McpTab.tsx</code> — Main settings tab</li>
        <li><code>McpServerList.tsx</code> — List of configured servers</li>
        <li><code>McpServerListItem.tsx</code> — Individual server item with status</li>
        <li><code>McpStatusBadge.tsx</code> — Connection status indicator</li>
      </ul>
    </DocsArticle>
  );
}
