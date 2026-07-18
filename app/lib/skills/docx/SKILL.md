---
name: docx
description: Generate a downloadable Word (.docx) document directly in chat by wrapping full markdown content in a docxartifact tag — supports headings, lists, tables, code, KaTeX math (native Word equations), mermaid diagrams, and Chart.js charts.
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

```
<docxartifact>
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

| Feature | Syntax | Notes |
|---|---|---|
| Headings | `#` … `######` | Maps to Word Heading 1–6 styles |
| Paragraphs | blank line separated | |
| Bold / Italic | `**bold**` / `*italic*` | |
| Strikethrough | `~~text~~` | GFM |
| Inline code | `` `code` `` | Monospace, shaded |
| Code blocks | ` ```lang ` | Syntax-highlighted (lowlight) |
| Blockquotes | `> quote` | Left border, indented |
| Bullet lists | `- ` / `* ` | Nested with indentation |
| Numbered lists | `1. ` | Nested: `a.`, then `i.` |
| Task lists | `- [ ]` / `- [x]` | GFM |
| Tables | GFM pipe tables | Real Word tables with borders |
| Horizontal rule | `---` | |
| Links | `[text](url)` | Blue, underlined |
| Images | `![alt](url)` | Embedded (URL must be publicly reachable) |
| Headings w/ anchor | normal | |

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

The document uses professional defaults: Arial 11pt body, 1" margins, 1.15 line spacing, Letter page size. No configuration needed.

## Example

User: "Write me a quarterly business report with a revenue chart and the growth formula."

You:
```
Here's your Q3 business report as a Word document. It includes a revenue chart, the compound growth formula as a native equation, and a summary table.

<docxartifact>
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
```

## Growth Model

Revenue follows compound growth:

$$R(t) = R_0 \left(1 + r\right)^t = 12 \times (1.15)^t$$

where $R_0 = 12$ (Q1 baseline) and $r = 0.15$ (quarterly growth rate).

## Summary Table

| Quarter | Revenue ($M) | Growth |
|---------|-------------|--------|
| Q1      | 12          | —      |
| Q2      | 15          | +25%   |
| Q3      | 18          | +20%   |
| Q4      | 22          | +22%   |

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
