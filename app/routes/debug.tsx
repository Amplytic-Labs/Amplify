import { json } from '@remix-run/cloudflare';
import type { MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getDebugChannelName, type DebugEvent } from '~/lib/debug/debug-broadcast';

export const meta: MetaFunction = () => [{ title: 'Debug Stream — Raw AI Communication' }];
export const loader = () => json({});

export default function DebugRoute() {
  return (
    <ClientOnly
      fallback={
        <div className="flex items-center justify-center h-screen bg-[#0d0d0d] text-gray-400">
          Loading debug stream...
        </div>
      }
    >
      {() => <DebugStreamPage />}
    </ClientOnly>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface RequestEntry {
  id: string;
  timestamp: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface StreamChunkEntry {
  id: string;
  timestamp: string;
  chunkIndex: number;
  text: string;
  byteLength: number;
}

interface MetaEntry {
  id: string;
  timestamp: string;
  status: number;
  statusText: string;
  ok: boolean;
}

interface ErrorEntry {
  id: string;
  timestamp: string;
  message: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let _uid = 0;

function uid(): string {
  return `dbg-${++_uid}-${Date.now()}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function timeDiff(a: string, b: string): string {
  const ms = new Date(b).getTime() - new Date(a).getTime();

  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Main Component ───────────────────────────────────────────────────────────

function DebugStreamPage() {
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [chunks, setChunks] = useState<StreamChunkEntry[]>([]);
  const [meta, setMeta] = useState<MetaEntry[]>([]);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<'all' | 'request' | 'stream' | 'error'>('all');
  const [connected, setConnected] = useState(false);

  const pausedRef = useRef(false);
  const streamEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Pending events buffer (accumulated while paused)
  const pendingRef = useRef<{
    requests: RequestEntry[];
    chunks: StreamChunkEntry[];
    meta: MetaEntry[];
    errors: ErrorEntry[];
  }>({ requests: [], chunks: [], meta: [], errors: [] });

  // Flush pending events when unpausing
  const flushPending = useCallback(() => {
    const p = pendingRef.current;

    if (p.requests.length > 0) {
      setRequests((prev) => [...prev, ...p.requests]);
      p.requests = [];
    }

    if (p.chunks.length > 0) {
      setChunks((prev) => [...prev, ...p.chunks]);
      p.chunks = [];
    }

    if (p.meta.length > 0) {
      setMeta((prev) => [...prev, ...p.meta]);
      p.meta = [];
    }

    if (p.errors.length > 0) {
      setErrors((prev) => [...prev, ...p.errors]);
      p.errors = [];
    }
  }, []);

  // Handle incoming BroadcastChannel messages
  useEffect(() => {
    const channelName = getDebugChannelName();
    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;
    setConnected(true);

    channel.onmessage = (event: MessageEvent<DebugEvent>) => {
      const evt = event.data;

      if (pausedRef.current) {
        // Buffer events while paused
        if (evt.type === 'REQUEST') {
          const p = evt.payload as { url: string; method: string; headers: Record<string, string>; body: unknown };
          pendingRef.current.requests.push({ id: uid(), timestamp: evt.timestamp, ...p });
        } else if (evt.type === 'STREAM_CHUNK') {
          const p = evt.payload as { chunkIndex: number; text: string; byteLength: number };
          pendingRef.current.chunks.push({ id: uid(), timestamp: evt.timestamp, ...p });
        } else if (evt.type === 'RESPONSE_META') {
          const p = evt.payload as { status: number; statusText: string; ok: boolean };
          pendingRef.current.meta.push({ id: uid(), timestamp: evt.timestamp, ...p });
        } else if (evt.type === 'ERROR') {
          const p = evt.payload as { message: string } | string;
          const msg = typeof p === 'string' ? p : p.message;
          pendingRef.current.errors.push({ id: uid(), timestamp: evt.timestamp, message: msg });
        }

        return;
      }

      if (evt.type === 'REQUEST') {
        const p = evt.payload as { url: string; method: string; headers: Record<string, string>; body: unknown };
        setRequests((prev) => [...prev, { id: uid(), timestamp: evt.timestamp, ...p }]);
      } else if (evt.type === 'STREAM_CHUNK') {
        const p = evt.payload as { chunkIndex: number; text: string; byteLength: number };
        setChunks((prev) => [...prev, { id: uid(), timestamp: evt.timestamp, ...p }]);
      } else if (evt.type === 'RESPONSE_META') {
        const p = evt.payload as { status: number; statusText: string; ok: boolean };
        setMeta((prev) => [...prev, { id: uid(), timestamp: evt.timestamp, ...p }]);
      } else if (evt.type === 'STREAM_END') {
        // Mark end of stream with a separator chunk
        setChunks((prev) => [
          ...prev,
          {
            id: uid(),
            timestamp: evt.timestamp,
            chunkIndex: -1,
            text: `[STREAM END — ${(evt.payload as { totalChunks: number })?.totalChunks ?? '?'} total chunks]`,
            byteLength: 0,
          },
        ]);
      } else if (evt.type === 'ERROR') {
        const p = evt.payload as { message: string } | string;
        const msg = typeof p === 'string' ? p : p.message;
        setErrors((prev) => [...prev, { id: uid(), timestamp: evt.timestamp, message: msg }]);
      }
    };

    return () => {
      channel.close();
      setConnected(false);
    };
  }, []);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chunks, autoScroll]);

  const handleClear = useCallback(() => {
    setRequests([]);
    setChunks([]);
    setMeta([]);
    setErrors([]);
    pendingRef.current = { requests: [], chunks: [], meta: [], errors: [] };
  }, []);

  const handleTogglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;

      if (!next) {
        // Flush pending events
        flushPending();
      }

      return next;
    });
  }, [flushPending]);

  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const requestCount = requests.length;
  const chunkCount = chunks.filter((c) => c.chunkIndex > 0).length;
  const errorCount = errors.length;

  // Compute timing
  const firstTimestamp = requests[0]?.timestamp ?? chunks[0]?.timestamp;
  const lastTimestamp = chunks[chunks.length - 1]?.timestamp ?? requests[requests.length - 1]?.timestamp;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0d0d0d] text-gray-300 font-mono text-xs overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-gray-800 px-4 py-2 flex items-center justify-between gap-4 bg-[#111111]">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-gray-100">Debug Stream</span>
          <span
            className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full ${connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            {connected ? 'Listening' : 'Disconnected'}
          </span>
          {paused && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">Paused</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Filter tabs */}
          {(['all', 'request', 'stream', 'error'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                filter === f ? 'bg-gray-700 text-white' : 'bg-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {f === 'all' ? 'All' : f === 'request' ? 'Requests' : f === 'stream' ? 'Stream' : 'Errors'}
              {f === 'error' && errorCount > 0 && <span className="ml-1 text-red-400">({errorCount})</span>}
            </button>
          ))}

          <div className="w-px h-4 bg-gray-700" />

          {/* Controls */}
          <button
            onClick={handleTogglePause}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              paused
                ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button
            onClick={() => setAutoScroll((p) => !p)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              autoScroll ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-500'
            }`}
          >
            ↓ Auto-scroll {autoScroll ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={handleClear}
            className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-400 hover:bg-red-500/20 hover:text-red-400 transition-colors"
          >
            ✕ Clear
          </button>
        </div>
      </header>

      {/* ── Stats Bar ────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-gray-800 px-4 py-1.5 flex items-center gap-6 bg-[#0f0f0f] text-[10px] text-gray-500">
        <span>
          Requests: <span className="text-gray-300">{requestCount}</span>
        </span>
        <span>
          Chunks: <span className="text-gray-300">{chunkCount}</span>
        </span>
        <span>
          Bytes: <span className="text-gray-300">{formatBytes(totalBytes)}</span>
        </span>
        <span>
          Errors: <span className={errorCount > 0 ? 'text-red-400' : 'text-gray-300'}>{errorCount}</span>
        </span>
        {firstTimestamp && lastTimestamp && (
          <span>
            Duration: <span className="text-gray-300">{timeDiff(firstTimestamp, lastTimestamp)}</span>
          </span>
        )}
        {meta.length > 0 && (
          <span>
            Status:{' '}
            <span className={meta[meta.length - 1].ok ? 'text-green-400' : 'text-red-400'}>
              {meta[meta.length - 1].status} {meta[meta.length - 1].statusText}
            </span>
          </span>
        )}
      </div>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {/* ── Errors section ────────────────────────────────────────────── */}
        {(filter === 'all' || filter === 'error') && errors.length > 0 && (
          <section>
            <h2 className="sticky top-0 text-[10px] uppercase tracking-widest text-red-400 font-bold py-1 bg-[#0d0d0d] z-10">
              Errors ({errors.length})
            </h2>
            {errors.map((err) => (
              <div key={err.id} className="border border-red-900/40 bg-red-950/30 rounded p-2 mb-1">
                <div className="text-[10px] text-red-400/70 mb-0.5">{new Date(err.timestamp).toLocaleTimeString()}</div>
                <pre className="text-red-300 whitespace-pre-wrap break-all">{err.message}</pre>
              </div>
            ))}
          </section>
        )}

        {/* ── Request section ───────────────────────────────────────────── */}
        {(filter === 'all' || filter === 'request') &&
          requests.map((req) => (
            <section key={req.id} className="border border-blue-900/40 bg-blue-950/20 rounded overflow-hidden">
              <div className="px-3 py-1.5 bg-blue-900/20 border-b border-blue-900/30 flex items-center justify-between">
                <h2 className="text-[10px] uppercase tracking-widest text-blue-400 font-bold">
                  → Request — {req.method} {req.url}
                </h2>
                <span className="text-[10px] text-blue-400/60">{new Date(req.timestamp).toLocaleTimeString()}</span>
              </div>

              {/* Messages */}
              {(req.body as { messages?: unknown[] })?.messages && (
                <div className="px-3 py-2 border-b border-blue-900/20">
                  <div className="text-[10px] text-gray-500 uppercase mb-1">
                    Messages ({(req.body as { messages: unknown[] }).messages.length})
                  </div>
                  <pre className="whitespace-pre-wrap break-all text-blue-200 text-[11px] leading-relaxed max-h-96 overflow-y-auto">
                    {JSON.stringify((req.body as { messages: unknown[] }).messages, null, 2)}
                  </pre>
                </div>
              )}

              {/* Full body */}
              <details className="px-3 py-2">
                <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-300 select-none">
                  Full Request Body (JSON)
                </summary>
                <pre className="mt-1 whitespace-pre-wrap break-all text-gray-400 text-[11px] leading-relaxed max-h-96 overflow-y-auto">
                  {JSON.stringify(req.body, null, 2)}
                </pre>
              </details>

              {/* Headers */}
              <details className="px-3 py-2 border-t border-blue-900/20">
                <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-300 select-none">
                  Request Headers
                </summary>
                <pre className="mt-1 whitespace-pre-wrap break-all text-gray-500 text-[11px]">
                  {JSON.stringify(req.headers, null, 2)}
                </pre>
              </details>
            </section>
          ))}

        {/* ── Stream section ────────────────────────────────────────────── */}
        {(filter === 'all' || filter === 'stream') && chunks.length > 0 && (
          <section>
            <h2 className="sticky top-0 text-[10px] uppercase tracking-widest text-green-400 font-bold py-1 bg-[#0d0d0d] z-10">
              ← Stream ({chunkCount} chunks, {formatBytes(totalBytes)})
            </h2>
            <div className="border border-green-900/30 bg-green-950/10 rounded overflow-hidden">
              {chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className={`border-b border-green-900/20 last:border-b-0 ${
                    chunk.chunkIndex === -1 ? 'bg-green-900/20 px-3 py-1.5' : 'px-3 py-1 hover:bg-green-900/10'
                  }`}
                >
                  {chunk.chunkIndex === -1 ? (
                    // Stream end separator
                    <div className="flex items-center gap-2 text-green-500 text-[10px]">
                      <span>{chunk.text}</span>
                      <span className="text-green-500/50">{new Date(chunk.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[9px] text-green-500/60">
                          #{chunk.chunkIndex} · {formatBytes(chunk.byteLength)} ·{' '}
                          {new Date(chunk.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap break-all text-green-200 text-[11px] leading-relaxed">
                        {chunk.text}
                      </pre>
                    </>
                  )}
                </div>
              ))}
              <div ref={streamEndRef} />
            </div>
          </section>
        )}

        {/* Empty state */}
        {requests.length === 0 && chunks.length === 0 && errors.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600">
            <div className="text-4xl mb-3 opacity-30">⊙</div>
            <p className="text-sm">Waiting for AI requests...</p>
            <p className="text-[10px] mt-1 text-gray-700">
              Send a message in the chat to see raw request/response data here.
            </p>
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="shrink-0 border-t border-gray-800 px-4 py-1.5 bg-[#0a0a0a] text-[9px] text-gray-600 flex items-center justify-between">
        <span>
          Channel: <span className="text-gray-500">{getDebugChannelName()}</span>
        </span>
        <span>Open this page in a separate window while chatting to monitor raw AI I/O in real-time.</span>
      </footer>
    </div>
  );
}
