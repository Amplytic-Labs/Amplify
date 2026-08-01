import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { isAllowedUrl } from '~/utils/url';

const MAX_CONTENT_LENGTH = 8000;

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : '';
}

function extractMetaDescription(html: string): string {
  const match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);

  if (match) {
    return match[1].trim();
  }

  // Try reverse attribute order
  const altMatch = html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);

  return altMatch ? altMatch[1].trim() : '';
}

function extractTextContent(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a URL, working around Node's undici fetch header-size limit.
 *
 * Some servers (e.g. appwrite.io) send response headers larger than undici's
 * hardcoded 16KB limit, causing `fetch failed: UND_ERR_HEADERS_OVERFLOW`. When
 * that happens we fall back to node:https with a 1MB maxHeaderSize, which
 * handles those servers fine.
 *
 * Returns a fetch-like Response object so the rest of the route can use the
 * standard `.ok`, `.headers`, `.text()` API.
 */
async function fetchUrlWithFallback(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err: any) {
    // Only fall back for the headers-overflow error; rethrow anything else.
    const isHeadersOverflow =
      err?.cause?.code === 'UND_ERR_HEADERS_OVERFLOW' ||
      err?.message?.includes('Headers Overflow') ||
      err?.message?.includes('UND_ERR_HEADERS_OVERFLOW');

    if (!isHeadersOverflow) {
      throw err;
    }

    // Dynamic import so the route doesn't break in Cloudflare Workers (where
    // node:https is unavailable). The import will fail there, which is fine —
    // Cloudflare's fetch doesn't have the headers-overflow issue anyway.
    const https = await import('node:https');
    const httpUrl = new URL(url);

    return await new Promise<Response>((resolve, reject) => {
      const req = https.get(
        {
          hostname: httpUrl.hostname,
          port: httpUrl.port || 443,
          path: httpUrl.pathname + httpUrl.search,
          method: 'GET',
          headers: FETCH_HEADERS,
          maxHeaderSize: 1024 * 1024, // 1MB — handles servers with large Set-Cookie chains
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            // Build a fetch-like Response. Headers get normalized to lowercase.
            const headers = new Headers();

            for (const [k, v] of Object.entries(res.headers || {})) {
              if (Array.isArray(v)) {
                for (const item of v) {
                  headers.append(k, item);
                }
              } else if (v != null) {
                headers.set(k, String(v));
              }
            }

            resolve(
              new Response(body, {
                status: res.statusCode || 200,
                statusText: res.statusMessage || '',
                headers,
              }),
            );
          });
        },
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out after 10 seconds'));
      });
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { url } = (await request.json()) as { url?: string };

    if (!url || typeof url !== 'string') {
      return json({ error: 'URL is required' }, { status: 400 });
    }

    if (!isAllowedUrl(url)) {
      return json({ error: 'URL is not allowed. Only public HTTP/HTTPS URLs are accepted.' }, { status: 400 });
    }

    const response = await fetchUrlWithFallback(url);

    if (!response.ok) {
      return json({ error: `Failed to fetch URL: ${response.status} ${response.statusText}` }, { status: 502 });
    }

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return json({ error: 'URL must point to an HTML or text page' }, { status: 400 });
    }

    const html = await response.text();
    const title = extractTitle(html);
    const description = extractMetaDescription(html);
    const content = extractTextContent(html);

    return json({
      success: true,
      data: {
        title,
        description,
        content: content.length > MAX_CONTENT_LENGTH ? content.slice(0, MAX_CONTENT_LENGTH) + '...' : content,
        sourceUrl: url,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return json({ error: 'Request timed out after 10 seconds' }, { status: 504 });
    }

    console.error('Web search error:', error);

    return json({ error: error instanceof Error ? error.message : 'Failed to fetch URL' }, { status: 500 });
  }
}
