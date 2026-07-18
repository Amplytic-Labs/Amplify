import sharp from "sharp";

/**
 * Image asset processing for the markdown → docx/pdf pipeline.
 *
 * Diagrams (mermaid / chart.js) arrive as SVG or PNG data URLs from the
 * client. We crop surrounding whitespace and cap to a professional max
 * size so a single diagram never overflows the page or eats a whole page.
 */

// Professional max image size — fits within a Letter page with 1" margins.
// 6.5in text width @ 96dpi = 624px. We allow up to 900px of source resolution
// (downscaled to ~6in on the page by the docx/pdf builder).
const MAX_SOURCE_W = 900;
const MAX_SOURCE_H = 1050; // ~7.5in @ 140dpi — prevents full-page-tall images

/**
 * Convert an SVG string into a cropped PNG buffer.
 * - Renders at high density (288dpi) for crisp text and lines.
 * - Trims surrounding whitespace.
 * - Adds small white padding so the diagram isn't flush against text.
 * - Caps source dimensions so giant diagrams are downscaled.
 */
export async function svgToCroppedPng(
  svg: string,
  opts: { scale?: number; pad?: number } = {}
): Promise<Buffer> {
  const pad = opts.pad ?? 20;

  // Render SVG → PNG at high density for crisp output.
  const pngBuffer = await sharp(Buffer.from(svg), { density: 288 })
    .png()
    .toBuffer();

  return finalizePng(pngBuffer, pad);
}

/**
 * Convert a PNG data URL (e.g. from chart.js canvas.toDataURL) into a
 * cropped PNG buffer.
 */
export async function pngDataUrlToCroppedPng(
  dataUrl: string,
  opts: { pad?: number } = {}
): Promise<Buffer> {
  const pad = opts.pad ?? 20;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const buf = Buffer.from(base64, "base64");

  return finalizePng(buf, pad);
}

async function finalizePng(buf: Buffer, pad: number): Promise<Buffer> {
  // Trim surrounding uniform background (handles transparent or white borders).
  const trimmed = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .trim({ threshold: 12 })
    .png()
    .toBuffer()
    .catch(async () =>
      sharp(buf).flatten({ background: "#ffffff" }).png().toBuffer()
    );

  const meta = await sharp(trimmed).metadata();
  let w = meta.width ?? 100;
  let h = meta.height ?? 100;

  // Cap source dimensions — downscale if larger than professional max.
  const ratioW = Math.min(1, MAX_SOURCE_W / w);
  const ratioH = Math.min(1, MAX_SOURCE_H / h);
  const ratio = Math.min(ratioW, ratioH);
  w = Math.round(w * ratio);
  h = Math.round(h * ratio);

  return sharp(trimmed)
    .resize({ width: w, height: h, fit: "inside" })
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}

/** Get width/height (px) of a PNG buffer. */
export async function pngDimensions(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf).metadata();
  return { width: meta.width ?? 100, height: meta.height ?? 100 };
}
