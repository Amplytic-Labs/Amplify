import { StreamingMessageParser, type StreamingMessageParserOptions } from './message-parser';

/**
 * Enhanced message parser — now a thin wrapper around the base
 * StreamingMessageParser.
 *
 * PREVIOUS BEHAVIOUR (REMOVED):
 *   The enhanced parser auto-detected code blocks and shell commands
 *   in the AI's response and wrapped them in <amplifyArtifact> tags.
 *   This was fundamentally broken because it contradicted the AI's
 *   explicit instructions:
 *
 *   - The system prompt tells the AI to use <amplifyArtifact> tags
 *     ONLY when Amplify will actually execute/apply the content.
 *   - User-facing instructions MUST appear as regular markdown
 *     ```bash code blocks — NOT as <amplifyAction> elements.
 *   - The auto-wrapping overrode the AI's deliberate choice to put
 *     a command in a code block vs. an artifact tag.
 *
 *   For example, "Run this on your machine: ```bash npm install -g expo-cli ```"
 *   was being auto-wrapped as an artifact, which the runtime then tried
 *   to execute in the WebContainer — even though the AI intended it as
 *   a suggestion for the user to run locally.
 *
 * CURRENT BEHAVIOUR:
 *   The parser only handles explicit <amplifyArtifact> tags that the AI
 *   emits when it wants to execute commands or create files. Code blocks
 *   in the AI's response are left as-is and rendered as normal markdown.
 *
 *   This is correct because the AI already knows the distinction:
 *   - <amplifyArtifact><amplifyAction type="shell"> → execute in workspace
 *   - ```bash code block → show to the user as a suggestion
 */
export class EnhancedStreamingMessageParser extends StreamingMessageParser {
  constructor(options: StreamingMessageParserOptions = {}) {
    super(options);
  }

  /**
   * Set the current chat mode. Kept for API compatibility but no
   * longer affects parsing — the enhanced auto-wrapping has been
   * removed entirely.
   */
  setChatMode(_mode: 'discuss' | 'build') {
    // No-op — auto-wrapping removed. The AI uses explicit tags.
  }

  reset() {
    super.reset();
  }
}
