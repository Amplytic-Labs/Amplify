/**
 * OMML (Office Math Markup Language) post-processor.
 *
 * The `mathml2omml` library does a decent job converting KaTeX's MathML
 * output to OMML, but has several known shortcomings that produce ugly
 * rendering in Microsoft Word:
 *
 *   1. **Invisible operator characters** (U+2061 FUNCTION APPLICATION,
 *      U+2062 INVISIBLE TIMES, U+2063 INVISIBLE SEPARATOR, U+2064
 *      INVISIBLE PLUS) are left inside `<m:t>` text runs. Word renders
 *      these as visible empty boxes / dotted squares.
 *
 *   2. **Function names** (`\sin`, `\cos`, `\tan`, `\log`, `\lim`, …)
 *      are flattened into the same text run as their argument, so
 *      `sin x` becomes one run `sin⁡x`. Word has no way to know that
 *      `sin` is a function name and should be upright (not italic) and
 *      tightly spaced to its argument.
 *
 *   3. **Empty `<m:e/>` elements** are produced by the n-ary conversion
 *      (integrals, sums, products). The operand that *should* live
 *      inside `<m:e>` is left as a sibling element after the n-ary.
 *      Word renders the empty `<m:e/>` as a dotted square placeholder.
 *
 *   4. **Delimiters** (`\left( … \right)`, `\left[ … \right]`,
 *      `\left\{ … \right\}`, `|…|`, `‖…‖`) are converted to plain
 *      text characters `(`, `)`, `[`, … around the content. Word does
 *      NOT grow these to fit tall content (fractions, matrices, etc.),
 *      so brackets appear too small.
 *
 *   5. **Piecewise functions** (`\begin{cases}…\end{cases}`) produce
 *      a standalone `{` text run followed by a matrix. The `{` does
 *      not grow to match the matrix height, so it looks tiny.
 *
 * This module fixes all five issues with a tree-based transformation
 * (using `xml-js` for robust parsing).
 */
import { xml2js, js2xml } from 'xml-js';

/*
 * ---------------------------------------------------------------------------
 * Public API
 * ---------------------------------------------------------------------------
 */

/**
 * Apply all OMML fixes to a string of OMML markup.
 *
 * Input  — the OMML fragment emitted by `mathml2omml` (typically a
 *          `<m:oMath>…</m:oMath>` element).
 * Output — a semantically equivalent OMML fragment that renders cleanly
 *          in Microsoft Word.
 */
export function postProcessOmml(omml: string): string {
  if (!omml) {
    return omml;
  }

  try {
    /*
     * `mathml2omml` doesn't escape `<`, `>` inside `<m:t>` text content
     * (e.g. `x<0` from `\begin{cases}…x<0…\end{cases}`), which makes
     * the OMML invalid XML and causes `xml2js` to throw. Fix the
     * escaping BEFORE parsing.
     */
    const fixed = fixTextEscaping(omml);
    const tree = xml2js(fixed, { compact: false }) as unknown as XNode;
    transformNode(tree);

    return js2xml(tree);
  } catch {
    /*
     * If anything goes wrong, return the input unchanged — better to
     * render an imperfect equation than no equation at all.
     */
    return omml;
  }
}

/**
 * Escape `<` and `>` inside `<m:t>…</m:t>` text content so the OMML is
 * valid XML. `mathml2omml` leaves these unescaped (e.g. `x<0` for the
 * condition `x<0` in a piecewise function), which breaks XML parsing.
 *
 * We only escape inside `<m:t>` elements — the surrounding markup is
 * already valid XML and must not be touched.
 */
function fixTextEscaping(omml: string): string {
  return omml.replace(/(<m:t\b[^>]*>)([\s\S]*?)(<\/m:t>)/g, (_m, open: string, text: string, close: string) => {
    /*
     * Don't double-escape: if the text already contains &lt; or &gt;,
     * leave them. Only escape raw < and >.
     */
    const fixed = text
      .replace(/&/g, '&amp;') // & must be first
      .replace(/&amp;(amp|lt|gt|quot|apos);/g, '&$1;') // un-double-escape
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `${open}${fixed}${close}`;
  });
}

/*
 * ---------------------------------------------------------------------------
 * xml-js type shims (the lib's typings are loose; tighten them here)
 * ---------------------------------------------------------------------------
 */

