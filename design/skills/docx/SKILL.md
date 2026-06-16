---
name: docx-generation
description: >
  Use this skill whenever the user asks to create, generate, or export a Word document (.docx file).
  Triggers include: "create a report", "make a Word doc", "export as docx", "generate a document",
  "write a letter", "create a resume", "make an invoice", "generate a contract", any request
  for a professionally formatted document as a .docx file.
  Always read this skill before writing any docx generation script.
  Do NOT use for PDFs, spreadsheets, HTML pages, or markdown files.
---

# DOCX Generation Skill

> For WebContainer / bolt.diy environments using the `docx` npm package

---

## Environment Rules

- Runtime: Node.js inside WebContainer (browser WASM — no native binaries)
- Always use `docx` npm package — never officegen, docxtemplater, or python-docx
- Always write scripts as `.mjs` (ESM) or use `require()` with `.cjs`
- Always write output to `output.docx` in the working directory
- `fs` from Node is available — WebContainer polyfills it

### WebContainer JavaScript Parser Constraints

CRITICAL: The WebContainer runtime uses a custom JavaScript parser that does NOT support all modern syntax. You MUST avoid the following patterns in `.js` and `.mjs` files:

**FORBIDDEN — Spread operator inside array literals:**

```javascript
// BAD — will cause SyntaxError
const arr = [item1, ...array.map(fn)];
const rows = [header, ...data.map(toRow)];

// GOOD — extract to variable first
const mapped = array.map(fn);
const arr = [item1, ...mapped];
const dataRows = data.map(toRow);
const rows = [header, ...dataRows];
```

**FORBIDDEN — Complex chained expressions on array/object literals:**

```javascript
// BAD
const result = [{ a: 1 }, { a: 2 }].map(fn).filter(g);

// GOOD
const items = [{ a: 1 }, { a: 2 }];
const result = items.map(fn).filter(g);
```

**GENERAL RULE:** Keep expressions simple. If an expression combines spread, map, filter, or reduce on an inline array literal, break it into separate variable assignments first.

---

## Setup

```javascript
// install once
// npm install docx

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  VerticalAlign,
  LevelFormat,
  ExternalHyperlink,
  InternalHyperlink,
  Bookmark,
  FootnoteReferenceRun,
  ImageRun,
  PageBreak,
  PageNumber,
  TabStopType,
  TabStopPosition,
  PositionalTab,
  PositionalTabAlignment,
  PositionalTabRelativeTo,
  PositionalTabLeader,
  TableOfContents,
  Column,
  SectionType,
  PageOrientation,
  convertInchesToTwip,
} from 'docx';
import { writeFileSync, readFileSync } from 'fs';

const doc = new Document({ sections: [{ children: [] }] });
const buffer = await Packer.toBuffer(doc);
writeFileSync('output.docx', buffer);
console.log('✓ output.docx written', buffer.byteLength, 'bytes');
```

---

## Page Setup

```javascript
// ALWAYS set page size explicitly — docx defaults to A4
// 1 inch = 1440 DXA units

sections: [{
  properties: {
    page: {
      size: {
        width: 12240,   // 8.5 inches — US Letter
        height: 15840,  // 11 inches — US Letter
      },
      margin: {
        top: 1440,      // 1 inch
        right: 1440,
        bottom: 1440,
        left: 1440,
      },
    },
  },
  children: [ /* content */ ],
}]

// Landscape — pass portrait dimensions, docx flips them internally
size: {
  width: 12240,
  height: 15840,
  orientation: PageOrientation.LANDSCAPE,
}

// Common sizes (DXA)
// US Letter:  12240 × 15840
// A4:         11906 × 16838
// Legal:      12240 × 20160
// Content width (US Letter, 1" margins): 12240 - 1440 - 1440 = 9360
```

---

## Text & Paragraphs

