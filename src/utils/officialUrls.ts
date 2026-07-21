export const OSYM_RESULTS_PORTAL_URL = 'https://sonuc.osym.gov.tr/';

/**
 * Takvim olayı için açılacak resmî hedef. Sonuç olayları ÖSYM sonuç portalına
 * gider; olayın `source` alanı sağlama (provenance) linkidir ve ÖSYM genel
 * takvim sayfası derin linkleri mobilde ana sayfaya yönlendirdiği için sonuç
 * bağlamında kullanıcıya yardımcı olmaz.
 */
export function officialCalendarEventUrl(
  event: { type: string; source?: string | null } | null | undefined,
): string | null {
  if (!event) return null;
  if (event.type === 'sonuc') return OSYM_RESULTS_PORTAL_URL;
  return allowedOsymHttpsUrl(event.source);
}

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

export function allowedOgmHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase('en-US');
    if (
      url.protocol !== 'https:' ||
      (host !== 'ogmmateryal.eba.gov.tr' && host !== 'ogm-small-cdn.eba.gov.tr') ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