interface XNode {
  type?: 'element' | 'text' | 'instruction' | 'cdata' | 'comment' | 'doctype';
  name?: string;
  attributes?: Record<string, string>;
  elements?: XNode[];
  text?: string;
}

function el(name: string, attrs: Record<string, string> = {}, children: XNode[] = []): XNode {
  return { type: 'element', name, attributes: attrs, elements: children };
}

function txt(s: string): XNode {
  return { type: 'text', text: s };
}

/*
 * ---------------------------------------------------------------------------
 * Invisible operator characters
 * ---------------------------------------------------------------------------
 */
const INVISIBLE_RE = /[\u2061\u2062\u2063\u2064]/g;

/*
 * ---------------------------------------------------------------------------
 * Transformation driver
 * ---------------------------------------------------------------------------
 */

function transformNode(node: XNode): void {
  if (!node.elements) {
    return;
  }

  /*
   * 1. Split function-name runs at U+2061 boundaries, wrapping the
   *    function-name parts in <m:fName> with plain (upright) style.
   *    MUST run before recursing — otherwise the recursive
   *    stripInvisibleInPlace call would delete the U+2061 marker
   *    before we get a chance to split on it.
   */
  node.elements = splitFunctionNames(node.elements);

  /*
   * 1b. Split mixed bar runs. KaTeX sometimes flattens `\left\| x \right\|`
   *     into a single `<m:r><m:t>∥x∥</m:t></m:r>` run. We split any run
   *     whose text mixes bar chars with non-bar chars into separate
   *     runs so the bar chars become standalone and can be wrapped in
   *     `<m:d>` delimiters. MUST run before recursing so the split
   *     propagates to children's children.
   */
  node.elements = splitMixedBarRuns(node.elements);

  /*
   * 2. Recurse into the (now possibly-split) children so nested
   *    structures (fractions, radicals, matrices, …) get the same
   *    treatment.
   */
  for (const child of node.elements) {
    if (child.type === 'element') {
      transformNode(child);
    }
  }

  /*
   * 3. Strip invisible operator chars (U+2061-U+2064) from <m:t> text
   *    nodes — NON-recursively (the recursion above already handled
   *    deeper levels). After step 1, U+2061 only remains inside
   *    non-function contexts (e.g. U+2062 INVISIBLE TIMES), so we
   *    just delete them.
   */
  stripInvisibleInPlace(node);

  // 4. Drop empty <m:e/> elements (left behind by n-ary conversion).
  node.elements = node.elements.filter((c) => !(c.name === 'm:e' && (!c.elements || c.elements.length === 0)));

  /*
   * 5. Convert standalone bracket runs into <m:d> delimiter elements
   *    that grow to fit their content. Handles paired delimiters:
   *    ( ), [ ] { } ⟨ ⟩ | | ‖ ‖
   */
  node.elements = wrapPairedDelimiters(node.elements);

  /*
   * 6. Handle piecewise `cases` matrices: a standalone `{` run
   *    immediately followed by an `<m:m>` matrix becomes a growing
   *    delimiter with empty close character.
   */
  node.elements = wrapCasesBrace(node.elements);

  /*
   * 7. Normalise begChr/endChr characters on ALL `<m:d>` delimiters
   *    (both the ones we just created AND the ones KaTeX/mathml2omml
   *    produced for `\left|…\right|`, `\begin{vmatrix}`, `\begin{cases}`,
   *    etc.). Word only grows `|` (U+007C) and `‖` (U+2016); it silently
   *    leaves `∣` (U+2223) and `∥` (U+2225) at fixed height even with
   *    `<m:grow m:val="1"/>`. Swap to the visually-equivalent chars Word
   *    CAN grow.
   */
  normalizeDelimCharsInPlace(node);
}

/*
 * ---------------------------------------------------------------------------
 * 2. Strip invisible operator characters
 * ---------------------------------------------------------------------------
 */

/**
 * Strip invisible operator characters from DIRECT `<m:t>` children only.
 * Non-recursive — `transformNode` already recurses, so we only need to
 * handle this node's own children here. This is important because the
 * recursion order means a child `<m:r>` may still have an un-split
 * U+2061 that `splitFunctionNames` (running at the child's level) needs
 * to see.
 */
