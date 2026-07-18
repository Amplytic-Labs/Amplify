/**
 * Document colour theme for the DOCX export pipeline.
 *
 * Every field is OPTIONAL. When a field is omitted (or when no theme is
 * passed at all) the resolver fills in the matching default — and those
 * defaults are the EXACT hardcoded colours the formatter has always used, so
 * `buildDocx(md, assets)` with no theme produces byte-identical output to
 * the pre-theme implementation.
 *
 * This makes the theme a purely additive overlay: an AI chatbot (or any other
 * caller that copies this pipeline) can pass a partial `DocxTheme` to recolour
 * just the elements it cares about — a heading accent here, a link tint there
 * — and leave everything else untouched. Every document can have its own
 * theme without touching the formatting logic.
 *
 * Framework-agnostic: zero Next.js imports — copy-paste ready for Remix+Vite.
 */

/**
 * Colour + typography overrides for a single document. ALL fields optional.
 *
 * This is designed to be writable as a React Native–style inline object on
 * the `<docxartifact theme={{...}}>` tag, e.g.:
 *
 *   <docxartifact theme={{
 *     heading1: "#0B4F6C",
 *     link: "#1B6CA8",
 *     fontFamily: "Georgia",
 *     bodyFontSize: 12,
 *     margin: 1.25
 *   }}>
 *
 * Every field is optional — omitting any field (or passing no theme at all)
 * falls back to the default, which is the exact look the formatter has always
 * used. So themes are a purely additive overlay.
 */
export interface DocxTheme {
  // ---- Colour fields ----
  /** Body paragraph text colour. */
  body?: string;
  /** H1–H6 text colours (independent). */
  heading1?: string;
  heading2?: string;
  heading3?: string;
  heading4?: string;
  heading5?: string;
  heading6?: string;
  /** Hyperlink text colour. */
  link?: string;

  /** Inline `code` text colour. */
  inlineCodeColor?: string;
  /** Inline `code` background fill. */
  inlineCodeBg?: string;
  /** Fenced code-block text colour. */
  codeBlockColor?: string;
  /** Fenced code-block background fill. */
  codeBlockBg?: string;
  /** Fenced code-block border colour. */
  codeBlockBorder?: string;

  /**
   * Syntax-highlight token colour overrides. Keys are `hljs-*` class names
   * (e.g. `"hljs-keyword"`, `"hljs-string"`). Values are hex colours (with or
   * without leading `#`). When a class is present here it takes precedence
   * over the built-in `oneLight` palette; classes not listed keep their
   * default colour. This is how an AI can recolour code to match a doc theme.
   *
   * NOTE: syntaxColors is NOT supported in the inline `theme={{...}}` tag
   * (it's a nested object). It's only usable programmatically / via presets.
   */
  syntaxColors?: Record<string, string>;

  /** Table cell border colour. */
  tableBorder?: string;
  /** Table header-row background fill. */
  tableHeaderBg?: string;
  /** Blockquote left-bar border colour. */
  blockquoteBorder?: string;
  /** Horizontal-rule (`---`) border colour. */
  thematicBreak?: string;

  // ---- Typography fields (React Native style-object keys) ----
  /** Body + heading font family, e.g. "Arial", "Georgia", "Times New Roman". */
  fontFamily?: string;
  /** Heading font family override (defaults to fontFamily when omitted). */
  headingFontFamily?: string;
  /** Code/monospace font family, e.g. "Consolas", "Courier New". */
  codeFontFamily?: string;
  /** Body font size in points (8–16 typical, default 11). */
  bodyFontSize?: number;
  /** Heading 1–6 font sizes in points (independent). */
  heading1Size?: number;
  heading2Size?: number;
  heading3Size?: number;
  heading4Size?: number;
  heading5Size?: number;
  heading6Size?: number;
  /** Page margin in inches (0.5–2 typical, default 1). */
  margin?: number;
  /** Line spacing multiplier (1.0 single, 1.15 default, 1.5, 2.0 double). */
  lineSpacing?: number;
  /** Page size preset (default "letter"). */
  pageSize?: "letter" | "a4";
}

/**
 * A theme with every field resolved to a concrete value. `buildDocx` works
 * exclusively with this type so downstream code never has to null-check.
 */
