import {
  allowedOgmHttpsUrl,
  allowedOsymHttpsUrl,
  officialCalendarEventUrl,
  OSYM_RESULTS_PORTAL_URL,
} from './officialUrls';

describe('official URL allowlist', () => {
  it('accepts clean ÖSYM HTTPS links and rejects lookalikes or credentials', () => {
    expect(allowedOsymHttpsUrl('https://www.osym.gov.tr/TR,8797/takvim.html?category_id=1')).toBe(
      'https://www.osym.gov.tr/TR,8797/takvim.html?category_id=1',
    );
    expect(allowedOsymHttpsUrl('https://cdn.osym.gov.tr/pdfdokuman/2026/YKS/TSK/tyt.pdf')).toBe(
      'https://cdn.osym.gov.tr/pdfdokuman/2026/YKS/TSK/tyt.pdf',
    );
    expect(allowedOsymHttpsUrl('http://www.osym.gov.tr/takvim')).toBeNull();
    expect(allowedOsymHttpsUrl('https://osym.gov.tr.evil.example/takvim')).toBeNull();
    expect(allowedOsymHttpsUrl('https://user@osym.gov.tr/takvim')).toBeNull();
  });
});

describe('official calendar event URL', () => {
  it('sends result events to the ÖSYM results portal', () => {
    expect(
      officialCalendarEventUrl({
        type: 'sonuc',
        source: 'https://www.osym.gov.tr/TR,8797/takvim.html?category_id=1',
      }),
    ).toBe(OSYM_RESULTS_PORTAL_URL);
  });

  it('keeps other events on their verified source when it is official', () => {
    expect(
      officialCalendarEventUrl({
        type: 'sinav',
        source: 'https://www.osym.gov.tr/TR,8797/takvim.html?category_id=1',
      }),
    ).toBe('https://www.osym.gov.tr/TR,8797/takvim.html?category_id=1');
    expect(
      officialCalendarEventUrl({ type: 'sinav', source: 'https://example.com/takvim' }),
    ).toBeNull();
    expect(officialCalendarEventUrl(null)).toBeNull();
    expect(officialCalendarEventUrl(undefined)).toBeNull();
  });
});

describe('MEB OGM URL allowlist', () => {
  it('accepts only the two official HTTPS content hosts', () => {
    expect(allowedOgmHttpsUrl('https://ogmmateryal.eba.gov.tr/pdf-goster/176299')).toBe(
      'https://ogmmateryal.eba.gov.tr/pdf-goster/176299',
    );
    expect(allowedOgmHttpsUrl('https://ogm-small-cdn.eba.gov.tr/example.pdf')).toBe(
      'https://ogm-small-cdn.eba.gov.tr/example.pdf',
    );
    expect(allowedOgmHttpsUrl('http://ogmmateryal.eba.gov.tr/pdf-goster/176299')).toBeNull();
    expect(allowedOgmHttpsUrl('https://ogmmateryal.eba.gov.tr.evil.test/file')).toBeNull();
    expect(allowedOgmHttpsUrl('https://user@ogmmateryal.eba.gov.tr/file')).toBeNull();
  });
});