function stripInvisibleInPlace(node: XNode): void {
  if (!node.elements) {
    return;
  }

  for (const c of node.elements) {
    if (c.name === 'm:t' && c.elements) {
      for (const t of c.elements) {
        if (t.type === 'text' && t.text) {
          t.text = t.text.replace(INVISIBLE_RE, '');
        }
      }
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * 3. Split function-name runs at U+2061
 * ---------------------------------------------------------------------------
 */

/**
 * Known function names. When a text run contains U+2061 (FUNCTION
 * APPLICATION), the text immediately before the U+2061 should end with
 * one of these names — we emit the trailing function-name suffix as a
 * plain **upright** run (`<m:sty m:val="p"/>`) and leave any preceding
 * text as a regular run.
 *
 * NOTE: an earlier version wrapped the function name in `<m:fName>`.
 * That element is ONLY valid as a direct child of `<m:func>`. When the
 * function name is the base of a limit/underscript/subscript/superscript
 * (e.g. `\lim_{x\to0}`, `\log_2`, `\max_{x\in S}`), the run sits inside
 * `<m:limLow><m:e>`, `<m:sSub><m:e>`, etc. — placing `<m:fName>` there is
 * invalid OMML and Word silently drops it, so `\lim` rendered as
 * nothing. Using a plain upright `<m:r>` works in EVERY context.
 *
 * Sorted by length descending at lookup time so longer names (e.g.
 * `arcsin`) match before shorter ones (`sin`).
 */
const FUNCTION_NAMES = [
  'arcsin',
  'arccos',
  'arctan',
  'arcsec',
  'arccsc',
  'arccot',
  'sinh',
  'cosh',
  'tanh',
  'coth',
  'sech',
  'csch',
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'exp',
  'log',
  'ln',
  'lg',
  'lb',
  'det',
  'dim',
  'gcd',
  'lcm',
  'max',
  'min',
  'sup',
  'inf',
  'lim',
  'arg',
  'ker',
  'Pr',
  'Re',
  'Im',
  'mod',
  'deg',
  'hom',
  'sgn',
].sort((a, b) => b.length - a.length);

/**
 * KaTeX emits `\sin x` as `<mi>sin</mi><mo>⁡</mo><mi>x</mi>` (the U+2061
 * FUNCTION APPLICATION sits between the function name and its argument).
 * `mathml2omml` flattens this into a single `<m:r><m:t>sin⁡x</m:t></m:r>`.
 *
 * For an expression like `\cos\theta + i\sin\theta`, the flattened run
 * is `cos⁡θ+isin⁡θ` — a single text run with TWO U+2061 markers. We split
 * at each U+2061, then for each piece that precedes a U+2061 we check
 * whether it ENDS with a known function name. If so, the trailing
 * function name is emitted as an **upright** run (`<m:sty m:val="p"/>`)
 * and any preceding text in the piece is emitted as a regular run. The
 * final piece (after the last U+2061) is always a regular run (the
 * argument).
 *
 * Using a plain upright `<m:r>` (instead of wrapping in `<m:fName>`)
 * keeps the markup valid in every math context — including as the base
 * of `<m:limLow>`, `<m:sSub>`, `<m:sSup>` (for `\lim_{…}`, `\log_2`,
 * `\max_{…}`, …), where `<m:fName>` would be invalid and silently
 * dropped by Word.
 */
function splitFunctionNames(children: XNode[]): XNode[] {
  const out: XNode[] = [];

  for (const child of children) {
    if (child.name === 'm:r' && runHasInvisibleFunction(child)) {
      out.push(...splitFunctionRun(child));
    } else {
      out.push(child);
    }
  }

  return out;
}

function runHasInvisibleFunction(run: XNode): boolean {
  const t = getRunText(run);
  return !!t && t.includes('\u2061');
}

function getRunText(run: XNode): string | null {
  if (!run.elements) {
    return null;
  }

  const tElem = run.elements.find((c) => c.name === 'm:t');

  if (!tElem || !tElem.elements) {
    return null;
  }

  return tElem.elements
    .filter((e) => e.type === 'text')
    .map((e) => e.text || '')
    .join('');
}

/** Find the longest known function-name suffix of `s`, or "" if none. */
function matchFunctionSuffix(s: string): string {
  for (const fname of FUNCTION_NAMES) {
    if (s.length >= fname.length && s.endsWith(fname)) {
      return fname;
    }
  }
  return '';
}

function splitFunctionRun(run: XNode): XNode[] {
  const tElem = run.elements?.find((c) => c.name === 'm:t');

  if (!tElem) {
    return [run];
  }

  const text = (tElem.elements || [])
    .filter((e) => e.type === 'text')
    .map((e) => e.text || '')
    .join('');

  if (!text.includes('\u2061')) {
    return [run];
  }

  const parts = text.split('\u2061');
  const tAttrs = tElem.attributes || {};
  const rPr = run.elements?.find((c) => c.name === 'm:rPr');
  const result: XNode[] = [];

  /** Build a regular run (preserving any existing rPr) from text. */
  const regularRun = (s: string): XNode => {
    const children: XNode[] = [];

    if (rPr) {
      children.push(rPr);
    }

    children.push(el('m:t', tAttrs, [txt(s)]));

    return el('m:r', {}, children);
  };

  /**
   * Build an **upright** run from text — the function name. Uses
   * `<m:sty m:val="p"/>` (plain / upright) so the name renders
   * non-italic, exactly like `\sin`, `\lim`, `\log` do in LaTeX/KaTeX.
   * A plain `<m:r>` is valid in every OMML context (top-level, inside
   * `<m:e>` of limLow/sSub/sSup/func, inside fraction numerator/
   * denominator, …), unlike `<m:fName>` which is only valid inside
   * `<m:func>`.
   */
  const functionNameRun = (s: string): XNode =>
    el('m:r', {}, [el('m:rPr', {}, [el('m:sty', { 'm:val': 'p' })]), el('m:t', tAttrs, [txt(s)])]);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (!part) {
      continue;
    }

    if (i < parts.length - 1) {
      /*
       * This part is followed by U+2061, so it should end with a
       * function name. Split off the trailing function name.
       */
      const fname = matchFunctionSuffix(part);

      if (fname) {
        const before = part.slice(0, part.length - fname.length);

        if (before) {
          result.push(regularRun(before));
        }

        result.push(functionNameRun(fname));
      } else {
        // No known function name — emit as a regular run.
        result.push(regularRun(part));
      }
    } else {
      // Final argument — regular run.
      result.push(regularRun(part));
    }
  }

  return result;
}

/*
 * ---------------------------------------------------------------------------
 * 4. Wrap paired standalone bracket runs in <m:d> delimiter elements
 * ---------------------------------------------------------------------------
 */

const OPEN_CLOSE: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '\u27e8': '\u27e9', // ⟨ ⟩
};
const CLOSE_TO_OPEN: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
  '\u27e9': '\u27e8',
};

