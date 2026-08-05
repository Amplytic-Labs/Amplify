import { memo, useEffect, useState, useRef } from 'react';
import mermaid from 'mermaid';
import styles from './Markdown.module.scss';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

/**
 * Module-level SVG cache keyed by chart source.
 *
 * Problem: Every streaming chunk causes ReactMarkdown to re-parse, which can
 * unmount and remount the Mermaid component even when the chart content hasn't
 * changed. Without caching, the svg state resets to '' on remount, causing the
 * diagram to collapse then re-expand for every chunk — the "jumping" effect.
 *
 * Fix: On mount, useState initializes instantly from this cache, so there is
 * never a blank frame between unmount and the next async render completing.
 */
const svgCache = new Map<string, string>();

/** Counter to produce unique IDs for each mermaid.render() call. */
let renderCounter = 0;

interface MermaidProps {
  chart: string;
}

export const Mermaid = memo(({ chart }: MermaidProps) => {
  // Initialize from cache immediately — prevents blank-flash on remount
  const [svg, setSvg] = useState<string>(() => svgCache.get(chart) ?? '');
  const [error, setError] = useState<string | null>(null);

  // Track whether we're already rendering this exact chart to avoid duplicate calls
  const isRenderingRef = useRef(false);
  const renderedChartRef = useRef<string>('');

  useEffect(() => {
    // Already rendered this chart in this instance — nothing to do
    if (renderedChartRef.current === chart) {
      return;
    }

    // Serve from module-level cache if available (handles remounts)
    const cached = svgCache.get(chart);

    if (cached) {
      setSvg(cached);
      renderedChartRef.current = chart;

      return;
    }

    // Guard against concurrent renders of the same chart
    if (isRenderingRef.current) {
      return;
    }

    const renderChart = async () => {
      isRenderingRef.current = true;

      try {
        const renderId = `mermaid-svg-${++renderCounter}`;
        const { svg: renderedSvg } = await mermaid.render(renderId, chart);
        svgCache.set(chart, renderedSvg);
        setSvg(renderedSvg);
        setError(null);
        renderedChartRef.current = chart;
      } catch (err) {
        console.error('Mermaid render failed:', err);
        setError('Invalid Mermaid syntax');
      } finally {
        isRenderingRef.current = false;
      }
    };

    renderChart();
  }, [chart]);

  if (error) {
    return (
      <div className="p-4 my-2 rounded-lg bg-red-100 text-red-700 border border-red-200 text-sm font-mono">{error}</div>
    );
  }

  return (
    <div
      className="flex justify-center my-4 overflow-auto"

      /*
       * minHeight while svg is loading prevents a layout shift that would
       * scroll the page. Once svg is populated the height is determined by
       * the SVG itself.
       */
      style={svg ? undefined : { minHeight: '120px' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});

Mermaid.displayName = 'Mermaid';
