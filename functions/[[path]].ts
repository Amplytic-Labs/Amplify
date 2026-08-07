import type { ServerBuild } from '@remix-run/cloudflare';
import { createPagesFunctionHandler } from '@remix-run/cloudflare-pages';

/**
 * Cloudflare Pages Function — catch-all route handler for Remix.
 *
 * Key design decisions for Workers compatibility:
 *
 * 1. **Handler caching**: The Remix handler is created once and reused across
 *    requests. The previous implementation created a new handler on every
 *    request, which is wasteful and can exceed CPU time limits on Workers
 *    because `createPagesFunctionHandler` does non-trivial work internally.
 *
 * 2. **Static server build import**: The server build is imported once and
 *    cached. Dynamic `import()` inside the request handler was redundant
 *    since the module graph doesn't change between requests.
 */

let handler: ReturnType<typeof createPagesFunctionHandler> | null = null;
let serverBuild: ServerBuild | null = null;

export const onRequest: PagesFunction = async (context) => {
  if (!handler) {
    // @ts-ignore
    serverBuild = (await import('../build/server')) as unknown as ServerBuild;
    handler = createPagesFunctionHandler({
      build: serverBuild,
    });
  }

  return handler(context);
};
