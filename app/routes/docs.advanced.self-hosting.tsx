/**
 * Self-Hosting — /docs/advanced/self-hosting
 * Documents how to ACTUALLY self-host Amplify.
 */
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'Cloudflare Pages deployment', href: '#cloudflare', level: 2 },
  { title: 'Docker deployment', href: '#docker', level: 2 },
  { title: 'Environment variables', href: '#env-vars', level: 2 },
  { title: 'Custom domain', href: '#custom-domain', level: 2 },
];

export default function SelfHostingPage() {
  return (
    <DocsArticle title="Self-Hosting" toc={toc} back="/docs" metadata="Deploy Amplify on your own infrastructure with Cloudflare Pages or Docker">
      <h2 id="overview">Overview</h2>
      <p>
        Amplify can be self-hosted on your own infrastructure. The primary deployment 
        target is <strong>Cloudflare Pages</strong>, but Docker is also supported for 
        containerized environments.
      </p>

      <h2 id="cloudflare">Cloudflare Pages deployment</h2>
      <p>
        The project includes a <code>wrangler.toml</code> configuration for Cloudflare Pages:
      </p>
      <pre><code>{`# Build and deploy to Cloudflare Pages
npm run build
wrangler pages deploy ./build/client`}</code></pre>
      <p>
        The <code>functions/[[path]].ts</code> file acts as the server entry point for 
        Cloudflare Pages Functions, handling all Remix routes.
      </p>

      <h2 id="docker">Docker deployment</h2>
      <p>
        Amplify includes Docker support with:
      </p>
      <ul>
        <li><code>Dockerfile</code> — Multi-stage build (development + production)</li>
        <li><code>docker-compose.yaml</code> — Development and production profiles</li>
      </ul>
      <pre><code>{`# Build and run with Docker Compose
docker compose -f docker-compose.yaml up --build

# Or build manually
docker build -t amplify .
docker run -p 3000:3000 amplify`}</code></pre>
      <p>
        The <code>bindings.sh</code> script handles Wrangler bindings for Cloudflare 
        environment variables in Docker.
      </p>

      <h2 id="env-vars">Environment variables</h2>
      <p>
        Key environment variables for self-hosting:
      </p>
      <table>
        <thead><tr><th>Variable</th><th>Description</th><th>Required</th></tr></thead>
        <tbody>
          <tr><td><code>OPENAI_API_KEY</code></td><td>OpenAI API key (server-side)</td><td>Optional</td></tr>
          <tr><td><code>ANTHROPIC_API_KEY</code></td><td>Anthropic API key (server-side)</td><td>Optional</td></tr>
          <tr><td><code>GOOGLE_GENERATIVE_AI_API_KEY</code></td><td>Google Gemini API key</td><td>Optional</td></tr>
          <tr><td><code>DEEPSEEK_API_KEY</code></td><td>DeepSeek API key</td><td>Optional</td></tr>
          <tr><td><code>GROQ_API_KEY</code></td><td>Groq API key</td><td>Optional</td></tr>
          <tr><td><code>XAI_API_KEY</code></td><td>xAI (Grok) API key</td><td>Optional</td></tr>
          <tr><td><code>MISTRAL_API_KEY</code></td><td>Mistral API key</td><td>Optional</td></tr>
        </tbody>
      </table>
      <div className="docs-inline-info">
        <div className="docs-inline-info-title">Server vs client keys</div>
        <div className="docs-inline-info-content">
          Environment variables provide server-side API keys that work automatically 
          without requiring users to enter their own keys. Users can still configure 
          personal API keys in the Settings panel, which override server defaults.
        </div>
      </div>

      <h2 id="custom-domain">Custom domain</h2>
      <p>
        For Cloudflare Pages, configure a custom domain in the Cloudflare dashboard. 
        For Docker deployments, use a reverse proxy (nginx, Caddy) to route traffic 
        to the Amplify container.
      </p>
    </DocsArticle>
  );
}
