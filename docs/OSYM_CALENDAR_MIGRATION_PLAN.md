# ÖSYM takvim kaynağı migrasyon planı

Durum: **açık** · Açılış: 27 Temmuz 2026 · Tetikleyici: CI `sync:calendar` adımı `HTTP 404`

## Hedef

`sync:calendar` boru hattını ÖSYM'nin yenilenen takvim sayfasına taşımak; saatlik cron'un yeniden yeşil dönmesi ve takvim verisinin tazelenmeye devam etmesi.

## Kapsam dışı

- Haber (`fetch:news`) ve YÖK Atlas (`import:programs`) boru hatları — bunlar çalışıyor, dokunulmayacak.
- Uygulama tarafı takvim UI'ı — veri şeması korunacağı için değişiklik beklenmiyor.
- Dependabot PR kırmızıları — ayrı iş kalemi.

## Doğrulanan gerçekler

| Konu | Gözlem |
| --- | --- |
| Eski URL | `https://www.osym.gov.tr/TR,8797/takvim.html?category_id=1` → **404** (Türkiye IP'sinden de) |
| Yeni URL | `https://www.osym.gov.tr/Sayfa/SinavTakvimi` → **200**, 307 KB |
| Eski parser varsayımı | `div.row` + `div.col-sm-2/col-sm-3` kolonları, `"Sınav Tarihi:"` gibi metin etiketleri |
| Yeni yapı | Semantik CSS sınıfları: `takvimSinavKolon sinavtarihi / basvurutarihi / gecbasvurutarihi / sonuctarihi / yerlestirmetarihi / onbasvurutarihi` |
| YKS verisi | Yeni sayfada mevcut: `2026-YKS 1. Oturum (TYT)`, `2. Oturum (AYT)`, `3. Oturum (YDT)` + tarih hücreleri |
| CI davranışı | 404 bilinçli olarak kırmızı sınıfta (yapısal değişiklik sinyali); bağlantı kesintisi hâlâ yeşil geçiyor |

## Adım sırası

1. **Yeni sayfanın YKS satır yapısını tam çıkar** — üç oturumun sınav/başvuru/geç başvuru/sonuç hücrelerinin DOM konumu, tarih formatı ve saat bilgisinin nerede durduğu. Çıktı: gerçek HTML'den kesilmiş test fixture'ı.
2. **`assertAllowedOfficialUrl` ve `OFFICIAL_CALENDAR_URL` güncelle** — yeni yol, host allowlist'i aynı kalır.
3. **`parseOfficialCalendarHtml` yeniden yaz** — `takvimSinavKolon` sınıf tabanlı okuma; mevcut `calendarSchema` çıktısı ve `assertSharedField` bütünlük kontrolleri korunur.
4. **Testleri taşı** — `scripts/__tests__/sync-calendar.test.ts` fixture'ını yeni HTML'den üret; bozuk/eksik hücre senaryolarının fail-closed davranışı korunmalı.
5. **`osym-preference-calendar.ts` kontrolü** — tercih takvimi keşfi de aynı site yenilemesinden etkilendi mi?
6. **Uçtan uca doğrulama** — `sync:calendar` yerelde gerçek sayfaya karşı çalışır, `content/calendar.json` anlamlı diff üretir, tüm test paketi + tsc + lint yeşil.
7. **Commit + CI izleme** — main'e push, saatlik cron'un yeşil döndüğü teyit edilir.

## Kabul ölçütü

- `npm run sync:calendar` gerçek ÖSYM sayfasından 2026-YKS üç oturumunu doğru tarihlerle üretir.
- Publish workflow uçtan uca **success**.
- Monitor workflow zincirleme kırmızısı kendiliğinden düzelir.
- Hiçbir doğrulanmamış/sentetik tarih üretilmez (§9.1 korunur).

## Riskler ve park edilenler

- **Sayfa JS ile mi doluyor?** 307 KB'lık HTML içinde veriler görünüyor, sunucu tarafı render gibi duruyor — Adım 1'de kesinleşecek.
- ÖSYM ileride yine yapı değiştirebilir; parser'ın hangi sınıfa bağlandığı yorumla işaretlenecek.
- Sayfa artık tüm sınavları (KPSS, ALES, TUS…) tek listede veriyor; YKS filtrelemesi sıkı olmalı, yanlış sınavın tarihi takvime sızmamalı.

## Kesin devam noktası

Sıradaki eylem: **Adım 1** — `/tmp/osym-yeni.html` üzerinden YKS satırlarının tam DOM yapısını çıkar (dosya indirildi, 307 KB, 28 yerde `YKS` geçiyor).
