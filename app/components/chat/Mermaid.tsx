import { memo, useEffect, useState, useId } from 'react';
import mermaid from 'mermaid';
import styles from './Markdown.module.scss';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

interface MermaidProps {
  chart: string;
}

export const Mermaid = memo(({ chart }: MermaidProps) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const id = useId().replace(/:/g, '');

  useEffect(() => {
    const renderChart = async () => {
      try {
        const renderId = `mermaid-svg-${id}`;
        const { svg } = await mermaid.render(renderId, chart);
        setSvg(svg);
        setError(null);
      } catch (err) {
        console.error('Mermaid render failed:', err);
        setError('Invalid Mermaid syntax');
      }
    };

    renderChart();
  }, [chart, id]);

  if (error) {
    return (
      <div className="p-4 my-2 rounded-lg bg-red-100 text-red-700 border border-red-200 text-sm font-mono">{error}</div>
    );
  }

  return <div className="flex justify-center my-4 overflow-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
});

Mermaid.displayName = 'Mermaid';