export interface ResolvedDocxTheme {
  // ---- Colour fields ----
  body: string;
  heading1: string;
  heading2: string;
  heading3: string;
  heading4: string;
  heading5: string;
  heading6: string;
  link: string;
  inlineCodeColor: string;
  inlineCodeBg: string;
  codeBlockColor: string;
  codeBlockBg: string;
  codeBlockBorder: string;
  syntaxColors: Record<string, string>;
  tableBorder: string;
  tableHeaderBg: string;
  blockquoteBorder: string;
  thematicBreak: string;
  // ---- Typography fields ----
  fontFamily: string;
  headingFontFamily: string;
  codeFontFamily: string;
  /** Body font size in POINTS (e.g. 11). Convert to half-points for docx. */
  bodyFontSize: number;
  heading1Size: number;
  heading2Size: number;
  heading3Size: number;
  heading4Size: number;
  heading5Size: number;
  heading6Size: number;
  /** Page margin in INCHES (e.g. 1). Convert to twips for docx. */
  margin: number;
  /** Line spacing multiplier (e.g. 1.15). Convert to 240ths for docx. */
  lineSpacing: number;
  pageSize: "letter" | "a4";
}

/**
 * The default theme — EXACTLY the colours the formatter hard-coded before
 * themes existed. `resolveTheme(undefined)` returns this object verbatim,
 * so exporting with no theme is a complete no-op.
 *
 * (Colours are stored WITHOUT a leading `#` and in uppercase, which is what
 * the `docx` library expects for run/shading/border `color`/`fill` fields.)
 */
export const DEFAULT_DOCX_THEME: ResolvedDocxTheme = {
  body: "000000",
  heading1: "000000",
  heading2: "000000",
  heading3: "000000",
  heading4: "000000",
  heading5: "000000",
  heading6: "000000",
  link: "1155CC",
  inlineCodeColor: "1F1F1F",
  inlineCodeBg: "F2F2F2",
  codeBlockColor: "1F1F1F",
  codeBlockBg: "F5F5F5",
  codeBlockBorder: "E0E0E0",
  syntaxColors: {},
  tableBorder: "BFBFBF",
  tableHeaderBg: "F0F0F0",
  blockquoteBorder: "CCCCCC",
  thematicBreak: "BFBFBF",
  // Typography defaults — the exact look the formatter has always used.
  fontFamily: "Arial",
  headingFontFamily: "Arial",
  codeFontFamily: "Consolas",
  bodyFontSize: 11,
  heading1Size: 20,
  heading2Size: 16,
  heading3Size: 14,
  heading4Size: 12,
  heading5Size: 11,
  heading6Size: 11,
  margin: 1,
  lineSpacing: 1.15,
  pageSize: "letter",
};

/**
 * Merge a user-supplied partial theme onto the defaults. Invalid colours are
 * silently dropped (the default for that field is kept) — this mirrors the
 * forgiving behaviour of CSS, so a typo from an AI caller never breaks the
 * whole export.
 */
export function resolveTheme(theme?: DocxTheme): ResolvedDocxTheme {
  if (!theme) return DEFAULT_DOCX_THEME;
  const r: ResolvedDocxTheme = { ...DEFAULT_DOCX_THEME, syntaxColors: { ...DEFAULT_DOCX_THEME.syntaxColors } };

  // ---- Colour fields ----
  const setColor = (key: keyof ResolvedDocxTheme, value: string | undefined) => {
    if (value == null) return;
    const clean = sanitizeColor(value);
    if (clean) (r as any)[key] = clean;
  };
  setColor("body", theme.body);
  setColor("heading1", theme.heading1);
  setColor("heading2", theme.heading2);
  setColor("heading3", theme.heading3);
  setColor("heading4", theme.heading4);
  setColor("heading5", theme.heading5);
  setColor("heading6", theme.heading6);
  setColor("link", theme.link);
  setColor("inlineCodeColor", theme.inlineCodeColor);
  setColor("inlineCodeBg", theme.inlineCodeBg);
  setColor("codeBlockColor", theme.codeBlockColor);
  setColor("codeBlockBg", theme.codeBlockBg);
  setColor("codeBlockBorder", theme.codeBlockBorder);
  setColor("tableBorder", theme.tableBorder);
  setColor("tableHeaderBg", theme.tableHeaderBg);
  setColor("blockquoteBorder", theme.blockquoteBorder);
  setColor("thematicBreak", theme.thematicBreak);
  if (theme.syntaxColors) {
    for (const [k, v] of Object.entries(theme.syntaxColors)) {
      const clean = sanitizeColor(v);
      if (clean) r.syntaxColors[k] = clean;
    }
  }

  // ---- Typography fields ----
  const setStr = (key: keyof ResolvedDocxTheme, value: string | undefined) => {
    if (typeof value === "string" && value.trim()) (r as any)[key] = value.trim();
  };
  setStr("fontFamily", theme.fontFamily);
  setStr("headingFontFamily", theme.headingFontFamily);
  setStr("codeFontFamily", theme.codeFontFamily);
  // If a headingFontFamily wasn't given but fontFamily was, inherit it.
  if (!theme.headingFontFamily && theme.fontFamily) {
    r.headingFontFamily = r.fontFamily;
  }

  const setSize = (key: keyof ResolvedDocxTheme, value: number | undefined) => {
    const clean = sanitizeFontSize(value);
    if (clean !== null) (r as any)[key] = clean;
  };
  setSize("bodyFontSize", theme.bodyFontSize);
  setSize("heading1Size", theme.heading1Size);
  setSize("heading2Size", theme.heading2Size);
  setSize("heading3Size", theme.heading3Size);
  setSize("heading4Size", theme.heading4Size);
  setSize("heading5Size", theme.heading5Size);
  setSize("heading6Size", theme.heading6Size);

  const margin = sanitizeMargin(theme.margin);
  if (margin !== null) r.margin = margin;

  const ls = sanitizeLineSpacing(theme.lineSpacing);
  if (ls !== null) r.lineSpacing = ls;

  if (theme.pageSize === "letter" || theme.pageSize === "a4") {
    r.pageSize = theme.pageSize;
  }

  return r;
}

