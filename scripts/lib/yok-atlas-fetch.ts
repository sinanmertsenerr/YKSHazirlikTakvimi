import { assertDeclaredContentLength, cancelBody } from './fetch-safety.ts';

const YOK_ATLAS_ORIGIN = 'https://yokatlas.yok.gov.tr';
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type YokAtlasFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function assertYokAtlasUrl(value: string | URL): URL {
  const url = value instanceof URL ? new URL(value.href) : new URL(value);
  if (
    url.origin !== YOK_ATLAS_ORIGIN ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error('YÖK Atlas request must stay on the exact official HTTPS origin.');
  }
  return url;
}

export async function fetchYokAtlas(
  input: string | URL,
  init: RequestInit = {},
  fetchImpl: YokAtlasFetch = fetch,
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    throw new Error(`Unsupported YÖK Atlas request method: ${method}`);
  }
  let currentUrl = assertYokAtlasUrl(input);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, { ...init, method, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    await cancelBody(response);
    if (!location) throw new Error('YÖK Atlas redirect has no Location header.');
    if (redirectCount === MAX_REDIRECTS) {
      throw new Error(`YÖK Atlas request exceeded ${MAX_REDIRECTS} redirects.`);
    }
    if (method === 'POST' && response.status !== 307 && response.status !== 308) {
      throw new Error(`YÖK Atlas refused unsafe HTTP ${response.status} redirect for POST.`);
    }
    currentUrl = assertYokAtlasUrl(new URL(location, currentUrl));
  }

  throw new Error('YÖK Atlas redirect loop ended unexpectedly.');
}

/**
 * Reads a response body as UTF-8 text while enforcing a hard byte ceiling.
 *
 * Rejects on an oversized advertised `Content-Length` before any allocation, then
 * streams the body chunk by chunk and aborts the moment the accumulated size would
 * exceed `maxBytes`. This prevents a very large or malicious official-source
 * response from exhausting memory before a post-hoc `.length` check could run.
 */
export async function readBoundedText(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<string> {
  await assertDeclaredContentLength(response, maxBytes, label);

  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes}-byte safety limit.`);
    }
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`${label} exceeds the ${maxBytes}-byte safety limit.`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}
