/**
 * Providers Product Documentation — /docs/products/providers
 * Documents Amplify's ACTUAL AI provider system.
 */
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'How providers work', href: '#how-providers-work', level: 2 },
  { title: 'Cloud providers', href: '#cloud-providers', level: 2 },
  { title: 'Local providers', href: '#local-providers', level: 2 },
  { title: 'API key management', href: '#api-keys', level: 2 },
  { title: 'Model selection', href: '#model-selection', level: 2 },
  { title: 'Rate limiting', href: '#rate-limiting', level: 2 },
  { title: 'Dynamic models', href: '#dynamic-models', level: 2 },
];

export default function ProvidersProductPage() {
  return (
    <DocsArticle title="Providers" toc={toc} back="/docs" metadata="22+ AI providers with unified model selection, rate limiting, and dynamic model fetching">
      <h2 id="overview">Overview</h2>
      <p>
        Amplify supports <strong>22+ AI providers</strong> through a unified provider system. 
        You can switch between providers and models mid-conversation, configure API keys per provider, 
        and set rate limits to manage costs.
      </p>
      <p>
        The provider system uses an abstract <code>BaseProvider</code> class pattern with a singleton 
        <code>LLMManager</code> that auto-registers all providers. Each provider resolves API keys 
        from multiple sources: settings, environment variables, and runtime configuration.
      </p>

      <h2 id="how-providers-work">How providers work</h2>
      <p>
        Each provider extends <code>BaseProvider</code> and implements:
      </p>
      <ul>
        <li><code>name</code> — Provider display name</li>
        <li><code>staticModels</code> — Hardcoded model list</li>
        <li><code>getModelInstance()</code> — Create an AI SDK model instance</li>
        <li><code>getDynamicModels()</code> — Fetch available models from provider API (optional)</li>
        <li><code>getProviderBaseUrlAndKey()</code> — Resolve API key from multiple sources</li>
      </ul>
      <p>
        The <code>LLMManager</code> singleton manages the registry, caches dynamic model lists, 
        and provides a unified interface for model selection.
      </p>

      <h2 id="cloud-providers">Cloud providers</h2>
      <p>Amplify supports 16 cloud AI providers:</p>
      <table>
        <thead>
          <tr><th>Provider</th><th>API Key</th><th>Dynamic Models</th></tr>
        </thead>
        <tbody>
          <tr><td>OpenAI</td><td><code>OPENAI_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Anthropic</td><td><code>ANTHROPIC_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Google (Gemini)</td><td><code>GOOGLE_GENERATIVE_AI_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>DeepSeek</td><td><code>DEEPSEEK_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Groq</td><td><code>GROQ_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Cohere</td><td><code>COHERE_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Mistral</td><td><code>MISTRAL_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>xAI</td><td><code>XAI_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Together AI</td><td><code>TOGETHER_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Perplexity</td><td><code>PERPLEXITY_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>OpenRouter</td><td><code>OPEN_ROUTER_API_KEY</code></td><td>Yes (full list)</td></tr>
          <tr><td>Amazon Bedrock</td><td>AWS credentials</td><td>Yes</td></tr>
          <tr><td>GitHub Models</td><td><code>GITHUB_TOKEN</code></td><td>Yes</td></tr>
          <tr><td>HuggingFace</td><td><code>HF_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Fireworks</td><td><code>FIREWORKS_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Cerebras</td><td><code>CEREBRAS_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Moonshot (Kimi)</td><td><code>MOONSHOT_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>Hyperbolic</td><td><code>HYPERBOLIC_API_KEY</code></td><td>Yes</td></tr>
          <tr><td>ZAI</td><td><code>ZAI_API_KEY</code></td><td>Yes</td></tr>
        </tbody>
      </table>

      <h2 id="local-providers">Local providers</h2>
      <p>Amplify supports 3 local/self-hosted providers:</p>
      <table>
        <thead>
          <tr><th>Provider</th><th>Configuration</th><th>Dynamic Models</th></tr>
        </thead>
        <tbody>
          <tr><td>Ollama</td><td>Local endpoint (default: localhost:11434)</td><td>Yes (fetches installed models)</td></tr>
          <tr><td>LM Studio</td><td><code>LMSTUDIO_BASE_URL</code></td><td>Yes</td></tr>
          <tr><td>OpenAI-compatible</td><td>Custom <code>baseURL</code> + API key</td><td>Yes</td></tr>
        </tbody>
      </table>
      <p>
        Local providers are perfect for development, privacy, or cost savings. 
        Ollama models run entirely on your machine with no data sent to external services.
      </p>

      <h2 id="api-keys">API key management</h2>
      <p>
        API keys are stored in browser cookies via <code>js-cookie</code> and synced with 
        localStorage (<code>provider_settings</code>). Key features:
      </p>
      <ul>
        <li>Auto-detection of environment variables via <code>/api/configured-providers</code></li>
        <li>Real-time validation with visual indicators (green checkmarks)</li>
        <li>Bulk toggle "Enable All Cloud" providers</li>
        <li>Per-provider settings with model configuration</li>
        <li>Import/export API keys for backup</li>
      </ul>

      <h2 id="model-selection">Model selection</h2>
      <p>
        The <strong>ModelSelector</strong> component provides:
      </p>
      <ul>
        <li>Fuzzy search dropdown with Levenshtein distance matching</li>
        <li>Context window size display per model</li>
        <li>Provider icons for quick identification</li>
        <li>Per-model settings persistence via <code>modelConfigStore</code></li>
      </ul>
      <p>Default model: <code>claude-3-5-sonnet-latest</code> (Anthropic).</p>

      <h2 id="rate-limiting">Rate limiting</h2>
      <p>
        User-configurable rate limits per provider via <code>rate-limit.ts</code> store:
      </p>
      <ul>
        <li><strong>RPM</strong> — Requests per minute</li>
        <li><strong>TPM</strong> — Tokens per minute</li>
        <li><strong>RPD</strong> — Requests per day</li>
        <li><strong>autoShrinkToTpm</strong> — Automatically shrink context to fit within token limits</li>
      </ul>
      <p>
        Rate limits include suggested defaults per provider based on 2025-2026 official documentation. 
        Server-side pre-flight checks validate TPM and throttle RPM.
      </p>

      <h2 id="dynamic-models">Dynamic models</h2>
      <p>
        Most providers support dynamic model fetching via <code>getDynamicModels()</code>. 
        Amplify caches these lists and refreshes them periodically. For OpenRouter, 
        it fetches the entire model catalog. For Ollama, it queries the local server 
        for installed models.
      </p>
    </DocsArticle>
  );
}
