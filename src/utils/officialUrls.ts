export function allowedOsymHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase('en-US');
    if (
      url.protocol !== 'https:' ||
      (host !== 'osym.gov.tr' && !host.endsWith('.osym.gov.tr')) ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
