---
name: docx
description: Generate a downloadable Word (.docx) document directly in chat by wrapping full markdown content in a docxartifact tag — supports headings, lists, tables, code, KaTeX math (native Word equations), mermaid diagrams, Chart.js charts, and inline theme={{...}} styling (React Native style objects).
priority: 90
tags:
  - document
  - docx
  - word
  - export
  - math
  - equations
  - report
---

# DOCX Document Skill

## When to use

Use this skill whenever the user asks for a **document**, **report**, **paper**, **letter**, **.docx**, **Word file**, or any written deliverable they would expect to open in Microsoft Word / Google Docs. This is far cheaper (≈70% token savings) than creating a workspace project, writing a docx-generation script, and running it — the document renders instantly in a dedicated preview panel and downloads as a real `.docx`.

Do NOT use this skill for: code projects, web apps, or anything that needs to run as software (use the normal app-builder flow for those).

## How to respond

Wrap the **entire** document body in a single `<docxartifact>` tag. The content inside the tag is standard Markdown (GFM + KaTeX math). The system strips the tag from the chat and renders the inner markdown as a real Word document in the Document panel — the user never sees raw markdown.

You can optionally add a `theme={{...}}` attribute to the opening tag to customise the document's colours, fonts, sizes, margins, and page size. The theme object uses React Native–style syntax (camelCase keys, unquoted keys, string/number values) — every field is optional and additive (omitted fields keep their default).

```
<docxartifact>
# Document Title

Your full markdown document goes here...
</docxartifact>
```

With a theme:

```
<docxartifact theme={{ heading1: "#0B4F6C", link: "#1B6CA8", fontFamily: "Georgia", bodyFontSize: 12 }}>
# Document Title

Your full markdown document goes here...
</docxartifact>
```

### Critical rules

1. **The `<docxartifact>` block must be the LAST thing in your response.** Do NOT write any prose after the closing `</docxartifact>` tag. Any text you write before the tag is your normal chat answer (a brief intro is fine); everything after the tag is ignored. This prevents the document preview from re-rendering on every streaming chunk.

2. **Put ALL document content inside the tag.** Do not split across multiple tags. One `<docxartifact>` per document.

3. **Do NOT wrap the tag in a code fence.** Write `<docxartifact>` directly in your message, not inside triple backticks.

4. **Keep a short lead-in before the tag** (one or two sentences) so the user knows a document is coming — e.g. "Here's the report as a Word document you can download:" — then the tag.

## Supported markdown features

The pipeline fully supports (these are the features most AI docx tools miss):