/**
 * Validate a font-size in points. Returns a number clamped to [6, 72], or
 * null if the input is invalid. Half-points are NOT used here — the caller
 * (docx-builder) converts pt → half-points via `ptToHalfPoints()`.
 */
export function sanitizeFontSize(n: number | null | undefined): number | null {
  if (n == null || typeof n !== "number" || !isFinite(n)) return null;
  return Math.min(72, Math.max(6, Math.round(n)));
}

/** Validate a page margin in inches. Clamped to [0.25, 3]. */
export function sanitizeMargin(n: number | null | undefined): number | null {
  if (n == null || typeof n !== "number" || !isFinite(n)) return null;
  return Math.min(3, Math.max(0.25, Math.round(n * 100) / 100));
}

/** Validate a line-spacing multiplier. Clamped to [0.5, 3]. */
export function sanitizeLineSpacing(n: number | null | undefined): number | null {
  if (n == null || typeof n !== "number" || !isFinite(n)) return null;
  return Math.min(3, Math.max(0.5, Math.round(n * 100) / 100));
}

/** Convert points → docx half-points (11pt → 22). */
export function ptToHalfPoints(pt: number): number {
  return Math.round(pt * 2);
}

/** Convert a line-spacing multiplier → docx 240ths-of-a-line (1.15 → 276). */
export function lineSpacingTo240ths(ls: number): number {
  return Math.round(ls * 240);
}

/** Convert inches → docx twips (1in → 1440). */
export function inchesToTwips(inches: number): number {
  return Math.round(inches * 1440);
}

/**
 * Validate + normalise a colour value to the 6-hex-digit uppercase form the
 * `docx` library expects (no leading `#`). Accepts:
 *   - `#rgb`, `#rrggbb`
 *   - `rgb`, `rrggbb` (no #)
 *   - `rgb(r, g, b)`
 * Returns `null` for anything unrecognised.
 */
export function sanitizeColor(c: string | null | undefined): string | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  // #rgb / #rrggbb / rgb / rrggbb
  const hexMatch = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
    return h.toUpperCase();
  }
  // rgb(r, g, b)
  const rgbMatch = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    const [r, g, b] = [rgbMatch[1], rgbMatch[2], rgbMatch[3]].map((v) =>
      parseInt(v, 10).toString(16).padStart(2, "0")
    );
    return (r + g + b).toUpperCase();
  }
  return null;
}

/** Convert a 6-hex colour (no #) to a `#rrggbb` string (for CSS / input[type=color]). */
export function hexToCss(hex: string): string {
  const h = sanitizeColor(hex) || "000000";
  return `#${h}`;
}

/** A named preset theme, for the UI picker. */
export interface DocxThemePreset {
  id: string;
  name: string;
  description: string;
  theme: DocxTheme;
}

/**
 * A small curated set of preset themes. The first entry (`default`) is the
 * classic black-ink look — identical to passing no theme at all. The rest
 * demonstrate the range an AI/caller can produce: warm, cool, editorial,
 * minimal, vivid.
 *
 * Presets intentionally set only the most impactful fields so the rest of the
 * document keeps its clean default styling.
 */
