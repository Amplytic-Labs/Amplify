/**
 * Workbench Product Documentation — /docs/products/workbench
 * Documents Amplify's ACTUAL workbench features.
 */
import { Link } from '@remix-run/react';
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'Editor', href: '#editor', level: 2 },
  { title: 'File tree', href: '#file-tree', level: 2 },
  { title: 'Live preview', href: '#preview', level: 2 },
  { title: 'Terminal', href: '#terminal', level: 2 },
  { title: 'Diff view', href: '#diff-view', level: 2 },
  { title: 'File locking', href: '#file-locking', level: 2 },
  { title: 'WebContainers', href: '#webcontainers', level: 2 },
];

export default function WorkbenchProductPage() {
  return (
    <DocsArticle title="Workbench" toc={toc} back="/docs" metadata="Full IDE experience with editor, live preview, terminal, and diff view">
      <h2 id="overview">Overview</h2>
      <p>
        The <strong>Workbench</strong> is Amplify's development environment. When you use <code>build</code> mode, 
        the AI generates and modifies files, and the Workbench panel opens showing the changes in real-time.
      </p>
      <p>
        It provides a split-panel layout with five views: <code>code</code>, <code>diff</code>, 
        <code>preview</code>, <code>render</code>, and <code>document</code>. You can switch between 
        views while the AI continues generating code.
      </p>

      <h2 id="editor">Editor</h2>
      <p>
        Amplify's editor is powered by <strong>CodeMirror 6</strong> with:
      </p>
      <ul>
        <li>Syntax highlighting for 40+ programming languages</li>
        <li>Auto-completion and intelligent suggestions</li>
        <li>Multi-file editing — switch between files in the file tree</li>
        <li>Environment variable masking — sensitive values are hidden by default</li>
        <li>Binary content detection — images and non-text files are handled gracefully</li>
        <li>Search and replace across all project files</li>
      </ul>

      <h2 id="file-tree">File tree</h2>
      <p>
        The file tree shows your project structure with:
      </p>
      <ul>
        <li>Visual file type icons for quick identification (140+ icon types)</li>
        <li>Expand/collapse folders for navigation</li>
        <li>Modified file indicators showing AI-generated changes</li>
        <li>Lock indicators for protected files</li>
        <li>Context menu for lock/unlock operations</li>
        <li>Breadcrumb navigation for the currently selected file</li>
      </ul>

      <h2 id="preview">Live preview</h2>
      <p>
        The preview panel renders your web application in an iframe powered by 
        <strong>WebContainers</strong> — a Node.js runtime that runs entirely in your browser.
      </p>
      <ul>
        <li>Full-stack preview — run Express servers, React apps, and more in-browser</li>
        <li>URL bar for navigating between pages</li>
        <li>Device mode toggle — test at mobile/tablet/desktop widths</li>
        <li>DOM inspector for debugging layout issues</li>
        <li>Screenshot capture for sharing or bug reporting</li>
        <li>Multi-port support — preview apps running on multiple ports simultaneously</li>
        <li>Expo QR code — scan to preview React Native/Expo apps on your phone</li>
        <li>Auto-reload when files change</li>
      </ul>

      <h2 id="terminal">Terminal</h2>
      <p>
        The integrated terminal uses <strong>xterm.js</strong> with tab support:
      </p>
      <ul>
        <li>Full terminal emulation inside WebContainer</li>
        <li>Run <code>npm install</code>, <code>npm run dev</code>, <code>npm test</code>, etc.</li>
        <li>Multiple terminal tabs for parallel tasks</li>
        <li>Shell command execution from AI tool results</li>
        <li>Custom dark theme for terminal colors</li>
      </ul>
      <pre><code>{`# Common terminal commands in Amplify:
npm install          # Install dependencies
npm run dev          # Start development server
npm run build        # Build for production
npm test             # Run tests
npx prisma generate  # Generate Prisma client`}</code></pre>

      <h2 id="diff-view">Diff view</h2>
      <p>
        When the AI modifies files, the diff view shows what changed:
      </p>
      <ul>
        <li>Side-by-side comparison of original and modified versions</li>
        <li>Color-coded additions (green) and deletions (red)</li>
        <li>Accept or reject individual changes</li>
        <li>Full undo capability — revert to any previous version via file history</li>
      </ul>

      <h2 id="file-locking">File locking</h2>
      <p>
        The <strong>LockManager</strong> lets you protect files from AI modifications:
      </p>
      <ul>
        <li>Lock individual files — the AI cannot modify locked files</li>
        <li>Lock entire directories — protect config files, secrets, etc.</li>
        <li>Visual lock indicators in the file tree</li>
        <li>Context menu for quick lock/unlock</li>
      </ul>
      <div className="docs-inline-info">
        <div className="docs-inline-info-title">Best practice</div>
        <div className="docs-inline-info-content">
          Lock files containing sensitive data (API keys, secrets, production configs) 
          before asking the AI to modify your project. This prevents accidental overwrites.
        </div>
      </div>

      <h2 id="webcontainers">WebContainers</h2>
      <p>
        Amplify uses <strong>WebContainers</strong> (<code>@webcontainer/api</code> v1.6.1-internal) 
        to run Node.js directly in your browser. This means:
      </p>
      <ul>
        <li>No local Node.js installation required</li>
        <li>Full npm, node, and shell support in-browser</li>
        <li>Instant preview of web applications</li>
        <li>Hot Module Replacement (HMR) for live updates</li>
        <li>Cross-Origin isolation with <code>coep: credentialless</code></li>
      </ul>
      <div className="docs-inline-info">
        <div className="docs-inline-info-title">License note</div>
        <div className="docs-inline-info-content">
          WebContainers require a commercial license for production usage. 
          Amplify's MIT license covers the application code, but WebContainer usage 
          in production deployments needs separate licensing from StackBlitz.
        </div>
      </div>
    </DocsArticle>
  );
}
