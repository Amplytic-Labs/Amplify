import { memo, useMemo, useRef, useEffect } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { BundledLanguage } from 'shiki';
import { createScopedLogger } from '~/utils/logger';
import { rehypePlugins, remarkPlugins, allowedHTMLElements } from '~/utils/markdown';
import { Artifact, openArtifactInWorkbench } from './Artifact';
import { CodeBlock } from './CodeBlock';
import { Mermaid } from './Mermaid';
import type { Message } from 'ai';
import styles from './Markdown.module.scss';
import type { ProviderInfo } from '~/types/model';

const logger = createScopedLogger('MarkdownComponent');

interface MarkdownProps {
  children: string;
  html?: boolean;
  limitedMarkdown?: boolean;
  append?: (message: Message) => void;
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
     *   1. Strip code fences around boltArtifact (existing behaviour)
     *   2. Convert <thought>...</thought> blocks into collapsible
     *      <details class="__boltThought__"> elements so the AI's
     *      chain-of-thought renders Copilot-style (collapsible, dimmed,
     *      with a "Thought process" summary). The `<thought>` tag is not
     *      a real HTML element so we transform it BEFORE markdown parsing
     *      rather than relying on rehype-raw to recognise it.
     */
    const parsedChildren = useMemo(() => {
      const stripped = stripCodeFenceFromArtifact(children);
      return transformThoughtBlocks(stripped);
    }, [children]);

    const childrenRef = useRef(parsedChildren);
    childrenRef.current = parsedChildren;

