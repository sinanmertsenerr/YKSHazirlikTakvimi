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

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A redirect body may already be closed or absent.
  }
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
