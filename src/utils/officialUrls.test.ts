import { allowedOsymHttpsUrl } from './officialUrls';

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