/*
 * Vertical-bar delimiters: same character for open and close. We treat
 * them as toggles — the first | opens, the next | closes, etc.
 * All vertical-bar delimiter characters KaTeX/mathml2omml may emit.
 *   U+007C  |   VERTICAL LINE           — raw `|` from markdown
 *   U+2223  ∣   DIVIDES                  — KaTeX's `\lvert`/`\rvert`/`\begin{vmatrix}`
 *   U+2225  ∥   PARALLEL TO              — KaTeX's `\lVert`/`\rVert`/`\begin{Vmatrix}`/`\|`
 *   U+2016  ‖   DOUBLE VERTICAL LINE     — visual equivalent of U+2225
 */
const VERT_CHARS = new Set(['\u2223', '\u2225', '\u2016', '|']);

/**
 * Canonical-form tracker for vertical bars.
 *
 * Word's stretchy-delimiter character set only contains `|` (U+007C,
 * single bar) and `‖` (U+2016, double bar). It does NOT grow `∣`
 * (U+2223) or `∥` (U+2225) — so even with `<m:grow m:val="1"/>`, bars
 * using those chars stay small in the rendered DOCX.
 *
 * To get correct growth AND correct pairing, we normalise every bar
 * run to one of two canonical chars:
 *   - `|`  for single bars (`|`, `∣`, `∣∣∣`-odd, etc.)
 *   - `‖`  for double bars (`‖`, `∥`, `∣∣`, `∥∥`, `∣∣∣∣`-even, etc.)
 *
 * The "count >= 2" rule covers `||x||` (KaTeX emits `∣∣` as one run)
 * and `\|x\|` (KaTeX emits `∥` as one run) — both are "norm" delimiters
 * and should render as a tall `‖` in Word.
 */
