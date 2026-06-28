import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { PluggableList, Plugin } from 'unified';
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from 'rehype-sanitize';
import { SKIP, visit } from 'unist-util-visit';
import type { UnistNode, UnistParent } from 'node_modules/unist-util-visit/lib';

export const allowedHTMLElements = [
  'a',
  'b',
  'button',
  'blockquote',
  'br',
  'code',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'ins',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'source',
  'span',
  'strike',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'var',
  'header',
];

const rehypeSanitizeOptions: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: allowedHTMLElements,
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      'data*',
      ['className', '__boltArtifact__', '__boltQuickAction', '__boltSelectedElement__', '__boltThought__'],
    ],
    button: [
      ...(defaultSchema.attributes?.button ?? []),
      'data*',
      'type',
      'disabled',
      'name',
      'value',
      ['className', '__boltArtifact__', '__boltQuickAction'],
    ],

    /*
     * Allow class on details/summary so the <thought> block preprocessor
     * can mark them with __boltThought__ for Copilot-style rendering.
     */
    details: [...(defaultSchema.attributes?.details ?? []), ['className', '__boltThought__'], 'open'],
    summary: [...(defaultSchema.attributes?.summary ?? [])],
  },
  strip: [],
};

export function remarkPlugins(limitedMarkdown: boolean) {
  const plugins: PluggableList = [remarkGfm, remarkMath];

  if (limitedMarkdown) {
    plugins.unshift(limitedMarkdownPlugin);
  }

  return plugins;
}

export function rehypePlugins(html: boolean) {
  const plugins: PluggableList = [];

  if (html) {
    plugins.push(rehypeRaw, [rehypeSanitize, rehypeSanitizeOptions]);
  }

  plugins.push(rehypeKatex);

  return plugins;
}

const limitedMarkdownPlugin: Plugin = () => {
  return (tree, file) => {
    const contents = file.toString();

    visit(tree, (node: UnistNode, index, parent: UnistParent) => {
      if (
        index == null ||
        ['paragraph', 'text', 'inlineCode', 'code', 'strong', 'emphasis'].includes(node.type) ||
        !node.position
      ) {
        return true;
      }

      let value = contents.slice(node.position.start.offset, node.position.end.offset);

      if (node.type === 'heading') {
        value = `\n${value}`;
      }

      parent.children[index] = {
        type: 'text',
        value,
      } as any;

      return [SKIP, index] as const;
    });
  };
};