```javascript
// Plain paragraph
new Paragraph({
  children: [new TextRun('Hello world')],
});

// Mixed formatting in one paragraph
new Paragraph({
  children: [
    new TextRun('Normal, '),
    new TextRun({ text: 'bold, ', bold: true }),
    new TextRun({ text: 'italic, ', italics: true }),
    new TextRun({ text: 'bold italic, ', bold: true, italics: true }),
    new TextRun({ text: 'underlined, ', underline: {} }),
    new TextRun({ text: 'strikethrough, ', strike: true }),
    new TextRun({ text: 'red text', color: 'FF0000' }),
  ],
});

// Font, size, highlight
new TextRun({
  text: 'Custom style',
  font: 'Arial',
  size: 28, // half-points: 28 = 14pt
  highlight: 'yellow', // yellow, green, cyan, magenta, blue, red, darkBlue, darkCyan, darkGreen, darkMagenta, darkRed, darkYellow, darkGray, lightGray, black
  color: '1F497D', // hex without #
});

// Paragraph alignment
new Paragraph({
  alignment: AlignmentType.CENTER, // LEFT, CENTER, RIGHT, JUSTIFIED, DISTRIBUTE
  children: [new TextRun('Centered')],
});

// Paragraph spacing
new Paragraph({
  spacing: {
    before: 240, // 240 twips = 1 line above
    after: 240,
    line: 480, // double spacing (240 = single)
  },
  children: [new TextRun('Spaced paragraph')],
});

// Indentation
new Paragraph({
  indent: {
    left: 720, // 0.5 inch indent
    hanging: 360, // hanging indent for lists
    firstLine: 720, // first line indent (don't use with hanging)
  },
  children: [new TextRun('Indented')],
});

// CRITICAL: Never use \n inside TextRun — use separate Paragraphs instead
// WRONG:  new TextRun("Line 1\nLine 2")
// RIGHT:  [new Paragraph({children:[new TextRun("Line 1")]}), new Paragraph({children:[new TextRun("Line 2")]})]
```

---

## Headings

```javascript
// Basic headings
new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('H1 Title')] });
new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('H2 Subtitle')] });
new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun('H3 Section')] });
// Available: HEADING_1 through HEADING_6, TITLE

// Custom heading styles (override built-in)
// CRITICAL: Use exact IDs "Heading1", "Heading2" to override defaults
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 24 } }, // 12pt body default
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: '2E4057' },
        paragraph: {
          spacing: { before: 480, after: 240 },
          outlineLevel: 0, // REQUIRED for Table of Contents
        },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: '048A81' },
        paragraph: {
          spacing: { before: 360, after: 120 },
          outlineLevel: 1, // REQUIRED for Table of Contents
        },
      },
    ],
  },
  sections: [{ children: [] }],
});
```

---

## Lists

```javascript
// CRITICAL: Never use unicode bullet characters (•, -, *)
// Always use the numbering config system

const doc = new Document({
  numbering: {
    config: [
      // Bullet list
      {
        reference: 'my-bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720, hanging: 360 } },
              run: { font: 'Symbol' },
            },
          },
          {
            level: 1,
            format: LevelFormat.BULLET,
            text: '◦',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 1440, hanging: 360 } },
            },
          },
        ],
      },
      // Numbered list
      {
        reference: 'my-numbers',
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720, hanging: 360 } },
            },
          },
          {
            level: 1,
            format: LevelFormat.LOWER_LETTER,
            text: '%2.',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 1440, hanging: 360 } },
            },
          },
        ],
      },
    ],
  },
  sections: [
    {
      children: [
        // Bullet items
        new Paragraph({
          numbering: { reference: 'my-bullets', level: 0 },
          children: [new TextRun('First bullet')],
        }),
        new Paragraph({
          numbering: { reference: 'my-bullets', level: 1 },
          children: [new TextRun('Nested bullet')],
        }),

        // Numbered items (same reference = continues count)
        new Paragraph({
          numbering: { reference: 'my-numbers', level: 0 },
          children: [new TextRun('Item one')],
        }),
        new Paragraph({
          numbering: { reference: 'my-numbers', level: 0 },
          children: [new TextRun('Item two')],
        }),
      ],
    },
  ],
});

// NOTE: Same reference = numbering continues (1, 2, 3)
// Different reference = numbering restarts (1, 2, 3 then 1, 2, 3)
// To restart numbering mid-document, use a new reference name
```

---

## Tables