export const THEME_PRESETS: DocxThemePreset[] = [
  {
    id: "default",
    name: "Classic",
    description: "Black ink on white. The original look.",
    theme: {},
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Deep teal headings, sea-blue links.",
    theme: {
      heading1: "0B4F6C",
      heading2: "0B4F6C",
      heading3: "145374",
      heading4: "145374",
      heading5: "1B6CA8",
      heading6: "1B6CA8",
      link: "1B6CA8",
      blockquoteBorder: "5A9BB8",
      thematicBreak: "5A9BB8",
      tableBorder: "A8C8D8",
      codeBlockBorder: "B8D4E0",
      codeBlockBg: "F0F6F9",
      inlineCodeBg: "E8F1F6",
    },
  },
  {
    id: "forest",
    name: "Forest",
    description: "Evergreen headings, moss accents.",
    theme: {
      heading1: "1B4332",
      heading2: "1B4332",
      heading3: "2D6A4F",
      heading4: "2D6A4F",
      heading5: "40916C",
      heading6: "40916C",
      link: "40916C",
      blockquoteBorder: "52B788",
      thematicBreak: "52B788",
      tableBorder: "B7E4C7",
      codeBlockBg: "F1F8F4",
      codeBlockBorder: "C8E6D0",
      inlineCodeBg: "E8F5EC",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm rust headings, amber links.",
    theme: {
      heading1: "9D0208",
      heading2: "9D0208",
      heading3: "D00000",
      heading4: "D00000",
      heading5: "DC2F02",
      heading6: "DC2F02",
      link: "DC2F02",
      blockquoteBorder: "E85D04",
      thematicBreak: "E85D04",
      tableBorder: "F0B89A",
      codeBlockBg: "FDF3EE",
      codeBlockBorder: "F0CDB8",
      inlineCodeBg: "FAE6DA",
    },
  },
  {
    id: "slate",
    name: "Slate",
    description: "Graphite headings, steel accents.",
    theme: {
      heading1: "1F2937",
      heading2: "1F2937",
      heading3: "374151",
      heading4: "374151",
      heading5: "4B5563",
      heading6: "4B5563",
      link: "2563EB",
      blockquoteBorder: "6B7280",
      thematicBreak: "6B7280",
      tableBorder: "CBD5E1",
      tableHeaderBg: "F1F5F9",
      codeBlockBg: "F8FAFC",
      codeBlockBorder: "E2E8F0",
      inlineCodeBg: "F1F5F9",
    },
  },
  {
    id: "royal",
    name: "Royal",
    description: "Plum headings, royal accents.",
    theme: {
      heading1: "4A148C",
      heading2: "4A148C",
      heading3: "6A1B9A",
      heading4: "6A1B9A",
      heading5: "7B1FA2",
      heading6: "7B1FA2",
      link: "7B1FA2",
      blockquoteBorder: "9C27B0",
      thematicBreak: "9C27B0",
      tableBorder: "D1B3E6",
      codeBlockBg: "F7F2FB",
      codeBlockBorder: "E1D0EF",
      inlineCodeBg: "EFE3F7",
    },
  },
  {
    id: "sepia",
    name: "Sepia",
    description: "Warm brown ink, manuscript feel.",
    theme: {
      body: "3E2C1C",
      heading1: "5D4037",
      heading2: "5D4037",
      heading3: "6D4C41",
      heading4: "6D4C41",
      heading5: "795548",
      heading6: "795548",
      link: "8D6E63",
      blockquoteBorder: "A1887F",
      thematicBreak: "A1887F",
      tableBorder: "D7CCC8",
      tableHeaderBg: "EFEBE9",
      codeBlockBg: "FBF5EC",
      codeBlockBorder: "E0D3C0",
      inlineCodeBg: "F3E9D9",
    },
  },
  {
    id: "manuscript",
    name: "Manuscript",
    description: "Serif typography (Georgia), 12pt body, 1.5 spacing — academic feel.",
    theme: {
      fontFamily: "Georgia",
      headingFontFamily: "Georgia",
      codeFontFamily: "Courier New",
      bodyFontSize: 12,
      heading1Size: 22,
      heading2Size: 18,
      heading3Size: 15,
      heading4Size: 13,
      lineSpacing: 1.5,
      margin: 1.25,
      heading1: "1A1A1A",
      heading2: "1A1A1A",
      heading3: "333333",
      link: "1A1A1A",
      blockquoteBorder: "999999",
      thematicBreak: "999999",
    },
  },
  {
    id: "compact",
    name: "Compact",
    description: "10pt body, 0.75in margins, single spacing — maximum density.",
    theme: {
      bodyFontSize: 10,
      heading1Size: 16,
      heading2Size: 13,
      heading3Size: 11,
      heading4Size: 10,
      lineSpacing: 1.0,
      margin: 0.75,
    },
  },
];

// ---------------------------------------------------------------------------
// Inline theme parser — React Native–style object literal → DocxTheme
// ---------------------------------------------------------------------------

/**
 * Recognised theme field names, grouped by value type, so the inline parser
 * can validate keys before assignment. Unknown keys are silently dropped
 * (forgiving, like CSS).
 */
const COLOR_THEME_FIELDS = new Set([
  "body", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6",
  "link", "inlineCodeColor", "inlineCodeBg", "codeBlockColor", "codeBlockBg",
  "codeBlockBorder", "tableBorder", "tableHeaderBg", "blockquoteBorder",
  "thematicBreak",
]);
const NUM_THEME_FIELDS = new Set([
  "bodyFontSize", "heading1Size", "heading2Size", "heading3Size",
  "heading4Size", "heading5Size", "heading6Size", "margin", "lineSpacing",
]);
const STR_THEME_FIELDS = new Set(["fontFamily", "headingFontFamily", "codeFontFamily"]);
const PAGE_SIZE_VALUES = new Set(["letter", "a4"]);

/**
 * Parse a React Native–style inline theme object from a raw string like:
 *
 *     { heading1: "#0B4F6C", link: "#1B6CA8", fontFamily: "Georgia", bodyFontSize: 12 }
 *
 * Accepts BOTH quoted and unquoted keys, single OR double-quoted string values,
 * and bare numeric values — exactly how React Native style objects are written.
 * Invalid keys / values are silently dropped (the matching field keeps its
 * default), so a typo from the AI never breaks the export.
 *
 * `syntaxColors` (a nested object) is NOT supported here — it's only usable
 * programmatically / via presets. Every other DocxTheme field is supported.
 *
 * Streaming-safe: if the object is truncated mid-value, the regex simply won't
 * match the incomplete pair and it's skipped. Complete pairs before the
 * truncation are still captured, so the live preview updates progressively.
 *
 * Returns a partial `DocxTheme` (only the fields that parsed successfully).
 */
export function parseInlineTheme(src: string): DocxTheme {
  const theme: DocxTheme = {};

  if (!src || typeof src !== "string") return theme;

  /*
   * Match one key:value pair at a time. The key can be:
   *   - an unquoted identifier:   heading1
   *   - a double-quoted string:   "heading1"
   *   - a single-quoted string:   'heading1'
   * The value can be:
   *   - a double-quoted string:   "#0B4F6C"
   *   - a single-quoted string:   '#0B4F6C'
   *   - a bare number:            12  or  1.25  or  -5
   * Trailing commas / whitespace between pairs are ignored by the regex
   * advance (the `g` flag + exec loop naturally skips unmatched chars).
   */
  const pairRe =
    /(?:["']?([A-Za-z_]\w*)["']?\s*:\s*(?:"([^"]*)"|'([^']*)'|(-?\d+(?:\.\d+)?)))/g;

  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(src)) !== null) {
    const key = m[1];
    // m[2] = double-quoted value, m[3] = single-quoted value, m[4] = numeric value
    const strVal = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : undefined;
    const numVal = m[4] !== undefined ? parseFloat(m[4]) : undefined;

    applyThemeField(theme, key, strVal, numVal);
  }

  return theme;
}

/**
 * Map a single parsed key/value pair onto the `theme` object, validating the
 * key name and value type. Unknown keys are dropped silently.
 */
function applyThemeField(
  theme: DocxTheme,
  key: string,
  strVal: string | undefined,
  numVal: number | undefined,
): void {
  if (COLOR_THEME_FIELDS.has(key)) {
    if (strVal) (theme as any)[key] = strVal;
  } else if (NUM_THEME_FIELDS.has(key)) {
    if (numVal !== undefined && isFinite(numVal)) (theme as any)[key] = numVal;
  } else if (STR_THEME_FIELDS.has(key)) {
    if (strVal) (theme as any)[key] = strVal;
  } else if (key === "pageSize") {
    if (strVal && PAGE_SIZE_VALUES.has(strVal)) {
      theme.pageSize = strVal as "letter" | "a4";
    }
  }
  // Unknown keys are silently dropped — forgiving, like CSS.
}