    const components = useMemo(() => {
      return {
        div: ({ className, children, node, ...props }) => {
          const dataProps = node?.properties as Record<string, unknown>;

          if (className?.includes('__boltArtifact__')) {
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

          if (className?.includes('__boltThought__')) {
            return <div className="__boltThought__">{children}</div>;
          }

          if (className?.includes('__boltSelectedElement__')) {
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
              <div className="bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded-lg p-3 my-2">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-mono bg-bolt-elements-background-depth-2 px-2 py-1 rounded text-bolt-elements-textTer">
                    {elementData?.tagName}
                  </span>
                  {elementData?.className && (
                    <span className="text-xs text-bolt-elements-textSecondary">.{elementData.className}</span>
                  )}
                </div>
                <code className="block text-sm !text-bolt-elements-textSecondary !bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor p-2 rounded">
                  {elementData?.displayText}
                </code>
              </div>
            );
          }

          if (className?.includes('__boltQuickAction__') || dataProps?.dataBoltQuickAction) {
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

            return <CodeBlock code={firstChild.children[0].value} language={language as BundledLanguage} {...rest} />;
          }

          return <pre {...rest}>{preChildren}</pre>;
        },
        button: ({ node, children, ...props }) => {
          const dataProps = node?.properties as Record<string, unknown>;

          if (
            dataProps?.class?.toString().includes('__boltQuickAction__') ||
            dataProps?.dataBoltQuickAction === 'true'
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
                className="rounded-md justify-center px-3 py-1.5 text-xs bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent opacity-90 hover:opacity-100 flex items-center gap-2 cursor-pointer"
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
                      content: [
                        {
                          type: 'text',
                          text: `[Model: ${model}]\n\n[Provider: ${provider?.name}]\n\n${message}`,
                        },
                      ] as any,
                      role: 'user',
                    });
                    console.log('Message appended:', message);
                  } else if (type === 'implement' && append && setChatMode) {
                    setChatMode('build');
                    append({
                      id: `quick-action-implement-${Date.now()}`,
                      content: [
                        {
                          type: 'text',
                          text: `[Model: ${model}]\n\n[Provider: ${provider?.name}]\n\n${message}`,
                        },
                      ] as any,
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

          return <button {...props}>{children}</button>;
        },
        a: ({ node, children, ...props }) => {
          const href = props.href;
          const text =
            typeof children === 'string' ? children : (Array.isArray(children) ? children[0]?.toString() : '') || '';

          if (href && text.startsWith('[^')) {
            return (
              <a
                {...props}
                className="text-[10px] bg-bolt-elements-background-depth-2 px-1 py-0.5 rounded border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors ml-1 align-top"
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
         * Copilot-style <thought> block — rendered as a collapsible
         * "Thought process" panel. The preprocessor converts
         * `<thought>content</thought>` into
         * `<details class="__boltThought__"><summary>Thought process</summary>content</details>`.
         */
        details: ({ className, children, node, ...props }) => {
          if (className?.includes('__boltThought__')) {
            return (
              <details
                className="__boltThought__ my-3 border border-bolt-elements-borderColor rounded-lg bg-bolt-elements-background-depth-2 overflow-hidden"
                {...props}
              >
                {children}
              </details>
            );
          }

          return (
            <details className={className} {...props}>
              {children}
            </details>
          );
        },
        summary: ({ className, children, node, ...props }) => {
          // Style the summary differently inside a thought block
          const isThought =
            className?.includes('__boltThought__') ||
            (node?.properties as any)?.className?.toString().includes('__boltThought__');

          if (isThought) {
            return (
              <summary
                className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-bolt-elements-textSecondary bg-bolt-elements-background-depth-3 hover:bg-bolt-elements-artifacts-backgroundHover transition-colors flex items-center gap-2"
                {...props}
              >
                <span className="i-ph:brain text-base" />
                <span>Thought process</span>
              </summary>
            );
          }

          return (
            <summary className={className} {...props}>
              {children}
            </summary>
          );
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
 * const input = "```xml\n<div class='__boltArtifact__'></div>\n```";
 * stripCodeFenceFromArtifact(input);
 * // Returns: "\n<div class='__boltArtifact__'></div>\n"
 *
 * @remarks
 * - Only removes code fences that directly wrap an artifact (marked with __boltArtifact__ class)
 * - Handles code fences with optional language specifications (e.g. ```xml, ```typescript)
 * - Preserves original content if no artifact is found
 * - Safely handles edge cases like empty input or artifacts at start/end of content
 */
export const stripCodeFenceFromArtifact = (content: string) => {
  if (!content || !content.includes('__boltArtifact__')) {
    return content;
  }

  const lines = content.split('\n');
  const artifactLineIndex = lines.findIndex((line) => line.includes('__boltArtifact__'));

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
 * Convert `<thought>...</thought>` blocks emitted by the AI into a
 * collapsible `<details class="__boltThought__">` element so they render
 * Copilot-style (collapsible, dimmed, "Thought process" summary).
 *
 * This runs BEFORE markdown parsing because `<thought>` is not a real HTML
 * element and would be stripped by rehype-sanitize. By rewriting it to a
 * standard `<details>` element we get:
 *   - Native browser collapse/expand behaviour
 *   - Compatibility with the existing sanitisation allow-list
 *   - A clear visual separation between reasoning and the answer
 *
 * The transformation is a non-greedy regex match across newlines. We
 * preserve the inner content verbatim (it can itself contain markdown).
 * We also handle the streaming case where `</thought>` has not yet been
 * emitted — a lone `<thought>` opens a block that stays open until the
 * next `</thought>` or end-of-string, so partial thoughts render
 * incrementally as the AI streams tokens.
 */
export const transformThoughtBlocks = (content: string): string => {
  if (!content || !content.includes('<thought>')) {
    return content;
  }

  // First, replace complete <thought>...</thought> blocks
  let out = content.replace(
    /<thought>([\s\S]*?)<\/thought>/g,
    (_, inner: string) =>
      `\n\n<details class="__boltThought__"><summary>Thought process</summary>\n\n${inner.trim()}\n\n</details>\n\n`,
  );

  /*
   * Streaming case: a <thought> tag with no closing tag yet. Render it as
   * an open <details> so the user sees the chain-of-thought live.
   */
  out = out.replace(
    /<thought>([\s\S]*)$/g,
    (_, inner: string) =>
      `\n\n<details class="__boltThought__" open><summary>Thought process</summary>\n\n${inner.trim()}\n\n</details>\n\n`,
  );

  return out;
};