```javascript
// CRITICAL rules:
// 1. Always use WidthType.DXA — never WidthType.PERCENTAGE (breaks in Google Docs)
// 2. Set BOTH table-level columnWidths AND cell-level width
// 3. columnWidths must sum exactly to table width
// 4. Use ShadingType.CLEAR — never ShadingType.SOLID (causes black backgrounds)
// 5. Always add cell margins for readable padding
// 6. Never use tables as horizontal rules — use paragraph borders instead

const CONTENT_WIDTH = 9360; // US Letter with 1" margins
const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const allBorders = { top: border, bottom: border, left: border, right: border };
const noBorders = {
  top: { style: BorderStyle.NONE },
  bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE },
  right: { style: BorderStyle.NONE },
};

// Basic 2-column table
new Table({
  width: { size: CONTENT_WIDTH, type: WidthType.DXA },
  columnWidths: [4680, 4680], // must sum to 9360
  rows: [
    // Header row
    new TableRow({
      tableHeader: true, // repeats on page overflow
      children: [
        new TableCell({
          borders: allBorders,
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: '2E4057', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'Column A', bold: true, color: 'FFFFFF' })],
            }),
          ],
        }),
        new TableCell({
          borders: allBorders,
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: '2E4057', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'Column B', bold: true, color: 'FFFFFF' })],
            }),
          ],
        }),
      ],
    }),
    // Data row
    new TableRow({
      children: [
        new TableCell({
          borders: allBorders,
          width: { size: 4680, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun('Value A')] })],
        }),
        new TableCell({
          borders: allBorders,
          width: { size: 4680, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun('Value B')] })],
        }),
      ],
    }),
  ],
});

// Merged cells (column span)
new TableCell({
  columnSpan: 2, // spans 2 columns
  borders: allBorders,
  width: { size: 9360, type: WidthType.DXA },
  children: [new Paragraph({ children: [new TextRun('Merged')] })],
});

// Merged cells (row span)
// First cell: verticalMerge: "restart"
// Subsequent cells: verticalMerge: "continue" with empty children
new TableCell({
  rowSpan: 1,
  verticalMerge: 'restart',
  children: [new Paragraph({ children: [new TextRun('Merged across rows')] })],
});
new TableCell({
  verticalMerge: 'continue',
  children: [new Paragraph({ children: [] })],
});

// Borderless table (for layout, not data)
new Table({
  width: { size: CONTENT_WIDTH, type: WidthType.DXA },
  columnWidths: [4680, 4680],
  borders: {
    top: { style: BorderStyle.NONE },
    bottom: { style: BorderStyle.NONE },
    left: { style: BorderStyle.NONE },
    right: { style: BorderStyle.NONE },
    insideH: { style: BorderStyle.NONE },
    insideV: { style: BorderStyle.NONE },
  },
  rows: [
    /* ... */
  ],
});
```

---

## Images

```javascript
// CRITICAL: type is required. All three altText fields are required.
new Paragraph({
  children: [
    new ImageRun({
      type: 'png', // png, jpg, jpeg, gif, bmp, svg
      data: readFileSync('./image.png'), // Buffer or Uint8Array
      transformation: {
        width: 400, // pixels
        height: 300,
      },
      altText: {
        title: 'Image title',
        description: 'Longer description',
        name: 'image-name',
      },
      floating: {
        // optional: float image with text wrap
        horizontalPosition: { offset: 1014400 },
        verticalPosition: { offset: 1014400 },
        wrap: { type: TextWrappingType.SQUARE, side: TextWrappingSide.BOTH_SIDES },
        allowOverlap: false,
      },
    }),
  ],
});

// Centered image
new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [
    new ImageRun({
      type: 'png',
      data: readFileSync('./logo.png'),
      transformation: { width: 200, height: 80 },
      altText: { title: 'Logo', description: 'Company logo', name: 'logo' },
    }),
  ],
});
```

---

## Headers & Footers

```javascript
sections: [
  {
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: 'Company Name', bold: true }),
              new TextRun('\t'),
              new TextRun({ text: 'Confidential', color: 'FF0000' }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 },
            },
          }),
        ],
      }),
      first: new Header({
        // different header for page 1
        children: [new Paragraph({ children: [new TextRun('')] })],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            children: [
              new TextRun('Report Title\t'),
              new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            border: {
              top: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 },
            },
          }),
        ],
      }),
    },
    properties: {
      titlePage: true, // required to use the 'first' header/footer
    },
    children: [
      /* content */
    ],
  },
];
```

---

## Page Breaks & Section Breaks

```javascript
// Page break — MUST be inside a Paragraph
new Paragraph({ children: [new PageBreak()] });

// Or via property
new Paragraph({
  pageBreakBefore: true,
  children: [new TextRun('This starts on a new page')],
});

// Section break (new page with different layout)
// Split content into multiple sections[]
sections: [
  {
    properties: { page: { size: { width: 12240, height: 15840 } } },
    children: [
      /* portrait content */
    ],
  },
  {
    properties: {
      page: { size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE } },
      type: SectionType.NEXT_PAGE,
    },
    children: [
      /* landscape content */
    ],
  },
];
```

---

## Hyperlinks