function canonicalBarChar(ch: string): string | null {
  if (!ch) {
    return null;
  }

  /*
   * Keep only bar chars; if any non-bar char is present, this isn't a
   * pure bar run.
   */
  const bars = Array.from(ch).filter((c) => VERT_CHARS.has(c));

  if (bars.length === 0) {
    return null;
  }

  if (bars.length !== ch.length) {
    return null;
  }

  /*
   * Single bar (1 char) → `|`; double bar (≥2 chars, OR already a
   * double-bar char like ‖/∥) → `‖`.
   * Note: U+2225 (∥) and U+2016 (‖) are themselves "double bar" chars
   * even when they appear alone — KaTeX uses them for `\|` (norm).
   */
  if (ch.length === 1 && (ch === '|' || ch === '\u2223')) {
    return '|';
  }

  return '\u2016';
}

/**
 * Return the bracket character of a standalone bracket run, or null.
 *
 * A "standalone bracket run" is an `<m:r>` whose `<m:t>` text is exactly
 * a single bracket character (possibly with leading `<m:rPr>`), OR a
 * run of one or more vertical-bar characters (e.g. `∣∣` from `||x||`,
 * which KaTeX flattens into a single run).
 *
 * Runs like `f(x)` (where `(` is part of a larger text) are NOT
 * standalone — `splitMixedBarRuns` (run earlier in the pipeline) takes
 * care of splitting `∥x∥` into `∥` + `x` + `∥` so the bar chars become
 * standalone runs.
 */
function getStandaloneBracketChar(node: XNode): string | null {
  if (node.name !== 'm:r' || !node.elements) {
    return null;
  }

  const t = getRunText(node);

  if (!t) {
    return null;
  }

  // Single-char brackets: ( ) [ ] { } ⟨ ⟩ and single bars.
  if (t.length === 1) {
    if (t in OPEN_CLOSE || t in CLOSE_TO_OPEN) {
      return t;
    }

    if (VERT_CHARS.has(t)) {
      return t;
    }
  }

  /*
   * Multi-char run of all-bar chars (e.g. `∣∣` from `||x||`). Return
   * the canonical form so downstream pairing sees a single token.
   */
  const canonical = canonicalBarChar(t);

  if (canonical) {
    return canonical;
  }

  return null;
}

interface Pair {
  openIdx: number;
  closeIdx: number;
  openChar: string;
  closeChar: string;
}

