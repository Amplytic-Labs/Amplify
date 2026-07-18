// Shared types for the markdown → docx pipeline

import type { DocxTheme } from "./theme";

export interface DiagramAsset {
  /** unique id matching the code-block/lang position in markdown */
  id: string;
  type: "mermaid" | "chart" | "math-block" | "math-inline";
  /** svg string (for mermaid/chart/math) — server converts to cropped png */
  svg?: string;
  /** pre-rendered png data url (for chart.js canvas) */
  pngDataUrl?: string;
  /** latex source (for math) — server can re-render via mathjax if no svg */
  latex?: string;
  /** optional caption */
  caption?: string;
}

/** User-configurable document export settings. */
export interface ExportSettings {
  /** Body font family, e.g. "Arial", "Times New Roman", "Calibri". */
  font: string;
  /** Body font size in points (10–14 typical). */
  fontSize: number;
  /** Page margin in inches (0.5–2 typical). */
  margin: number;
  /** Page size preset. */
  pageSize: "letter" | "a4";
  /** Line spacing multiplier (1.0 single, 1.15 default, 1.5, 2.0 double). */
  lineSpacing: number;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  font: "Arial",
  fontSize: 11,
  margin: 1,
  pageSize: "letter",
  lineSpacing: 1.15,
};

export interface ExportRequest {
  markdown: string;
  format: "docx";
  assets: DiagramAsset[];
  settings?: ExportSettings;
  /**
   * Optional colour theme for the generated DOCX. Every field is optional;
   * omitted fields fall back to the default (the exact colours the formatter
   * has always used). Passing no theme produces byte-identical output to the
   * pre-theme implementation, so this is a purely additive overlay an AI
   * chatbot (or any caller) can use to give each document its own look.
   */
  theme?: DocxTheme;
}

/** Response from /api/preview-docx — HTML that mirrors the real DOCX output. */
export interface PreviewDocxResponse {
  html: string;
  warnings: string[];
  meta: {
    paragraphs: number;
    tables: number;
    images: number;
    equations: number;
    bytes: number;
  };
}
