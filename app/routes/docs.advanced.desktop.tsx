/**
 * Desktop App — /docs/advanced/desktop
 * Documents Amplify's ACTUAL Electron desktop application.
 */
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'Features', href: '#features', level: 2 },
  { title: 'Installation', href: '#installation', level: 2 },
  { title: 'Auto-update', href: '#auto-update', level: 2 },
  { title: 'Building from source', href: '#building', level: 2 },
];

export default function DesktopPage() {
  return (
    <DocsArticle title="Desktop App" toc={toc} back="/docs" metadata="Electron v33 desktop app with auto-update and native menu">
      <h2 id="overview">Overview</h2>
      <p>
        Amplify offers a <strong>Electron v33</strong> desktop application for macOS, Windows, and Linux. 
        The desktop app provides native menu bar, auto-updates, better file system access, 
        and cookie management synced between Electron and the web session.
      </p>

      <h2 id="features">Features</h2>
      <ul>
        <li><strong>Native menu bar</strong> — Application menu with standard shortcuts</li>
        <li><strong>Auto-update</strong> — Automatic updates via <code>electron-updater</code></li>
        <li><strong>Notarization</strong> — macOS builds are notarized via <code>@electron/notarize</code></li>
        <li><strong>Cookie sync</strong> — <code>initCookies()</code> / <code>storeCookies()</code> sync 
          session cookies between Electron and the Remix app</li>
        <li><strong>Custom protocol</strong> — <code>protocol.handle('http')</code> intercepts 
          all HTTP requests for dev and production modes</li>
        <li><strong>Dev mode</strong> — Vite dev server runs in-process during development</li>
        <li><strong>Production mode</strong> — Static assets from <code>build/client</code> + 
          Remix server handler via <code>createRequestHandler</code></li>
        <li><strong>Persistent settings</strong> — <code>electron-store</code> for native configuration</li>
      </ul>

      <h2 id="installation">Installation</h2>
      <p>Download the latest release for your platform:</p>
      <ul>
        <li><a href="https://github.com/imtia33/Open_Claude/releases" target="_blank" rel="noopener noreferrer">GitHub Releases</a> — macOS (.dmg), Windows (.exe), Linux (.AppImage)</li>
      </ul>
      <pre><code>{`# macOS (Homebrew Cask)
brew install --cask amplify

# Or download directly from GitHub Releases page`}</code></pre>

      <h2 id="auto-update">Auto-update</h2>
      <p>
        The desktop app includes auto-update functionality via <code>electron-updater</code>. 
        When a new version is released:
      </p>
      <ul>
        <li>The app checks for updates automatically on launch</li>
        <li>A notification appears when an update is available</li>
        <li>The update downloads and installs in the background</li>
        <li>You'll be prompted to restart when the update is ready</li>
      </ul>

      <h2 id="building">Building from source</h2>
      <p>Build the desktop app from source:</p>
      <pre><code>{`# Install dependencies
pnpm install

# Build the Remix renderer
pnpm run electron:build:renderer

# Build the main + preload scripts
pnpm run electron:build:deps

# Build for all platforms
pnpm run electron:build:dist

# Or run in dev mode
pnpm run electron:dev`}</code></pre>
      <p>
        The build configuration is in <code>electron-builder.yml</code> with notarization 
        handled by <code>notarize.cjs</code>.
      </p>
    </DocsArticle>
  );
}