function wrapPairedDelimiters(children: XNode[]): XNode[] {
  /*
   * Walk children, tracking open brackets on a stack. Vertical bars use
   * a per-canonical-char toggle stack — `|` and `‖` track independently
   * so `|a| · ‖b‖` pairs correctly, and `||a|| · ||b||` (each `||` is a
   * single `‖` run) toggles open/close correctly.
   */
  const stack: { char: string; index: number }[] = [];
  const vertToggles = new Map<string, { char: string; index: number }[]>();
  const pairs: Pair[] = [];

  for (let i = 0; i < children.length; i++) {
    const ch = getStandaloneBracketChar(children[i]);

    if (!ch) {
      continue;
    }

    if (ch in OPEN_CLOSE) {
      stack.push({ char: ch, index: i });
    } else if (ch in CLOSE_TO_OPEN) {
      const openChar = CLOSE_TO_OPEN[ch];

      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].char === openChar) {
          pairs.push({
            openIdx: stack[j].index,
            closeIdx: i,
            openChar,
            closeChar: ch,
          });
          stack.splice(j, 1);
          break;
        }
      }
    } else {
      // Vertical bar — canonical form is either `|` or `‖`.
      const canonical = canonicalBarChar(ch) || ch;
      let toggle = vertToggles.get(canonical);

      if (!toggle) {
        toggle = [];
        vertToggles.set(canonical, toggle);
      }

      if (toggle.length > 0) {
        const open = toggle.pop()!;
        pairs.push({
          openIdx: open.index,
          closeIdx: i,
          openChar: canonical,
          closeChar: canonical,
        });
      } else {
        toggle.push({ char: canonical, index: i });
      }
    }
  }

  /*
   * Greedily pick non-overlapping pairs, preferring outermost (longest
   * span) first so nested structures stay nested correctly.
   */
  pairs.sort((a, b) => b.closeIdx - b.openIdx - (a.closeIdx - a.openIdx));

  const used = new Set<number>();
  const valid: Pair[] = [];

  for (const p of pairs) {
    let overlap = false;

    for (let k = p.openIdx; k <= p.closeIdx; k++) {
      if (used.has(k)) {
        overlap = true;
        break;
      }
    }

    if (overlap) {
      continue;
    }

    for (let k = p.openIdx; k <= p.closeIdx; k++) {
      used.add(k);
    }
    valid.push(p);
  }

  // Rebuild the children array, wrapping each valid pair in an <m:d>.
  const pairByOpen = new Map(valid.map((p) => [p.openIdx, p]));
  const out: XNode[] = [];
  let i = 0;

  while (i < children.length) {
    const p = pairByOpen.get(i);

    if (p) {
      const inner = children.slice(p.openIdx + 1, p.closeIdx);
      out.push(
        el('m:d', {}, [
          el('m:dPr', {}, [
            el('m:begChr', { 'm:val': p.openChar }),
            el('m:endChr', { 'm:val': p.closeChar }),
            el('m:grow', { 'm:val': '1' }),
          ]),
          el('m:e', {}, inner),
        ]),
      );
      i = p.closeIdx + 1;
    } else {
      if (!used.has(i)) {
        out.push(children[i]);
      }

      i++;
    }
  }

  return out;
}

/*
 * ---------------------------------------------------------------------------
 * 5. Wrap `cases` matrices: `{` + `<m:m>` → growing delimiter
 * ---------------------------------------------------------------------------
 */

/**
 * KaTeX renders `\begin{cases}…\end{cases}` as `<mo fence="true">{</mo>`
 * followed by an `<mtable>` (which `mathml2omml` converts to `<m:m>`).
 * There is NO closing `}`. After our paired-delimiter pass, the `{`
 * remains a standalone run. Detect the pattern `{` + `<m:m>` and wrap
 * both in a growing delimiter with empty close character — Word then
 * renders a tall `{` hugging the matrix, the canonical piecewise look.
 */
function wrapCasesBrace(children: XNode[]): XNode[] {
  const out: XNode[] = [];

  for (let i = 0; i < children.length; i++) {
    const cur = children[i];
    const next = children[i + 1];
    const ch = getStandaloneBracketChar(cur);

    if (ch === '{' && next && next.name === 'm:m') {
      out.push(
        el('m:d', {}, [
          el('m:dPr', {}, [
            el('m:begChr', { 'm:val': '{' }),
            el('m:endChr', { 'm:val': '' }),
            el('m:grow', { 'm:val': '1' }),
          ]),
          el('m:e', {}, [next]),
        ]),
      );
      i++; // consume the matrix too
    } else {
      out.push(cur);
    }
  }

  return out;
}

/*
 * ---------------------------------------------------------------------------
 * 6. Split mixed bar runs — extract bar chars from larger text runs
 * ---------------------------------------------------------------------------
 */

/**
 * KaTeX sometimes flattens `\left\| x \right\|` into a single text run
 * `∥x∥` (bar + content + bar in one `<m:t>`). The bracket-detection
 * pass below only sees standalone bar runs, so without this split the
 * `∥` chars stay buried inside the larger run and never get wrapped in
 * `<m:d>` delimiters — meaning the bars render at fixed (small) size.
 *
 * This pass walks every `<m:r>` whose `<m:t>` text contains AT LEAST ONE
 * bar char AND at least one non-bar char, and splits it into a sequence
 * of runs: one run per contiguous bar segment, one run per contiguous
 * non-bar segment. Pure-bar runs (`∣`, `∣∣`, `∥`, etc.) and pure-text
 * runs (`x`, `abc`) pass through unchanged.
 */
