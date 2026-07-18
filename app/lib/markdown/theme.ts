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

/** Colour overrides for a single document. ALL fields optional. */
export interface DocxTheme {
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
}

/**
 * A theme with every field resolved to a concrete value. `buildDocx` works
 * exclusively with this type so downstream code never has to null-check.
 */
export interface ResolvedDocxTheme {
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
  const set = (key: keyof ResolvedDocxTheme, value: string | undefined) => {
    if (value == null) return;
    const clean = sanitizeColor(value);
    if (clean) (r as any)[key] = clean;
  };
  set("body", theme.body);
  set("heading1", theme.heading1);
  set("heading2", theme.heading2);
  set("heading3", theme.heading3);
  set("heading4", theme.heading4);
  set("heading5", theme.heading5);
  set("heading6", theme.heading6);
  set("link", theme.link);
  set("inlineCodeColor", theme.inlineCodeColor);
  set("inlineCodeBg", theme.inlineCodeBg);
  set("codeBlockColor", theme.codeBlockColor);
  set("codeBlockBg", theme.codeBlockBg);
  set("codeBlockBorder", theme.codeBlockBorder);
  set("tableBorder", theme.tableBorder);
  set("tableHeaderBg", theme.tableHeaderBg);
  set("blockquoteBorder", theme.blockquoteBorder);
  set("thematicBreak", theme.thematicBreak);
  if (theme.syntaxColors) {
    for (const [k, v] of Object.entries(theme.syntaxColors)) {
      const clean = sanitizeColor(v);
      if (clean) r.syntaxColors[k] = clean;
    }
  }
  return r;
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
];
