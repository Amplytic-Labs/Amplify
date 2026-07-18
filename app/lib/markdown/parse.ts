import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";

export interface ParsedMath {
  type: "inlineMath" | "math";
  value: string;
}

/**
 * Parse markdown into an mdast (markdown abstract syntax tree).
 * Supports: GFM (tables, strikethrough, task lists), math ($...$, $$...$$), frontmatter.
 */
export function parseMarkdown(md: string): any {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(md);
  return tree;
}

/**
 * Extract all math expressions from the markdown (for server-side rendering with MathJax).
 */
export function extractMath(md: string): ParsedMath[] {
  const tree = parseMarkdown(md);
  const result: ParsedMath[] = [];
  walk(tree, (node) => {
    if (node.type === "inlineMath" || node.type === "math") {
      result.push({
        type: node.type,
        value: node.value as string,
      });
    }
  });
  return result;
}

function walk(node: any, fn: (n: any) => void) {
  if (!node || typeof node !== "object") return;
  fn(node);
  if (Array.isArray(node.children)) {
    for (const c of node.children) walk(c, fn);
  }
}