| Feature            | Syntax                  | Notes                                     |
| ------------------ | ----------------------- | ----------------------------------------- |
| Headings           | `#` … `######`          | Maps to Word Heading 1–6 styles           |
| Paragraphs         | blank line separated    |                                           |
| Bold / Italic      | `**bold**` / `*italic*` |                                           |
| Strikethrough      | `~~text~~`              | GFM                                       |
| Inline code        | `` `code` ``            | Monospace, shaded                         |
| Code blocks        | ` ```lang `             | Syntax-highlighted (lowlight)             |
| Blockquotes        | `> quote`               | Left border, indented                     |
| Bullet lists       | `- ` / `* `             | Nested with indentation                   |
| Numbered lists     | `1. `                   | Nested: `a.`, then `i.`                   |
| Task lists         | `- [ ]` / `- [x]`       | GFM                                       |
| Tables             | GFM pipe tables         | Real Word tables with borders             |
| Horizontal rule    | `---`                   |                                           |
| Links              | `[text](url)`           | Blue, underlined                          |
| Images             | `![alt](url)`           | Embedded (URL must be publicly reachable) |
| Headings w/ anchor | normal                  |                                           |

### Math (the killer feature — native Word equations)

Math is converted to **native OMML equations** (the same format Word's equation editor produces), NOT images. This means they're editable, scalable, and print perfectly.

- **Inline math:** `$E = mc^2$` → renders inline with text.
- **Block math:** `$$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$` → centered display equation.

Use standard LaTeX/KaTeX syntax. Supports fractions, integrals, summations, matrices, piecewise (`\begin{cases}`), Greek letters, sub/superscripts, root (`\sqrt`), etc.

### Diagrams

- **Mermaid** (structural diagrams — flowcharts, sequence, class, ER, state, gantt): use a ` ```mermaid ` fenced block. Rendered to a cropped PNG and embedded in the doc.
- **Chart.js** (quantitative charts — bar, line, pie, doughnut, scatter, radar): use a ` ```chartjs ` fenced block containing a JSON Chart.js config. Rendered to PNG and embedded.

Place diagrams where they should appear in the document flow. They render at a professional size (mermaid ~3.25in wide, charts ~6in wide).

### Page layout

The document uses professional defaults: Arial 11pt body, 1" margins, 1.15 line spacing, Letter page size. No configuration needed — but you CAN override any of these with the `theme={{...}}` attribute (see below).

## Document theming (`theme={{...}}`)

Add a `theme={{...}}` attribute to the opening `<docxartifact>` tag to give the document its own look. The syntax is a **React Native–style inline object** — camelCase keys, unquoted keys, single- or double-quoted string values, bare numbers. Every field is **optional**: omitted fields fall back to the professional default (Arial 11pt, black ink, 1" margins, Letter size).

### Colour fields

| Field                   | What it controls                      | Example     |
| ----------------------- | ------------------------------------- | ----------- |
| `body`                  | Body paragraph text colour            | `"#333333"` |
| `heading1` … `heading6` | H1–H6 text colours (independent)      | `"#0B4F6C"` |
| `link`                  | Hyperlink text colour                 | `"#1B6CA8"` |
| `inlineCodeColor`       | Inline `` `code` `` text colour       | `"#1F1F1F"` |
| `inlineCodeBg`          | Inline `` `code` `` background fill   | `"#F2F2F2"` |
| `codeBlockColor`        | Fenced code-block text colour         | `"#1F1F1F"` |
| `codeBlockBg`           | Fenced code-block background fill     | `"#F5F5F5"` |
| `codeBlockBorder`       | Fenced code-block border colour       | `"#E0E0E0"` |
| `tableBorder`           | Table cell border colour              | `"#BFBFBF"` |
| `tableHeaderBg`         | Table header-row background fill      | `"#F0F0F0"` |
| `blockquoteBorder`      | Blockquote left-bar border colour     | `"#CCCCCC"` |
| `thematicBreak`         | Horizontal-rule (`---`) border colour | `"#BFBFBF"` |

Colours accept `#rgb`, `#rrggbb`, `rrggbb` (no `#`), or `rgb(r,g,b)`. Invalid values are silently dropped (the default for that field is kept) — a typo never breaks the export.

### Typography fields

| Field                           | What it controls                               | Default             | Example                                       |
| ------------------------------- | ---------------------------------------------- | ------------------- | --------------------------------------------- |
| `fontFamily`                    | Body + heading font family                     | `"Arial"`           | `"Georgia"`, `"Times New Roman"`, `"Calibri"` |
| `headingFontFamily`             | Heading font override (defaults to fontFamily) | `"Arial"`           | `"Georgia"`                                   |
| `codeFontFamily`                | Code/monospace font family                     | `"Consolas"`        | `"Courier New"`, `"Fira Code"`                |
| `bodyFontSize`                  | Body font size in **points**                   | `11`                | `12`                                          |
| `heading1Size` … `heading6Size` | H1–H6 font sizes in points (independent)       | `20,16,14,12,11,11` | `heading1Size: 22`                            |
| `margin`                        | Page margin in **inches**                      | `1`                 | `1.25`, `0.75`                                |
| `lineSpacing`                   | Line spacing multiplier                        | `1.15`              | `1.0` (single), `1.5`, `2.0` (double)         |
| `pageSize`                      | Page size preset                               | `"letter"`          | `"a4"`                                        |

Font sizes are clamped to [6, 72] pt. Margins are clamped to [0.25, 3] in. Line spacing is clamped to [0.5, 3].

