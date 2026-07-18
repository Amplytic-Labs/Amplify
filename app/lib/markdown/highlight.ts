import { createLowlight, all } from "lowlight";

/**
 * Server-side syntax highlighting for code blocks in the DOCX export.
 *
 * `lowlight` is a tiny wrapper around `highlight.js` that produces an
 * HAST (HTML abstract syntax tree) of `<span class="hljs-keyword">…</span>`
 * etc. tokens. We walk that tree and emit one `<TextRun>` per token,
 * coloured according to a small palette inspired by the `oneLight` theme
 * used in the preview.
 *
 * Framework-agnostic: no Next.js imports — copy-paste ready for Remix+Vite.
 */

const lowlight = createLowlight(all);

/** One token in the highlighted output. */
export interface HighlightToken {
  /** The text content of this token. */
  text: string;
  /** The highlight.js scope class name (e.g. "hljs-keyword"), or "". */
  className: string;
}

/** Colour palette — maps `hljs-*` class names to hex colours. */
const HLJS_COLORS: Record<string, string> = {
  "hljs-keyword": "#a626a4",        // magenta — keywords (if, for, return)
  "hljs-built_in": "#c18401",       // orange — built-in funcs / types
  "hljs-type": "#c18401",           // orange — type names
  "hljs-class": "#c18401",          // orange — class names
  "hljs-function": "#4078f2",       // blue — function names
  "hljs-title": "#4078f2",          // blue — function titles
  "hljs-title.function_": "#4078f2",
  "hljs-title.class_": "#c18401",
  "hljs-attr": "#986801",           // orange — attribute names
  "hljs-attribute": "#986801",
  "hljs-property": "#986801",
  "hljs-string": "#50a14f",         // green — strings
  "hljs-meta": "#4078f2",           // blue — meta (decorators, shebangs)
  "hljs-comment": "#a0a1a7",        // gray — comments
  "hljs-quote": "#a0a1a7",
  "hljs-doctag": "#a0a1a7",
  "hljs-number": "#986801",         // orange — numeric literals
  "hljs-literal": "#0184bb",        // cyan — true/false/null
  "hljs-boolean": "#0184bb",
  "hljs-regexp": "#50a14f",         // green — regex
  "hljs-variable": "#e45649",       // red — variables (rare)
  "hljs-template-variable": "#e45649",
  "hljs-symbol": "#986801",
  "hljs-bullet": "#986801",
  "hljs-link": "#4078f2",
  "hljs-emphasis": "#383a42",       // default + italic
  "hljs-strong": "#383a42",         // default + bold
  "hljs-section": "#4078f2",
  "hljs-tag": "#e45649",            // red — HTML/XML tag names
  "hljs-name": "#e45649",
  "hljs-selector-class": "#986801",
  "hljs-selector-id": "#986801",
  "hljs-selector-tag": "#e45649",
  "hljs-addition": "#50a14f",
  "hljs-deletion": "#e45649",
};

const DEFAULT_COLOR = "1F1F1F";

/** Returns true if `lowlight` recognises the language. */
export function isLanguageSupported(lang: string): boolean {
  if (!lang) return false;
  return lowlight.registered(lang.toLowerCase());
}

/**
 * Highlight `code` in `language` and return a flat list of tokens
 * (text + className). Unknown languages return a single token with the
 * raw text and no className.
 *
 * Each token corresponds to ONE line of text — multi-line code is split
 * on `\n` so the caller can emit `<TextRun break:1>` between lines.
 */
export function highlightCode(code: string, language: string): HighlightToken[] {
  const lang = (language || "").toLowerCase();
  const cleaned = code.replace(/\n$/, "");

  if (!lang || !lowlight.registered(lang)) {
    return [{ text: cleaned, className: "" }];
  }

  try {
    const hast = lowlight.highlight(lang, cleaned);
    return hastToTokens(hast);
  } catch {
    return [{ text: cleaned, className: "" }];
  }
}

function hastToTokens(hast: any): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  walk(hast, "", (text, className) => {
    if (!text) return;
    // Split on newlines so the caller can break runs between lines.
    // Each line becomes its own token with the SAME className.
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) tokens.push({ text: "\n", className: "" });
      if (parts[i]) tokens.push({ text: parts[i], className });
    }
  });
  if (tokens.length === 0) tokens.push({ text: "", className: "" });
  return tokens;
}

function walk(node: any, parentClass: string, emit: (text: string, className: string) => void): void {
  if (!node) return;
  if (node.type === "text") {
    emit(node.value || "", parentClass);
    return;
  }
  if (node.type === "element") {
    // Combine parent class with this element's class (child wins).
    const props = node.properties || {};
    const classNames: string[] = Array.isArray(props.className) ? props.className : [];
    // Use the LAST class (most specific) — e.g. "hljs-keyword" not "hljs".
    const ownClass = classNames.length > 0 ? classNames[classNames.length - 1] : "";
    const myClass = ownClass || parentClass;
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child, myClass, emit);
    }
    return;
  }
  if (node.type === "root" && Array.isArray(node.children)) {
    for (const child of node.children) walk(child, parentClass, emit);
  }
}

/**
 * Resolve a `hljs-*` class name to a hex colour (without the leading #).
 *
 * @param className  The highlight.js scope class (e.g. `"hljs-keyword"`). May
 *                   be empty for unscoped text.
 * @param override   Optional caller-supplied colour map (from the document
 *                   theme's `syntaxColors`). Keys are `hljs-*` class names,
 *                   values are hex colours (`"#a626a4"`, `"A626A4"`, etc.).
 *                   When a class is present in `override` it WINS over the
 *                   built-in palette — this is how an AI can recolour code
 *                   tokens to match a document theme without touching the
 *                   highlighter itself. Entries for classes not in the
 *                   palette are ignored.
 */
export function colorForClass(className: string, override?: Record<string, string>): string {
  if (!className) return DEFAULT_COLOR;
  // Drop leading "hljs-" if present to build the canonical key.
  const key = className.startsWith("hljs-") ? className : `hljs-${className}`;
  // 1. Caller override (from DocxTheme.syntaxColors) — wins if present.
  if (override) {
    const ov = override[key] ?? override[className];
    if (ov) {
      const clean = sanitizeHex(ov);
      if (clean) return clean;
    }
  }
  // 2. Built-in palette.
  const color = HLJS_COLORS[key];
  return color ? color.replace("#", "").toUpperCase() : DEFAULT_COLOR;
}

/** Normalise a hex colour to the 6-digit uppercase no-# form, or return null. */
function sanitizeHex(c: string): string | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  const m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  return h.toUpperCase();
}
