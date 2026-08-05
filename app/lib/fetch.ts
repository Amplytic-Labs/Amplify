type CommonRequest = Omit<RequestInit, 'body'> & { body?: URLSearchParams };

export async function request(url: string, init?: CommonRequest) {
  if (import.meta.env.DEV) {
    const nodeFetch = await import('node-fetch');
    const https = await import('node:https');

    const agent = url.startsWith('https') ? new https.Agent({ rejectUnauthorized: false }) : undefined;

    /*
     * node-fetch's `Agent` (from node:https) is structurally incompatible
     * with the DOM `fetch` Agent type, but at runtime they're identical.
     */
    return nodeFetch.default(url, { ...init, agent } as any);
  }

  return fetch(url, init);
}