### Quick-start theme recipes

**Academic / manuscript (serif, 12pt, 1.5 spacing):**

```
<docxartifact theme={{ fontFamily: "Georgia", bodyFontSize: 12, heading1Size: 22, heading2Size: 18, lineSpacing: 1.5, margin: 1.25 }}>
```

**Compact / dense (10pt, 0.75in margins, single spacing):**

```
<docxartifact theme={{ bodyFontSize: 10, heading1Size: 16, heading2Size: 13, lineSpacing: 1.0, margin: 0.75 }}>
```

**Ocean colour palette (deep teal headings):**

```
<docxartifact theme={{ heading1: "#0B4F6C", heading2: "#0B4F6C", heading3: "#145374", link: "#1B6CA8", blockquoteBorder: "#5A9BB8" }}>
```

**A4 page, European paper size:**

```
<docxartifact theme={{ pageSize: "a4", margin: 2.5 }}>
```

### Theming rules

1. **The theme is optional.** Omit it entirely for the default professional look (Arial 11pt, black ink, 1" Letter margins).
2. **Every field is additive.** Set only the fields you care about; the rest keep their defaults. Setting `heading1` does NOT change `heading2`.
3. **Use camelCase keys** (React Native style): `heading1Size`, not `heading1_size` or `heading-1-size`.
4. **String values need quotes** (single or double): `"Georgia"`, `'#0B4F6C'`. **Numeric values are bare**: `12`, `1.25`, `1.5`.
5. **Don't nest objects.** The inline theme is a flat key-value object. (`syntaxColors` — a nested object for code-highlight token colours — is NOT supported inline; it's only available to programmatic callers.)
6. **Choose a theme that fits the content.** A legal document wants serif + 12pt + 1.5 spacing; a tech spec wants sans-serif + 10pt + code-friendly colours; a marketing one-pager wants bold accent colours. Match the user's intent.

## Example

User: "Write me a quarterly business report with a revenue chart and the growth formula."

You:

````
Here's your Q3 business report as a Word document. It includes a revenue chart, the compound growth formula as a native equation, and a summary table. I've themed it with deep teal headings and a serif body for a polished look.

<docxartifact theme={{ fontFamily: "Georgia", headingFontFamily: "Georgia", heading1: "#0B4F6C", heading2: "#0B4F6C", heading3: "#145374", link: "#1B6CA8", bodyFontSize: 11, lineSpacing: 1.15 }}>
# Q3 2024 Business Report

## Executive Summary

Quarterly revenue grew **23%** year-over-year, driven by enterprise expansion.

## Revenue by Quarter

```chartjs
{
  "type": "bar",
  "data": {
    "labels": ["Q1", "Q2", "Q3", "Q4"],
    "datasets": [{ "label": "Revenue ($M)", "data": [12, 15, 18, 22] }]
  },
  "options": { "responsive": true }
}
````

## Growth Model

Revenue follows compound growth:

$$R(t) = R_0 \left(1 + r\right)^t = 12 \times (1.15)^t$$

where $R_0 = 12$ (Q1 baseline) and $r = 0.15$ (quarterly growth rate).

## Summary Table

| Quarter | Revenue ($M) | Growth |
| ------- | ------------ | ------ |
| Q1      | 12           | —      |
| Q2      | 15           | +25%   |
| Q3      | 18           | +20%   |
| Q4      | 22           | +22%   |

## Outlook

- Enterprise pipeline at **$8M** ARR
- Net retention at **118%**
- Expanding into EMEA in Q1 2025
  </docxartifact>

```

## Token efficiency

This approach saves ~70% vs. the old workspace method:
- **Old way:** AI writes a JS script using the `docx` library (1000s of tokens of boilerplate), the workspace installs deps, compiles, and the user downloads. Multiple round-trips.
- **New way:** AI emits the document as markdown (the natural format), one pass, no code, no install, no compile. The server builds the `.docx` from the markdown directly.

Always prefer this skill over generating docx-building code.
```
