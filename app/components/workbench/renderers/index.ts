import type { ComponentType } from 'react';
import { HtmlRenderer } from './HtmlRenderer';
import { DocxRenderer } from './DocxRenderer';
import { UnsupportedRenderer } from './UnsupportedRenderer';
import { getFileExtension } from '~/lib/renderable/registry';

/**
 * Props that every renderer component receives.
 */
export interface RendererProps {
  filePath: string;
  content: string;
}

/**
 * Map of file extensions to their corresponding renderer components.
 * To add support for a new format:
 *   1. Create a renderer component in this directory
 *   2. Add it here: `extension: MyRenderer`
 */
const RENDERER_MAP: Record<string, ComponentType<RendererProps>> = {
  html: HtmlRenderer as ComponentType<RendererProps>,
  docx: DocxRenderer as ComponentType<RendererProps>,
};

/**
 * Returns the appropriate renderer component for a given file path.
 * Falls back to UnsupportedRenderer if no renderer is registered.
 */
export function getRenderer(filePath: string): ComponentType<RendererProps> {
  const ext = getFileExtension(filePath);
  return RENDERER_MAP[ext] ?? UnsupportedRenderer;
}

export { HtmlRenderer, DocxRenderer, UnsupportedRenderer };
