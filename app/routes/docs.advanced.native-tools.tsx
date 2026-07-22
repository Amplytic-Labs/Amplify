/**
 * Native Tools Documentation — /docs/advanced/native-tools
 * Documents Amplify's ACTUAL 8 native tools.
 */
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'Tool list', href: '#tool-list', level: 2 },
  { title: 'File reading tools', href: '#reading', level: 2 },
  { title: 'File editing tools', href: '#editing', level: 2 },
  { title: 'Search tools', href: '#search', level: 2 },
  { title: 'Web search', href: '#web-search', level: 2 },
  { title: 'Tool confirmation', href: '#confirmation', level: 2 },
  { title: 'MCP tools', href: '#mcp-tools', level: 2 },
];

export default function NativeToolsPage() {
  return (
    <DocsArticle title="Native Tools" toc={toc} back="/docs" metadata="8 built-in Copilot-style tools for file operations and web search">
      <h2 id="overview">Overview</h2>
      <p>
        Amplify has <strong>8 native Copilot-style tools</strong> that the AI can invoke during 
        <code>build</code> mode. These tools allow the AI to read, create, and modify files, 
        search for content, and look up information on the web.
      </p>
      <p>
        Tool invocations appear in the chat message with friendly names and icons 
        (e.g., "Read file", "Edited file", "Searched the web"). Mutation tools return 
        structured JSON signals that are applied client-side to the workbench store.
      </p>

      <h2 id="tool-list">Tool list</h2>
      <table>
        <thead><tr><th>Tool</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>read_file</code></td><td>Read</td><td>Read file content from the project file map</td></tr>
          <tr><td><code>list_dir</code></td><td>Read</td><td>List directory contents</td></tr>
          <tr><td><code>find_files</code></td><td>Read</td><td>Find files by name pattern</td></tr>
          <tr><td><code>grep_search</code></td><td>Read</td><td>Search within file contents</td></tr>
          <tr><td><code>replace_string_in_file</code></td><td>Mutation</td><td>Replace a single string in a file</td></tr>
          <tr><td><code>multi_replace_string_in_file</code></td><td>Mutation</td><td>Multiple string replacements in one call</td></tr>
          <tr><td><code>create_file</code></td><td>Mutation</td><td>Create a new file with specified content</td></tr>
          <tr><td><code>web_search</code></td><td>External</td><td>Search the web for information</td></tr>
        </tbody>
      </table>

      <h2 id="reading">File reading tools</h2>
      <p>
        Reading tools allow the AI to understand your project structure before making changes:
      </p>
      <ul>
        <li><code>read_file</code> — Returns the full content of a specified file from the workbench file map</li>
        <li><code>list_dir</code> — Returns a listing of files and directories at a given path</li>
        <li><code>find_files</code> — Finds files matching a glob pattern (e.g., <code>**/*.tsx</code>)</li>
        <li><code>grep_search</code> — Searches for a string or regex pattern across all files</li>
      </ul>

      <h2 id="editing">File editing tools</h2>
      <p>
        Mutation tools return structured JSON signals that the client applies to the workbench store. 
        The AI describes what it wants to change, and Amplify applies the change to the file map 
        and WebContainer filesystem:
      </p>
      <ul>
        <li><code>replace_string_in_file</code> — Replace one string with another in a file. 
          The tool receives the old string, new string, and file path.</li>
        <li><code>multi_replace_string_in_file</code> — Apply multiple replacements in a single call. 
          Useful for making several edits to the same file.</li>
        <li><code>create_file</code> — Create a brand new file with specified content and path.</li>
      </ul>
      <div className="docs-inline-info">
        <div className="docs-inline-info-title">Mutation signals</div>
        <div className="docs-inline-info-content">
          Mutation tools don't directly write to the filesystem. Instead, they return a 
          structured JSON signal that is processed client-side. The workbench store applies 
          the changes to the file map and syncs them to the WebContainer. This enables 
          the diff view, undo functionality, and file version history.
        </div>
      </div>

      <h2 id="search">Search tools</h2>
      <p>
        The AI uses search tools to find relevant code in your project:
      </p>
      <ul>
        <li><code>find_files</code> — Glob-based file search (e.g., find all TypeScript files)</li>
        <li><code>grep_search</code> — Content search across files (find function definitions, imports, etc.)</li>
      </ul>

      <h2 id="web-search">Web search</h2>
      <p>
        The <code>web_search</code> tool calls <code>/api/web-search</code> to search the internet 
        for up-to-date information. This is useful when the AI needs:
      </p>
      <ul>
        <li>Current documentation for libraries or APIs</li>
        <li>Recent changes or best practices</li>
        <li>Solutions to specific error messages</li>
        <li>Information not in its training data</li>
      </ul>

      <h2 id="confirmation">Tool confirmation</h2>
      <p>
        Some tool calls trigger a <strong>ToolConfirmation</strong> dialog for user approval. 
        This gives you control over which operations the AI can perform without oversight. 
        You can approve or reject each tool call individually.
      </p>

      <h2 id="mcp-tools">MCP tools</h2>
      <p>
        In addition to native tools, Amplify supports <strong>MCP (Model Context Protocol)</strong> 
        tools from external servers. MCP tools coexist with native tools and are discovered 
        dynamically when MCP servers are connected. See 
        <a href="/docs/integrations/mcp">MCP Servers</a> for more details.
      </p>
    </DocsArticle>
  );
}
