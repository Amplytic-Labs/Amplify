import { json } from '@remix-run/cloudflare';
import type { ActionFunction } from '@remix-run/cloudflare';

/**
 * Test an OpenAI-compatible provider endpoint by calling its /models
 * endpoint. Used by the "Add Provider" popup to verify that the user's
 * base URL + API key actually work BEFORE we save them.
 *
 * Accepts POST with JSON body:
 *   { baseUrl: string, apiKey: string }
 *
 * Returns:
 *   200 { ok: true, models: number, sample: string[] }
 *   400 { ok: false, error: string }   — missing fields
 *   502 { ok: false, error: string }   — upstream returned non-2xx
 *   500 { ok: false, error: string }   — network / unexpected error
 *
 * The route tolerates a couple of common base-URL shapes:
 *   - https://api.example.com            → calls https://api.example.com/v1/models
 *   - https://api.example.com/v1         → calls https://api.example.com/v1/models
 *   - https://api.example.com/v1/        → calls https://api.example.com/v1/models
 *   - https://api.example.com/models     → calls as-is (some hosts put /models at root)
 *
 * This mirrors the OpenAI spec: list models at GET /v1/models with
 * Authorization: Bearer <key>.
 */
export const action: ActionFunction = async ({ request }) => {
  let body: { baseUrl?: string; apiKey?: string };

  try {
    body = (await request.json()) as { baseUrl?: string; apiKey?: string };
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const baseUrl = (body.baseUrl || '').trim();
  const apiKey = (body.apiKey || '').trim();

  if (!baseUrl) {
    return json({ ok: false, error: 'Base URL is required' }, { status: 400 });
  }

  if (!apiKey) {
    return json({ ok: false, error: 'API key is required' }, { status: 400 });
  }

  if (!/^https?:\/\//i.test(baseUrl)) {
    return json({ ok: false, error: 'Base URL must start with http:// or https://' }, { status: 400 });
  }

  // Normalize the base URL: ensure it ends with /v1/models for the OpenAI spec.
  let modelsUrl = baseUrl.replace(/\/+$/, '');

  if (/\/models$/i.test(modelsUrl)) {
    // User already included /models — use as-is.
  } else if (/\/v1$/i.test(modelsUrl)) {
    modelsUrl = `${modelsUrl}/models`;
  } else if (/\/v1\//i.test(modelsUrl)) {
    modelsUrl = `${modelsUrl.replace(/\/+$/, '')}/models`;
  } else {
    // Default: assume OpenAI-compatible layout, append /v1/models.
    modelsUrl = `${modelsUrl}/v1/models`;
  }

  // 10s timeout — long enough for slow providers, short enough to feel responsive.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = '';

      try {
        const errBody = await res.json();
        detail = (errBody as any)?.error?.message || (errBody as any)?.error || (errBody as any)?.message || '';
      } catch {
        try {
          detail = await res.text();
        } catch {
          /* ignore */
        }
      }

      const trimmed = (detail || '').toString().slice(0, 200);

      return json(
        {
          ok: false,
          error: `Upstream returned ${res.status} ${res.statusText}${trimmed ? `: ${trimmed}` : ''}`,
          status: res.status,
        },
        { status: 502 },
      );
    }

    let payload: any;

    try {
      payload = await res.json();
    } catch {
      return json({ ok: false, error: 'Upstream returned a non-JSON response' }, { status: 502 });
    }

    // OpenAI spec: { data: [{ id: "..." }, ...] }. Be lenient about shape.
    const models: string[] = Array.isArray(payload?.data)
      ? payload.data
          .map((m: any) => m?.id)
          .filter(Boolean)
          .slice(0, 5)
      : Array.isArray(payload?.models)
        ? payload.models
            .map((m: any) => (typeof m === 'string' ? m : m?.id))
            .filter(Boolean)
            .slice(0, 5)
        : [];

    return json({
      ok: true,
      models: models.length,
      sample: models,
      testedUrl: modelsUrl,
    });
  } catch (err: any) {
    const message = err?.name === 'AbortError' ? 'Request timed out (10s)' : err?.message || 'Unknown error';

    return json({ ok: false, error: message }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
};