```javascript
// External link
new Paragraph({
  children: [
    new TextRun('Visit '),
    new ExternalHyperlink({
      link: 'https://example.com',
      children: [new TextRun({ text: 'example.com', style: 'Hyperlink' })],
    }),
    new TextRun(' for more info.'),
  ],
});

// Internal link — bookmark + reference
// Step 1: create the bookmark destination
new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [
    new Bookmark({
      id: 'section-one',
      children: [new TextRun('Section One')],
    }),
  ],
});

// Step 2: link to it
new Paragraph({
  children: [
    new InternalHyperlink({
      anchor: 'section-one',
      children: [new TextRun({ text: 'Go to Section One', style: 'Hyperlink' })],
    }),
  ],
});
```

---

## Table of Contents

```javascript
// CRITICAL: Headings must use HeadingLevel enum only — no custom paragraph styles
// TOC is auto-generated by Word when the file is opened/updated

new TableOfContents('Table of Contents', {
  hyperlink: true, // make entries clickable
  headingStyleRange: '1-3', // include H1, H2, H3
});

// Then headings must be like this (no extra styles):
new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Chapter 1')] });
new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Section 1.1')] });
```

---

## Footnotes

```javascript
const doc = new Document({
  footnotes: {
    1: { children: [new Paragraph({ children: [new TextRun('First footnote text.')] })] },
    2: { children: [new Paragraph({ children: [new TextRun('Second footnote text.')] })] },
  },
  sections: [
    {
      children: [
        new Paragraph({
          children: [
            new TextRun('Main body text with reference'),
            new FootnoteReferenceRun(1),
            new TextRun(' and another reference'),
            new FootnoteReferenceRun(2),
            new TextRun('.'),
          ],
        }),
      ],
    },
  ],
});
```

---

## Tab Stops

```javascript
// Right-align content on same line (e.g., name + date)
new Paragraph({
  children: [new TextRun('Document Title'), new TextRun('\tJanuary 2025')],
  tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
});

// Multiple tab stops
new Paragraph({
  children: [new TextRun('Item\t$100.00\tApproved')],
  tabStops: [
    { type: TabStopType.RIGHT, position: 5040 }, // 3.5 inches
    { type: TabStopType.RIGHT, position: 9360 }, // right margin
  ],
});

// Dot leader (TOC style)
new Paragraph({
  children: [
    new TextRun('Introduction'),
    new TextRun({
      children: [
        new PositionalTab({
          alignment: PositionalTabAlignment.RIGHT,
          relativeTo: PositionalTabRelativeTo.MARGIN,
          leader: PositionalTabLeader.DOT,
        }),
        '3',
      ],
    }),
  ],
});
```

---

## Horizontal Rules

```javascript
// Use paragraph border — NOT a table (tables have min-height, leave blank space)
new Paragraph({
  border: {
    bottom: {
      style: BorderStyle.SINGLE,
      size: 6,
      color: 'CCCCCC',
      space: 1,
    },
  },
  children: [],
});

// Thick colored rule (section divider)
new Paragraph({
  border: {
    bottom: { style: BorderStyle.SINGLE, size: 20, color: '2E4057', space: 4 },
  },
  spacing: { before: 240, after: 240 },
  children: [],
});
```

---

## Multi-Column Layout

```javascript
// Equal columns
sections: [
  {
    properties: {
      column: {
        count: 2,
        space: 720, // gap in DXA (720 = 0.5 inch)
        equalWidth: true,
        separate: true, // draw line between columns
      },
    },
    children: [
      /* flows across columns naturally */
    ],
  },
];

// Custom width columns
sections: [
  {
    properties: {
      column: {
        equalWidth: false,
        children: [
          new Column({ width: 5760, space: 720 }), // 4 inches
          new Column({ width: 2880 }), // 2 inches
        ],
      },
    },
    children: [
      /* content */
    ],
  },
];
```

---

## Math

```javascript
import {
  Math,
  MathRun,
  MathFraction,
  MathNumerator,
  MathDenominator,
  MathRadical,
  MathSuperScript,
  MathSubScript,
} from 'docx';

new Paragraph({
  children: [
    new Math({
      children: [
        new MathFraction({
          numerator: new MathNumerator({ children: [new MathRun('-b')] }),
          denominator: new MathDenominator({ children: [new MathRun('2a')] }),
        }),
      ],
    }),
  ],
});
```

---

## Complete Document Example

