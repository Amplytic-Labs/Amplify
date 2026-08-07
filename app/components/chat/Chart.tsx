import { memo, useEffect, useState, useRef } from 'react';
import styles from './Markdown.module.scss';

/**
 * Lazy-loaded Chart.js components — only loaded when a chart is actually rendered.
 * This avoids bundling the 6MB+ chart.js library in the initial page load.
 */
type ChartJSModule = typeof import('chart.js');
type ReactChartModule = typeof import('react-chartjs-2');

let _chartJs: ChartJSModule | null = null;
let _reactChart: ReactChartModule | null = null;

async function getChartJs() {
  if (!_chartJs) {
    const [chartMod, reactChartMod] = await Promise.all([import('chart.js'), import('react-chartjs-2')]);

    const {
      Chart: chartJs,
      CategoryScale,
      LinearScale,
      RadialLinearScale,
      BarElement,
      ArcElement,
      PointElement,
      LineElement,
      Title,
      Tooltip,
      Legend,
      Filler,
    } = chartMod;

    chartJs.register(
      CategoryScale,
      LinearScale,
      RadialLinearScale,
      BarElement,
      ArcElement,
      PointElement,
      LineElement,
      Title,
      Tooltip,
      Legend,
      Filler,
    );

    _chartJs = chartMod;
    _reactChart = reactChartMod;
  }

  return { chartJs: _chartJs!, reactChart: _reactChart! };
}

/**
 * Module-level config cache keyed by the raw JSON config string.
 *
 * Mirrors the same streaming-safety strategy used by `Mermaid.tsx`:
 * every streaming chunk causes ReactMarkdown to re-parse the whole
 * message, which can unmount/remount this component. Without a cache
 * the parsed config (and the mounted Chart.js instance) would be
 * rebuilt on every chunk — causing the chart to "re-animate".
 *
 * With the cache, `useState` initialises synchronously from the cached
 * parsed object, so there is never a blank frame between unmount and
 * the next render. Combined with `memo`, React skips re-rendering
 * entirely when the `config` prop is unchanged.
 */
const configCache = new Map<string, ParsedChartConfig>();

interface ParsedChartConfig {
  type: ChartType;
  data: ChartData;
  options?: ChartOptions;
}

type ChartType = 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'bubble' | 'radar' | 'polarArea';

type ChartData = Record<string, unknown>;
type ChartOptions = Record<string, unknown>;

interface ChartProps {
  /** Raw JSON string from the ```chartjs fenced code block. */
  config: string;
}

export const Chart = memo(({ config }: ChartProps) => {
  // Initialise from cache immediately — prevents blank-flash on remount.
  const [parsed, setParsed] = useState<ParsedChartConfig | null>(() => configCache.get(config) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [ChartComponent, setChartComponent] = useState<React.ComponentType<any> | null>(null);

  // Track whether we've already parsed this exact config in this instance.
  const renderedConfigRef = useRef<string>('');

  useEffect(() => {
    // Already parsed this config in this instance — nothing to do.
    if (renderedConfigRef.current === config) {
      return;
    }

    // Serve from module-level cache if available (handles remounts).
    const cached = configCache.get(config);

    if (cached) {
      setParsed(cached);
      setError(null);
      renderedConfigRef.current = config;

      return;
    }

    // Parse + validate the JSON config.
    try {
      const obj = JSON.parse(config);

      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new Error('Config must be a JSON object.');
      }

      if (!obj.type || typeof obj.type !== 'string') {
        throw new Error('Config must include a string "type" field (e.g. "bar", "line", "pie").');
      }

      if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
        throw new Error('Config must include a "data" object with datasets.');
      }

      const result: ParsedChartConfig = {
        type: obj.type as ChartType,
        data: obj.data as ChartData,
        options: obj.options as ChartOptions | undefined,
      };

      configCache.set(config, result);
      setParsed(result);
      setError(null);
      renderedConfigRef.current = config;
    } catch (err: any) {
      console.error('Chart.js config parse failed:', err);
      setError(`Invalid Chart.js config: ${err.message}`);
    }
  }, [config]);

  // Lazy-load chart.js when we have parsed data
  useEffect(() => {
    if (!parsed || ChartComponent) {
      return;
    }

    getChartJs().then(({ reactChart }) => {
      setChartComponent(() => reactChart.Chart);
    });
  }, [parsed, ChartComponent]);

  if (error) {
    return (
      <div className="p-4 my-2 rounded-lg bg-red-100 text-red-700 border border-red-200 text-sm font-mono whitespace-pre-wrap break-words">
        {error}
      </div>
    );
  }

  if (!parsed || !ChartComponent) {
    /*
     * Placeholder while waiting for the first parse. A minHeight prevents
     * a layout shift that would scroll the page.
     */
    return (
      <div
        className="flex justify-center items-center my-4 text-amplify-elements-textTertiary text-sm"
        style={{ minHeight: '200px' }}
      >
        Rendering chart…
      </div>
    );
  }

  return (
    <div
      className={`flex justify-center my-4 overflow-auto ${styles.ChartContainer ?? ''}`}
      style={{ minHeight: '200px' }}
    >
      <div className="w-full max-w-2xl bg-amplify-elements-background-depth-2 rounded-lg p-4 border border-amplify-elements-borderColor">
        <ChartComponent type={parsed.type} data={parsed.data as any} options={parsed.options as any} />
      </div>
    </div>
  );
});

Chart.displayName = 'Chart';
