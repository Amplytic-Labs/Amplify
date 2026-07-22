/**
 * Changelog — /docs/changelog
 * Simple changelog page.
 */
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'v1.0 — Initial Release', href: '#v1', level: 2 },
];

export default function ChangelogPage() {
  return (
    <DocsArticle title="Changelog" toc={toc} back="/docs" metadata="Release history and updates">
      <p>
        This page tracks major updates to Amplify. For detailed commit history, 
        visit <a href="https://github.com/imtia33/Open_Claude/commits/rebrand/amplify" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>

      <h2 id="v1">v1.0 — Rebrand to Amplify</h2>
      <p>The initial release of Amplify under its new branding includes:</p>
      <ul>
        <li>Brand color <code>#FF2056</code> (hot pink/red) established throughout the UI</li>
        <li>AI SDK v4 → v7 migration completed with new <code>UIMessage</code> format</li>
        <li>Provider picker redesign with model picker, reasoning collapse, and toggles</li>
        <li>ChatBox redesign with theme-aware styling</li>
        <li>shadcn Sidebar implementation with SidebarProvider/SidebarInset pattern</li>
        <li>Provider logos via Iconify with real SVG fetching</li>
        <li>Rate limiting per provider (RPM, TPM, RPD, autoShrinkToTpm)</li>
        <li>Thinking/reasoning configuration wired through SDK</li>
        <li>Docx workspace gating and document pipeline</li>
        <li>Theme fixes — transparent default background, white-on-white bug resolved</li>
        <li>22+ AI providers supported with dynamic model fetching</li>
        <li>MCP (Model Context Protocol) integration in BETA</li>
        <li>Planning system with Task Contracts and sub-chat engine</li>
        <li>User and project-level memory stores with vector search</li>
        <li>One-click deployment to GitHub, Vercel, Netlify, GitLab</li>
        <li>Electron desktop app with auto-update and notarization</li>
      </ul>
    </DocsArticle>
  );
}