function splitMixedBarRuns(children: XNode[]): XNode[] {
  const out: XNode[] = [];

  for (const child of children) {
    if (child.name === 'm:r' && child.elements) {
      const tElem = child.elements.find((c) => c.name === 'm:t');

      if (tElem && tElem.elements) {
        const text = tElem.elements
          .filter((e) => e.type === 'text')
          .map((e) => e.text || '')
          .join('');
        const hasBar = Array.from(text).some((c) => VERT_CHARS.has(c));
        const hasNonBar = Array.from(text).some((c) => !VERT_CHARS.has(c));

        if (hasBar && hasNonBar) {
          /*
           * Split into segments. Each contiguous run of bar chars or
           * non-bar chars becomes its own `<m:r>` (preserving rPr).
           */
          out.push(...splitRunByBars(child, tElem, text));
          continue;
        }
      }
    }

    out.push(child);
  }

  return out;
}

function splitRunByBars(run: XNode, tElem: XNode, text: string): XNode[] {
  const rPr = run.elements?.find((c) => c.name === 'm:rPr');
  const tAttrs = tElem.attributes || {};
  const result: XNode[] = [];

  /*
   * Walk the text, grouping consecutive chars by whether they're bar
   * chars. Emit one `<m:r>` per group.
   */
  let buf = '';
  let bufIsBar = false;
  const flush = () => {
    if (!buf) {
      return;
    }

    const children: XNode[] = [];

    if (rPr) {
      children.push(rPr);
    }

    children.push(el('m:t', tAttrs, [txt(buf)]));
    result.push(el('m:r', {}, children));
    buf = '';
  };

  for (const c of Array.from(text)) {
    const isBar = VERT_CHARS.has(c);

    if (buf && isBar !== bufIsBar) {
      flush();
    }

    buf += c;
    bufIsBar = isBar;
  }
  flush();

  return result;
}

/*
 * ---------------------------------------------------------------------------
 * 7. Normalise delimiter characters on existing <m:d> elements
 * ---------------------------------------------------------------------------
 */

/**
 * Walk all `<m:d>` elements in the subtree rooted at `node` and replace
 * bar characters in `<m:begChr>`/`<m:endChr>` `m:val` attributes with the
 * visually-equivalent characters that Word can actually grow.
 *
 *   `∣` (U+2223 DIVIDES)        → `|` (U+007C VERTICAL LINE)
 *   `∥` (U+2225 PARALLEL TO)    → `‖` (U+2016 DOUBLE VERTICAL LINE)
 *   `∣∣` (two U+2223)           → `‖` (U+2016)
 *   `∥∥` (two U+2225)           → `‖` (U+2016)
 *
 * This catches delimiters that KaTeX/mathml2omml produced directly (e.g.
 * for `\left| \frac{a}{b} \right|`, `\begin{vmatrix}…\end{vmatrix}`,
 * `\begin{Vmatrix}…\end{Vmatrix}`), which we DIDN'T create ourselves in
 * `wrapPairedDelimiters`. Without this normalisation, Word renders those
 * bars at fixed height even with `<m:grow m:val="1"/>` because its
 * stretchy-delimiter glyph set only contains `|` and `‖`.
 */
function normalizeDelimCharsInPlace(node: XNode): void {
  if (!node.elements) {
    return;
  }

  for (const child of node.elements) {
    if (child.type !== 'element') {
      continue;
    }

    if (child.name === 'm:begChr' || child.name === 'm:endChr') {
      const v = child.attributes?.['m:val'];

      if (v) {
        const norm = normalizeBarAttrValue(v);

        if (norm !== v) {
          if (!child.attributes) {
            child.attributes = {};
          }

          child.attributes['m:val'] = norm;
        }
      }
    } else {
      normalizeDelimCharsInPlace(child);
    }
  }
}

/**
 * Normalise a `m:val` attribute value (from `<m:begChr>`/`<m:endChr>`)
 * to the visually-equivalent character that Word can stretch. Non-bar
 * characters pass through unchanged.
 */
function normalizeBarAttrValue(v: string): string {
  if (!v) {
    return v;
  }

  const canonical = canonicalBarChar(v);

  /*
   * canonicalBarChar returns `|` for single bars, `‖` for double bars,
   * or null if `v` contains any non-bar char (e.g. `(`, `{`, empty).
   */
  return canonical ?? v;
}
