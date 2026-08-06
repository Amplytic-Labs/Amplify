import { memo, useMemo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { BundledLanguage } from 'shiki';
import { createScopedLogger } from '~/utils/logger';
import { rehypePlugins, remarkPlugins, allowedHTMLElements } from '~/utils/markdown';
import { Artifact, openArtifactInWorkbench } from './Artifact';
import { CodeBlock } from './CodeBlock';
import { Mermaid } from './Mermaid';
import { Chart } from './Chart';
import { FilePill } from './copilot/FilePill';
import { transformAmplifyQuickActions } from '~/lib/chat/quick-actions';
import type { UIMessage } from 'ai';
import styles from './Markdown.module.scss';
import type { ProviderInfo } from '~/types/model';

const logger = createScopedLogger('MarkdownComponent');

interface MarkdownProps {
  children: string;
  html?: boolean;
  limitedMarkdown?: boolean;
  append?: (message: UIMessage) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
}

export const Markdown = memo(
  ({ children, html = false, limitedMarkdown = false, append, setChatMode, model, provider }: MarkdownProps) => {
    logger.trace('Render');

    /*
     * Preprocess content:
     *   1. Strip code fences around amplifyArtifact (existing behaviour)
     *   2. Strip residual `<thought>...</thought>` tags. The system
     *      prompt forbids the AI from emitting these (it should use
     *      its native reasoning channel instead, which arrives as
     *      `parts[].type === 'reasoning'` and is rendered by the
     *      ThoughtProcess component). We strip them here as a
     *      defence-in-depth so a misbehaving model cannot re-introduce
     *      the old multi-panel "thought block" UI inside the answer.
     *      `transformThoughtBlocks` is kept as a no-op safety net for
     *      any external callers that still rely on it.
     *   3. Transform `<amplify-quick-actions>` XML → `<div class="__amplifyQuickAction__">`
     *      HTML so the existing div/button component handlers below can
     *      render them as styled pill buttons. Without this step, the raw
     *      XML would render as plain text (react-markdown doesn't know
     *      about custom XML element names). Streaming-safe — see
     *      quick-actions.ts for details.
     */
    const parsedChildren = useMemo(() => {
      const stripped = stripCodeFenceFromArtifact(children);
      const thoughtsStripped = stripResidualThoughtTags(stripped);

      return transformAmplifyQuickActions(thoughtsStripped);
    }, [children]);

    const childrenRef = useRef(parsedChildren);
    childrenRef.current = parsedChildren;

    const components = useMemo(() => {
      return {
        div: ({ className, children, node, ...props }) => {
          const dataProps = node?.properties as Record<string, unknown>;

          if (className?.includes('__amplifyArtifact__')) {
            const messageId = node?.properties.dataMessageId as string;
            const artifactId = node?.properties.dataArtifactId as string;

            if (!messageId) {
              logger.error(`Invalid message id ${messageId}`);
            }

            if (!artifactId) {
              logger.error(`Invalid artifact id ${artifactId}`);
            }

            return <Artifact messageId={messageId} artifactId={artifactId} />;
          }

          if (className?.includes('__amplifyThought__')) {
            /*
             * Legacy path — the new ThoughtProcess component renders
             * reasoning outside the markdown body. If a stray
             * __amplifyThought__ details element ever shows up here we
             * render it as plain muted text so it doesn't break, but
             * stripResidualThoughtTags should already have removed
             * the source `<thought>` tags before markdown parsing.
             */
            return <div className="text-amplify-elements-textTertiary text-xs italic">{children}</div>;
          }

          if (className?.includes('__amplifySelectedElement__')) {
            const messageId = node?.properties.dataMessageId as string;
            const elementDataAttr = node?.properties.dataElement as string;

            // Parse the element data if it exists
            let elementData: any = null;

            if (elementDataAttr) {
              try {
                elementData = JSON.parse(elementDataAttr);
              } catch (e) {
                console.error('Failed to parse element data:', e);
              }
            }

            if (!messageId) {
              logger.error(`Invalid message id ${messageId}`);
            }

            return (
              <div className="bg-amplify-elements-background-depth-3 border border-amplify-elements-borderColor rounded-lg p-3 my-2">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-mono bg-amplify-elements-background-depth-2 px-2 py-1 rounded text-amplify-elements-textTer">
                    {elementData?.tagName}
                  </span>
                  {elementData?.className && (
                    <span className="text-xs text-amplify-elements-textSecondary">.{elementData.className}</span>
                  )}
                </div>
                <code className="block text-sm !text-amplify-elements-textSecondary !bg-amplify-elements-background-depth-2 border border-amplify-elements-borderColor p-2 rounded">
                  {elementData?.displayText}
                </code>
              </div>
            );
          }

          if (className?.includes('__amplifyQuickAction__') || dataProps?.dataAmplifyQuickAction) {
            return <div className="flex items-center gap-2 flex-wrap mt-3.5">{children}</div>;
          }

          return (
            <div className={className} {...props}>
              {children}
            </div>
          );
        },
        pre: (props) => {
          const { children: preChildren, node, ...rest } = props;

          const [firstChild] = node?.children ?? [];

          if (
            firstChild &&
            firstChild.type === 'element' &&
            firstChild.tagName === 'code' &&
            firstChild.children[0].type === 'text'
          ) {
            const { className, ...rest } = firstChild.properties;
            const [, language = 'plaintext'] = /language-(\w+)/.exec(String(className) || '') ?? [];

            if (language === 'mermaid') {
              const code = firstChild.children[0].value;
              let isClosed = false;

              if (node?.position?.start?.offset !== undefined) {
                isClosed = childrenRef.current.indexOf('```', node.position.start.offset + 10) !== -1;
              } else {
                const lastMermaidIndex = childrenRef.current.lastIndexOf('```mermaid');
                isClosed = childrenRef.current.indexOf('```', lastMermaidIndex + 10) !== -1;
              }

              if (isClosed) {
                return <Mermaid chart={code} />;
              }

              return null;
            }

            if (language === 'chartjs') {
              const code = firstChild.children[0].value;
              let isClosed = false;

              if (node?.position?.start?.offset !== undefined) {
                isClosed = childrenRef.current.indexOf('```', node.position.start.offset + 10) !== -1;
              } else {
                const lastChartIndex = childrenRef.current.lastIndexOf('```chartjs');
                isClosed = childrenRef.current.indexOf('```', lastChartIndex + 10) !== -1;
              }

              /*
               * Only mount the Chart component once the closing fence has
               * arrived. Chart.js mutates a <canvas> on mount and destroys
               * it on unmount, so mounting on a partial JSON blob would
               * throw a parse error and flash an error card. Once closed,
               * the module-level config cache inside Chart.tsx keeps the
               * parsed config stable across ReactMarkdown re-parses.
               */
              if (isClosed) {
                return <Chart config={code} />;
              }

              return null;
            }

            return <CodeBlock code={firstChild.children[0].value} language={language as BundledLanguage} {...rest} />;
          }

          return <pre {...rest}>{preChildren}</pre>;
        },
        button: ({ node, children, ...props }) => {
          const dataProps = node?.properties as Record<string, unknown>;

          if (
            dataProps?.class?.toString().includes('__amplifyQuickAction__') ||
            dataProps?.dataAmplifyQuickAction === 'true'
          ) {
            const type = dataProps['data-type'] || dataProps.dataType;
            const message = dataProps['data-message'] || dataProps.dataMessage;
            const path = dataProps['data-path'] || dataProps.dataPath;
            const href = dataProps['data-href'] || dataProps.dataHref;

            const iconClassMap: Record<string, string> = {
              file: 'i-ph:file',
              message: 'i-ph:chats',
              implement: 'i-ph:code',
              link: 'i-ph:link',
            };

            const safeType = typeof type === 'string' ? type : '';
            const iconClass = iconClassMap[safeType] ?? 'i-ph:question';

            return (
              <button
                className="rounded-md justify-center px-3 py-1.5 text-xs bg-amplify-elements-item-backgroundAccent text-amplify-elements-item-contentAccent opacity-90 hover:opacity-100 flex items-center gap-2 cursor-pointer"
                data-type={type}
                data-message={message}
                data-path={path}
                data-href={href}
                onClick={() => {
                  if (type === 'file') {
                    openArtifactInWorkbench(path);
                  } else if (type === 'message' && append) {
                    append({
                      id: `quick-action-message-${Date.now()}`,

                      // AI SDK v7: use parts instead of content
                      parts: [
                        {
                          type: 'text' as const,
                          text: `[Model: ${model}]\n\n[Provider: ${provider?.name}]\n\n${message}`,
                        },
                      ],
                      role: 'user',
                    });
                    console.log('Message appended:', message);
                  } else if (type === 'implement' && append && setChatMode) {
                    setChatMode('build');
                    append({
                      id: `quick-action-implement-${Date.now()}`,

                      // AI SDK v7: use parts instead of content
                      parts: [
                        {
                          type: 'text' as const,
                          text: `[Model: ${model}]\n\n[Provider: ${provider?.name}]\n\n${message}`,
                        },
                      ],
                      role: 'user',
                    });
                  } else if (type === 'link' && typeof href === 'string') {
                    try {
                      const url = new URL(href, window.location.origin);
                      window.open(url.toString(), '_blank', 'noopener,noreferrer');
                    } catch (error) {
                      console.error('Invalid URL:', href, error);
                    }
                  }
                }}
              >
                <div className={`text-lg ${iconClass}`} />
                {children}
              </button>
            );
          }

          return (
            <button className="bg-transparent" {...props}>
              {children}
            </button>
          );
        },
        a: ({ node, children, ...props }) => {
          const href = props.href;
          const text =
            typeof children === 'string' ? children : (Array.isArray(children) ? children[0]?.toString() : '') || '';

          if (href && text.startsWith('[^')) {
            return (
              <a
                {...props}
                className="text-[10px] bg-amplify-elements-background-depth-2 px-1 py-0.5 rounded border border-amplify-elements-borderColor text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition-colors ml-1 align-top"
                target="_blank"
                rel="noopener noreferrer"
              >
                {text}
              </a>
            );
          }

          return (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },

        /*
         * Plain <details> elements from user-supplied markdown are
         * rendered as-is. The legacy `__amplifyThought__` class path
         * that used to inject a brain icon into the summary has been
         * removed — reasoning now flows through the ThoughtProcess
         * component via the AI SDK's native `reasoning` parts, not
         * through `<thought>` tags in the markdown body.
         */
        details: ({ className, children, ...props }) => {
          return (
            <details className={className} {...props}>
              {children}
            </details>
          );
        },

        /*
         * Inline code renderer — detects file paths (`app/_layout.jsx`) and
         * folder paths (`components/ui/`) and renders them as clickable pills
         * with colorized file-type icons. Falls back to a plain <code> for
         * non-path inline code (e.g. `useState`, `npm install`).
         *
         * Block code (inside ``` fences) is intercepted by the `pre` handler
         * above which renders <CodeBlock> directly, so this `code` handler
         * only ever sees INLINE code in practice.
         */
        code: ({ className, children }) => {
          /*
           * Code blocks have a `language-xxx` class — let the default <code>
           * render them (the `pre` handler wraps them in <CodeBlock>).
           */
          if (className && /language-/.test(className)) {
            return <code className={className}>{children}</code>;
          }

          // Inline code — try the file/folder pill.
          const text = typeof children === 'string' ? children : (children?.toString() ?? '');

          return <FilePill raw={text} />;
        },
      } satisfies Components;
    }, [append, setChatMode, model, provider]);

    const remarkPluginsArray = useMemo(() => remarkPlugins(limitedMarkdown), [limitedMarkdown]);
    const rehypePluginsArray = useMemo(() => rehypePlugins(html), [html]);

    return (
      <ReactMarkdown
        allowedElements={allowedHTMLElements}
        className={styles.MarkdownContent}
        components={components}
        remarkPlugins={remarkPluginsArray}
        rehypePlugins={rehypePluginsArray}
      >
        {parsedChildren}
      </ReactMarkdown>
    );
  },
);

/**
 * Removes code fence markers (```) surrounding an artifact element while preserving the artifact content.
 * This is necessary because artifacts should not be wrapped in code blocks when rendered for rendering action list.
 *
 * @param content - The markdown content to process
 * @returns The processed content with code fence markers removed around artifacts
 *
 * @example
 * // Removes code fences around artifact
 * const input = "```xml\n<div class='__amplifyArtifact__'></div>\n```";
 * stripCodeFenceFromArtifact(input);
 * // Returns: "\n<div class='__amplifyArtifact__'></div>\n"
 *
 * @remarks
 * - Only removes code fences that directly wrap an artifact (marked with __amplifyArtifact__ class)
 * - Handles code fences with optional language specifications (e.g. ```xml, ```typescript)
 * - Preserves original content if no artifact is found
 * - Safely handles edge cases like empty input or artifacts at start/end of content
 */
export const stripCodeFenceFromArtifact = (content: string) => {
  if (!content || !content.includes('__amplifyArtifact__')) {
    return content;
  }

  const lines = content.split('\n');
  const artifactLineIndex = lines.findIndex((line) => line.includes('__amplifyArtifact__'));

  // Return original content if artifact line not found
  if (artifactLineIndex === -1) {
    return content;
  }

  // Check previous line for code fence
  if (artifactLineIndex > 0 && lines[artifactLineIndex - 1]?.trim().match(/^```\w*$/)) {
    lines[artifactLineIndex - 1] = '';
  }

  if (artifactLineIndex < lines.length - 1 && lines[artifactLineIndex + 1]?.trim().match(/^```$/)) {
    lines[artifactLineIndex + 1] = '';
  }

  return lines.join('\n');
};

/**
 * Strip residual `<thought>...</thought>` tags from the visible
 * markdown content.
 *
 * The system prompt now instructs the AI to use its native reasoning
 * channel (rendered as `parts[].type === 'reasoning'` → ThoughtProcess
 * component) instead of emitting `<thought>` tags into the response
 * text. We keep this filter as defence-in-depth so a misbehaving model
 * cannot re-introduce the old multi-panel "thought block" UI inside
 * the final answer markdown.
 *
 * Handles three cases:
 *   1. Complete `<thought>…</thought>` blocks → removed entirely
 *   2. Streaming `<thought>…` (no closing tag yet) → removed
 *   3. Orphan `</thought>` → removed
 *
 * Leading whitespace left behind by a stripped block is trimmed so
 * the first paragraph of the real answer doesn't get pushed down.
 */
export const stripResidualThoughtTags = (content: string): string => {
  if (!content || (!content.includes('<thought>') && !content.includes('</thought>'))) {
    return content;
  }

  let out = content;

  // 1. Complete blocks
  out = out.replace(/<thought>[\s\S]*?<\/thought>/g, '');

  // 2. Streaming-open block (no closing tag yet)
  out = out.replace(/<thought>[\s\S]*$/g, '');

  // 3. Orphan closing tag
  out = out.replace(/<\/thought>/g, '');

  /*
   * Tidy up leading whitespace so the answer's first paragraph
   * isn't pushed down by an empty line left behind by a stripped block.
   */
  return out.replace(/^\s+/, '');
};

/**
 * @deprecated Kept only for backward compatibility with any external
 * callers. The new pipeline uses `stripResidualThoughtTags` instead
 * — `<thought>` tags are no longer rendered as collapsible panels
 * inside the answer markdown. They are rendered via the ThoughtProcess
 * component from the AI SDK's native `reasoning` parts.
 */
export const transformThoughtBlocks = (content: string): string => stripResidualThoughtTags(content);
