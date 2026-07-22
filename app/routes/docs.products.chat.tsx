/**
 * Chat Product Documentation — /docs/products/chat
 * Documents Amplify's ACTUAL chat features.
 */
import { Link } from '@remix-run/react';
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'Chat modes', href: '#chat-modes', level: 2 },
  { title: 'Streaming responses', href: '#streaming', level: 2 },
  { title: 'Model selector', href: '#model-selector', level: 2 },
  { title: 'File attachments', href: '#attachments', level: 2 },
  { title: 'Reasoning mode', href: '#reasoning', level: 2 },
  { title: 'Tool invocations', href: '#tools', level: 2 },
  { title: 'Context budget', href: '#context', level: 2 },
  { title: 'Auto summarization', href: '#summarization', level: 2 },
  { title: 'Voice input', href: '#voice', level: 2 },
  { title: 'Prompt enhancer', href: '#enhancer', level: 2 },
  { title: 'Message rewind & fork', href: '#rewind', level: 2 },
];

export default function ChatProductPage() {
  return (
    <DocsArticle title="Chat" toc={toc} back="/docs" metadata="AI-powered conversations with 22+ providers, streaming, reasoning, and native tools">
      <h2 id="overview">Overview</h2>
      <p>
        <strong>Chat</strong> is Amplify's core conversational interface. It connects you to 22+ AI providers 
        and provides a rich set of features beyond simple messaging: real-time streaming, reasoning mode, 
        native tool invocations, file attachments, automatic context management, and more.
      </p>
      <p>
        The chat system is built on <strong>Vercel AI SDK v7</strong> with a parts-based 
        <code>UIMessage</code> format, supporting text, reasoning, tool-call, and tool-result message parts.
      </p>

      <h2 id="chat-modes">Chat modes</h2>
      <p>Amplify supports two chat modes:</p>
      <ul>
        <li><strong>discuss</strong> — Conversation-only mode. The AI answers questions, explains concepts, 
          and discusses ideas without modifying any files.</li>
        <li><strong>build</strong> — Code generation mode. The AI uses native tools to read, create, and 
          modify files in the Workbench. Changes appear in real-time.</li>
      </ul>
      <p>Switch between modes using the toggle in the chat input area.</p>

      <h2 id="streaming">Streaming responses</h2>
      <p>
        All responses are streamed token-by-token via <code>useChat</code> with <code>DefaultChatTransport</code>. 
        A smooth typewriter effect (<code>useSmoothStream</code>) ensures readable, progressive output. 
        You can interrupt streaming at any time by pressing <strong>Escape</strong> or clicking the stop button.
      </p>

      <h2 id="model-selector">Model selector</h2>
      <p>
        The model selector provides a fuzzy-search dropdown (Levenshtein distance matching) for choosing 
        AI models. It shows:
      </p>
      <ul>
        <li>Provider icons for quick identification</li>
        <li>Context window size for each model</li>
        <li>Dynamic model lists fetched from provider APIs</li>
        <li>Per-model settings persistence (reasoning, budget tokens)</li>
      </ul>
      <p>Default model: <code>claude-3-5-sonnet-latest</code> (Anthropic). Default provider: first registered provider.</p>

      <h2 id="attachments">File attachments</h2>
      <p>
        You can attach images and files to chat messages for visual understanding or code review. 
        Drag and drop files into the chat input or click the attachment button. Supported formats 
        include images (PNG, JPG, GIF, WebP) and text files.
      </p>

      <h2 id="reasoning">Reasoning mode</h2>
      <p>
        For models that support extended thinking (Claude 3.5 Sonnet with thinking, DeepSeek R1, etc.), 
        Amplify displays the reasoning process in a collapsible <strong>ThoughtsPanel</strong>. 
        Configuration options include:
      </p>
      <ul>
        <li><code>thinkingEnabled</code> — Toggle reasoning on/off</li>
        <li><code>budgetTokens</code> — Reasoning token budget (default: 4096)</li>
        <li><code>effort</code> — Reasoning effort level: low, medium, high (for OpenAI o-series, xAI, Mistral)</li>
        <li><code>maxOutputTokens</code> — Hard cap on output tokens</li>
      </ul>

      <h2 id="tools">Tool invocations</h2>
      <p>
        Amplify has 8 native Copilot-style tools that the AI can invoke during <code>build</code> mode:
      </p>
      <ol>
        <li><code>read_file</code> — Read file content from the project</li>
        <li><code>list_dir</code> — List directory contents</li>
        <li><code>find_files</code> — Find files by pattern</li>
        <li><code>grep_search</code> — Search within file contents</li>
        <li><code>replace_string_in_file</code> — Replace a string in a file</li>
        <li><code>multi_replace_string_in_file</code> — Multiple replacements in one call</li>
        <li><code>create_file</code> — Create a new file</li>
        <li><code>web_search</code> — Search the web for information</li>
      </ol>
      <p>
        Tool calls appear in the message with friendly names and icons (e.g., "Read file", "Edited file", 
        "Searched the web"). Some tools require user confirmation via <strong>ToolConfirmation</strong> dialog.
      </p>
      <p>
        Read more in <Link to="/docs/advanced/native-tools">Native tools</Link>.
      </p>

      <h2 id="context">Context budget</h2>
      <p>
        The <strong>ContextBudgetIndicator</strong> shows live token usage with a color-coded progress bar. 
        When context fills up beyond 70%, Amplify automatically summarizes older messages via server-side 
        <code>create-summary</code>, preserving the most relevant context while freeing space for new messages.
      </p>

      <h2 id="summarization">Auto summarization</h2>
      <p>
        When the context budget exceeds 70%, Amplify triggers server-side auto-summarization. 
        A <strong>SummarizationToast</strong> notifies you that older messages have been compressed. 
        The summary replaces the original messages in the context window while preserving key information.
      </p>

      <h2 id="voice">Voice input</h2>
      <p>
        Amplify supports speech-to-text input via the Web Speech API. Click the microphone button 
        in the chat input to start voice recording. Your speech is transcribed and inserted into 
        the message field.
      </p>

      <h2 id="enhancer">Prompt enhancer</h2>
      <p>
        The <code>usePromptEnhancer</code> hook can automatically improve your prompts by calling 
        the <code>/api/enhancer</code> endpoint. This rewrites your input for better AI understanding 
        and more precise code generation.
      </p>

      <h2 id="rewind">Message rewind & fork</h2>
      <p>
        Navigate back to any previous message using the <strong>rewind</strong> feature (URL param). 
        Create a new conversation branch from any message using <strong>fork</strong>. Both features 
        work with IndexedDB persistence, so your full history is always available.
      </p>
    </DocsArticle>
  );
}