```javascript
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  VerticalAlign,
  LevelFormat,
  ExternalHyperlink,
  PageBreak,
  PageNumber,
  TabStopType,
  TabStopPosition,
  TableOfContents,
} from 'docx';
import { writeFileSync } from 'fs';

const CONTENT_WIDTH = 9360;
const border = { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' };
const borders = { top: border, bottom: border, left: border, right: border };

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 24 } } },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 40, bold: true, font: 'Arial', color: '1A1A2E' },
        paragraph: { spacing: { before: 480, after: 240 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: '16213E' },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
        titlePage: true,
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Acme Corp Report', bold: true }), new TextRun('\tConfidential')],
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun('Annual Report 2024\t'),
                new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] }),
              ],
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
            }),
          ],
        }),
      },
      children: [
        // Title
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          children: [new TextRun('Annual Report 2024')],
        }),

        // Subtitle
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 480 },
          children: [new TextRun({ text: 'Prepared by Finance Team', color: '666666', size: 22 })],
        }),

        // Table of contents
        new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
        new Paragraph({ children: [new PageBreak()] }),

        // Section heading
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Executive Summary')] }),

        // Body paragraph
        new Paragraph({
          spacing: { after: 240 },
          children: [
            new TextRun('Revenue grew '),
            new TextRun({ text: '42%', bold: true }),
            new TextRun(' year-over-year, driven by expansion into three new markets.'),
          ],
        }),

        // Bullet list
        new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [new TextRun('Launched in Southeast Asia')],
        }),
        new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [new TextRun('Acquired DataCorp for $12M')],
        }),
        new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [new TextRun('Headcount grew from 45 to 112')],
        }),

        // Section divider
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '1A1A2E', space: 4 } },
          spacing: { before: 360, after: 360 },
          children: [],
        }),

        // Table
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Revenue Breakdown')] }),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [4680, 2340, 2340],
          rows: [
            new TableRow({
              tableHeader: true,
              children: ['Region', '2023', '2024'].map(
                (text, i) =>
                  new TableCell({
                    borders,
                    width: { size: [4680, 2340, 2340][i], type: WidthType.DXA },
                    shading: { fill: '1A1A2E', type: ShadingType.CLEAR },
                    margins: { top: 80, bottom: 80, left: 120, right: 120 },
                    verticalAlign: VerticalAlign.CENTER,
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text, bold: true, color: 'FFFFFF' })],
                      }),
                    ],
                  }),
              ),
            }),
            ...[
              ['North America', '$4.2M', '$5.8M'],
              ['Asia Pacific', '$1.1M', '$2.4M'],
              ['Europe', '$0.8M', '$1.2M'],
            ].map(
              (row, ri) =>
                new TableRow({
                  children: row.map(
                    (text, ci) =>
                      new TableCell({
                        borders,
                        width: { size: [4680, 2340, 2340][ci], type: WidthType.DXA },
                        shading: { fill: ri % 2 === 0 ? 'F8F9FA' : 'FFFFFF', type: ShadingType.CLEAR },
                        margins: { top: 80, bottom: 80, left: 120, right: 120 },
                        children: [
                          new Paragraph({
                            alignment: ci === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT,
                            children: [new TextRun(text)],
                          }),
                        ],
                      }),
                  ),
                }),
            ),
          ],
        }),
      ],
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync('output.docx', buffer);
console.log('✓ output.docx written —', buffer.byteLength, 'bytes');
```

---

## Critical Rules (memorize these)

| Rule              | Wrong                    | Right                                            |
| ----------------- | ------------------------ | ------------------------------------------------ |
| Line breaks       | `new TextRun("a\nb")`    | Two separate `Paragraph` elements                |
| Bullets           | `new TextRun("• Item")`  | `numbering: { reference, level }`                |
| Table width       | `WidthType.PERCENTAGE`   | `WidthType.DXA` always                           |
| Table shading     | `ShadingType.SOLID`      | `ShadingType.CLEAR`                              |
| Horizontal rule   | empty `Table` row        | `Paragraph` with `border.bottom`                 |
| Page break        | standalone `PageBreak()` | `new Paragraph({ children: [new PageBreak()] })` |
| Image type        | omit `type` field        | `type: "png"` always required                    |
| TOC headings      | custom paragraph styles  | `HeadingLevel.HEADING_1` only                    |
| Style IDs         | `"heading-1"`            | `"Heading1"` (exact match)                       |
| Dual table widths | only table-level         | both `columnWidths[]` AND each cell `width`      |

## Common Error fix:

For any `children` array containing `TextRun` calls, ensure that each `new TextRun(` has a matching closing `)` on the same line or before the next element. Never write a line like `new TextRun("text",` without immediately closing it with `)` before the comma. Validate parentheses balance before outputting code.
don't do this (wrong):\*\*

```js
children: [
  new TextRun("text ",   // ← missing closing )
  new TextRun("more")
]
```

**Always do this (right):**

```js
children: [
  new TextRun('text '), // ← closed immediately
  new TextRun('more'),
];
```
