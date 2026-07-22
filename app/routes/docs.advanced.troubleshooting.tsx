/**
 * Troubleshooting — /docs/advanced/troubleshooting
 * Common issues and solutions for Amplify.
 */
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Common issues', href: '#common-issues', level: 2 },
  { title: 'API key issues', href: '#api-key', level: 2 },
  { title: 'WebContainer errors', href: '#webcontainer', level: 2 },
  { title: 'Provider connection', href: '#provider', level: 2 },
  { title: 'Deployment failures', href: '#deployment', level: 2 },
  { title: 'Debug tools', href: '#debug', level: 2 },
];

export default function TroubleshootingPage() {
  return (
    <DocsArticle title="Troubleshooting" toc={toc} back="/docs" metadata="Common issues, error messages, and solutions">
      <h2 id="common-issues">Common issues</h2>
      <p>Here are the most frequently encountered issues and their solutions.</p>

      <h3>White screen / blank page</h3>
      <p>
        If Amplify loads but shows a blank white screen, this is likely a theme issue. 
        The base element background defaults to transparent — containers that need a solid 
        surface must explicitly opt in via depth tokens.
      </p>
      <ul>
        <li>Check your browser console for errors</li>
        <li>Try clearing localStorage and cookies</li>
        <li>Switch between dark and light themes</li>
      </ul>

      <h2 id="api-key">API key issues</h2>
      <h3>"Invalid API key" error</h3>
      <p>
        If you get an API key error:
      </p>
      <ul>
        <li>Verify the key is correct — copy it fresh from the provider dashboard</li>
        <li>Check if the key has expired or been revoked</li>
        <li>Ensure the key has sufficient permissions (some keys are scoped to specific projects)</li>
        <li>Try the <strong>Test Provider</strong> button in Settings → Cloud Providers</li>
      </ul>
      <h3>"No configured providers" error</h3>
      <p>
        If no providers are detected:
      </p>
      <ul>
        <li>Add at least one API key in Settings → Cloud Providers</li>
        <li>Check that the provider toggle is enabled (not greyed out)</li>
        <li>For local providers, verify Ollama or LM Studio is running</li>
      </ul>

      <h2 id="webcontainer">WebContainer errors</h2>
      <h3>WebContainer fails to boot</h3>
      <p>
        WebContainers require <strong>Cross-Origin isolation</strong> headers:
      </p>
      <ul>
        <li><code>Cross-Origin-Embedder-Policy: credentialless</code></li>
        <li><code>Cross-Origin-Opener-Policy: same-origin</code></li>
      </ul>
      <p>
        If these headers are missing (e.g., running behind a proxy), WebContainers won't initialize. 
        Configure your reverse proxy to add these headers.
      </p>
      <h3>Preview not loading</h3>
      <p>
        If the live preview shows a blank iframe:
      </p>
      <ul>
        <li>Check if the development server started successfully in the terminal</li>
        <li>Verify the port number in the preview dropdown</li>
        <li>Try refreshing the preview manually</li>
        <li>Check terminal output for build errors</li>
      </ul>

      <h2 id="provider">Provider connection</h2>
      <h3>"Provider not responding"</h3>
      <p>
        If a provider fails to respond:
      </p>
      <ul>
        <li>Check your internet connection</li>
        <li>Verify the provider's status page (some providers have downtime)</li>
        <li>Check rate limits — you may have exceeded your quota</li>
        <li>For Docker deployments, verify localhost URLs are rewritten to <code>host.docker.internal</code></li>
      </ul>

      <h2 id="deployment">Deployment failures</h2>
      <h3>Build fails before deploy</h3>
      <p>
        If <code>npm run build</code> fails:
      </p>
      <ul>
        <li>Check terminal output for specific error messages</li>
        <li>Ensure all dependencies are installed (<code>npm install</code>)</li>
        <li>Verify TypeScript errors — run <code>tsc --noEmit</code> to check</li>
        <li>Fix linting errors before deploying</li>
      </ul>
      <h3>GitHub deploy fails</h3>
      <p>
        If GitHub deployment fails:
      </p>
      <ul>
        <li>Verify GitHub OAuth is connected in Settings → GitHub</li>
        <li>Check that the repository name doesn't conflict with existing repos</li>
        <li>Ensure your GitHub token has write permissions</li>
      </ul>

      <h2 id="debug">Debug tools</h2>
      <p>Amplify provides several debugging tools:</p>
      <ul>
        <li><strong>Event Logs</strong> — Settings → Event Logs tab shows system events and errors</li>
        <li><strong>System Diagnostics</strong> — <code>/api/system.diagnostics</code> provides runtime info</li>
        <li><strong>Debug Logger</strong> — <code>debugLogger</code> utility for capturing debug information</li>
        <li><strong>Trace Tree</strong> — <code>TraceTree.tsx</code> component for visualizing chat traces</li>
        <li><strong>Bug Report</strong> — <code>/api/bug-report</code> endpoint for submitting error reports</li>
      </ul>
    </DocsArticle>
  );
}
