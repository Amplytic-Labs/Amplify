/**
 * Debug Broadcast Utility
 *
 * Intercepts fetch requests to /api/chat and broadcasts the raw
 * request body and SSE stream chunks to any listening debug page
 * via a BroadcastChannel.
 */

const CHANNEL_NAME = 'amplify-debug-stream';

// ── Event types ──────────────────────────────────────────────────────────────

export type DebugEventType =
  | 'REQUEST' // Full outgoing request body
  | 'STREAM_CHUNK' // Raw SSE chunk from the response
  | 'STREAM_END' // Stream finished
  | 'ERROR' // An error occurred
  | 'RESPONSE_META'; // Response status / headers metadata

export interface DebugEvent {
  type: DebugEventType;
  timestamp: string;
  payload: unknown;
}

// ── Channel singleton ────────────────────────────────────────────────────────

let _channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel {
  if (!_channel) {
    _channel = new BroadcastChannel(CHANNEL_NAME);
  }

  return _channel;
}

function broadcast(event: DebugEvent): void {
  try {
    getChannel().postMessage(event);
  } catch {
    // BroadcastChannel might be unavailable in some environments – silently ignore
  }
}

// ── Stream reader ────────────────────────────────────────────────────────────

/**
 * Reads a cloned response stream chunk-by-chunk and broadcasts each chunk.
 * The original response is NOT consumed – only the clone is read here.
 */
async function readAndBroadcastStream(clonedResponse: Response): Promise<void> {
  const reader = clonedResponse.body?.getReader();

  if (!reader) {
    broadcast({
      type: 'ERROR',
      timestamp: new Date().toISOString(),
      payload: 'Response body is null – cannot read stream',
    });
    return;
  }

  const decoder = new TextDecoder();
  let chunkCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        broadcast({
          type: 'STREAM_END',
          timestamp: new Date().toISOString(),
          payload: { totalChunks: chunkCount },
        });
        break;
      }

      chunkCount++;

      const text = decoder.decode(value, { stream: true });

      broadcast({
        type: 'STREAM_CHUNK',
        timestamp: new Date().toISOString(),
        payload: {
          chunkIndex: chunkCount,
          text,
          byteLength: value.byteLength,
        },
      });
    }
  } catch (err: unknown) {
    broadcast({
      type: 'ERROR',
      timestamp: new Date().toISOString(),
      payload: {
        message: err instanceof Error ? err.message : String(err),
        chunkIndex: chunkCount,
      },
    });
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a fetch-compatible function that can be passed to `useChat({ fetch })`.
 * It transparently proxies the real fetch while broadcasting request/response
 * data to the debug BroadcastChannel.
 */
export function createDebugFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Only intercept /api/chat requests
    const isChatRequest = url.includes('/api/chat');

    // ── Broadcast the request body ──────────────────────────────────────────
    if (isChatRequest && init?.body) {
      try {
        const bodyStr = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
        const bodyObj = JSON.parse(bodyStr);

        broadcast({
          type: 'REQUEST',
          timestamp: new Date().toISOString(),
          payload: {
            url,
            method: init.method || 'GET',
            headers: init.headers ? Object.fromEntries(new Headers(init.headers as HeadersInit).entries()) : {},
            body: bodyObj,
          },
        });
      } catch {
        // Body may not be JSON – broadcast raw
        broadcast({
          type: 'REQUEST',
          timestamp: new Date().toISOString(),
          payload: {
            url,
            method: init.method || 'GET',
            body: String(init.body),
          },
        });
      }
    }

    // ── Perform the real fetch ──────────────────────────────────────────────
    let response: Response;

    try {
      response = await fetch(input, init);
    } catch (err: unknown) {
      broadcast({
        type: 'ERROR',
        timestamp: new Date().toISOString(),
        payload: {
          message: err instanceof Error ? err.message : String(err),
          phase: 'fetch',
        },
      });
      throw err; // Re-throw so useChat can handle it
    }

    // ── Broadcast response metadata ─────────────────────────────────────────
    if (isChatRequest) {
      broadcast({
        type: 'RESPONSE_META',
        timestamp: new Date().toISOString(),
        payload: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          ok: response.ok,
        },
      });
    }

    // ── Clone and broadcast the stream ──────────────────────────────────────
    if (isChatRequest && response.body) {
      const clonedResponse = response.clone();

      // Fire-and-forget: read the clone in the background without blocking
      readAndBroadcastStream(clonedResponse).catch(() => {
        // Silently ignore – the original response still works fine
      });
    }

    // Return the ORIGINAL response untouched so useChat works normally
    return response;
  };
}

/**
 * Returns the BroadcastChannel name so the debug page can listen on the same channel.
 */
export function getDebugChannelName(): string {
  return CHANNEL_NAME;
}
