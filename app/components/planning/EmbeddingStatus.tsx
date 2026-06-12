import { useEffect, useState } from 'react';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('EmbeddingStatus');

export function EmbeddingStatus() {
  const [status, setStatus] = useState<'checking' | 'available' | 'unavailable'>('checking');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch('/?XTransformPort=3020/health', { signal: controller.signal });
        clearTimeout(timeout);
        setStatus(res.ok ? 'available' : 'unavailable');
      } catch {
        setStatus('unavailable');
      }
    };

    checkHealth();
    // Re-check every 60 seconds
    const interval = setInterval(checkHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  if (status === 'checking' || status === 'available') {
    return null; // Don't show anything when it's working or still checking
  }

  return (
    <div className="mx-4 mb-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
      <div className="h-3.5 w-3.5 i-ph:warning-circle flex-shrink-0" />
      <span>Embedding service unavailable — vector memory search is disabled. Start the embedding service for semantic memory.</span>
    </div>
  );
}
