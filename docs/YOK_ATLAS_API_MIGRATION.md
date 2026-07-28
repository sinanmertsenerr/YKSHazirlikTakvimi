# YÖK Atlas API sözleşme değişikliği — taşıma planı

**Durum:** Açık · **Tespit:** 28 Temmuz 2026 · **Etki:** `import:programs` günlük cron'da kırmızı düşüyor

## Hedef

YÖK Atlas'ın Temmuz 2026'da yeniden yapılandırdığı arama API'sine taşınmak; program/kontenjan
verisini yanlış yorumlamadan yeniden akıtmak ve günlük CI kırmızısını kapatmak.

## Kapsam dışı

- Uygulama içi UI değişikliği (alan adları veri katmanında normalize edilir)
- 2026 yerleştirme verisi (YÖK henüz yayımlamadı; bu plan yalnız sözleşmeye uyum)

## Kanıt (28 Temmuz 2026, canlı ölçüm)

SPA bundle `main.ffe6ecf9.js` (1.31 MB) ve `POST /api/tercih-kilavuz/search` üzerinde doğrulandı.

| Kodun beklediği | Canlı API | Durum |
| --- | --- | --- |
| `kontenjan` | `kontenjan` | Duruyor |
| `kontenjanObs` (okul birincisi) | — | Kaldırıldı |
| `kontenjanDep` (deprem) | — | Kaldırıldı |
| `kontenjanSgy` (şehit/gazi yakını) | — | Kaldırıldı |
| `kontenjanY34` (34+ yaş) | — | Kaldırıldı |
| `gkY` (genel kontenjana yerleşen) | `gkY1` | Yeniden adlandırıldı |
| `obkY`, `dprmY` | — | Kaldırıldı |
| — | `gk1`, `gk2`, `gk3` | Yeni (semantiği doğrulanmadı) |
| — | `minPuan1/2/3`, `basariSirasi1/3` | Duruyor/genişledi |

Ayrıca: SPA bundle'ında **"YETENEK" kelimesi hiç geçmiyor** (0 eşleşme); `birimTuruId: 48`
(ÖZEL YETENEK) seçeneği sihirbazdan kaldırılmış. Özel yetenek sweep'i zaten 0 satır dönüyordu.

Canary koruması (`import-yok-atlas-programs.ts:143`) bunu yakalayıp import'u durdurdu —
tasarlandığı gibi çalıştı, yanlış yorumlanmış sayı yayımlanmadı.

## Kritik bulgu: puan ve kontenjan aileleri farklı yıla referans veriyor

`content/programs.fixture.json` (16 Temmuz, snapshot yılı 2025) ile canlı API (snapshot yılı
2026) üç programda birebir karşılaştırıldı. Sonuç:

| Alan ailesi | Suffix'siz | `1` | `2` | `3` |
| --- | --- | --- | --- | --- |
| Kontenjan (`kontenjan`, `gk*`) | 2026 | 2025 | 2024 | 2023 |
| Puan/sıra (`minPuan*`, `basariSirasi*`) | **2025** | 2024 | 2023 | 2022 |
| Yerleşen | `gkY` boş (2026 yerleştirmesi yapılmadı) | `gkY1` = 2025 | — | — |

Yani kılavuz yılı ilerledi ama yerleştirme henüz yapılmadığı için puan serisi bir yıl geride.
Mevcut kod (`yok-atlas.ts:366-371`) her iki aileyi de aynı indeksle okuyor; olduğu gibi
çalışsaydı **2026 yılına 2025'in taban puanını** yazacaktı. Canary bunu engelledi.

**Tasarım kuralı:** puan serisinin başlangıcı sabit indeks değil, *son tamamlanmış yerleştirme
yılı* olmalı — `gkY` doluysa `yil`, boşsa `yil - 1`. Bu kural hem şu anki ara döneme hem de
Ağustos'ta yerleştirme yayımlandıktan sonraki duruma uyar.

## Neden dikkatli ilerlemeli

`gk1/gk2/gk3` alanlarının hangi kontenjan kategorisine karşılık geldiği **kanıtlanmadı**.
Tahminle eşleştirmek, kullanıcıya yanlış kontenjan/yerleşen sayısı göstermek demektir
(PROMPT.md §9.1 ihlali). Eşleştirme, SPA'nın kendi render kodundan veya YÖK'ün yayımladığı
tablodan doğrulanmadan yazılmamalı.

## Adımlar

1. **[x] Yeni alan semantiğini kanıtla.** SPA render bloğu (`case"kontenjan"`) beş kategoriyi
   `gk1/gkY1`, `obk1/obkY1`, `dprm1/dprmY1`, `sgy1/sgyY1`, `y34_1/y34Y1` alanlarına bağlıyor;
   fixture'ın 2025 değerleriyle canlı `gk1/gkY1` üç programda birebir eşleşti.
2. **[x] `yok-atlas-details.ts` kategori tablosunu taşı.** Kayıt yılı `yil - 1` (kategori
   kırılımının ait olduğu yıl); puan/sıra `gkY` doluluğuna göre `minPuan`/`minPuan1`.
3. **[x] Canary listesini güncelle.** Kısa `.gkY` parçası `gkY1` içinde de eşleşip yeniden
   adlandırmayı gizlediği için tam bağlama dizeleri pinlendi; beşi de canlı bundle'da doğrulandı.
4. **[x] Özel yetenek yolu.** `birimTuruId 48` API'de duruyor ama 0 satır dönüyor ve SPA'nın
   seviye seçicisinden kaldırılmış. Kod zaten `allowEmpty: true` ile boş sweep'i normal
   sayıyor; değişiklik gerekmedi, yalnız kalkan canary token'ı listeden çıkarıldı.
5. **[x] Testleri güncelle.** 38/38 YÖK Atlas testi, 280/280 tam paket, typecheck ve lint geçti.
6. **[x] Dry-run import** (28 Temmuz, canlı): 21.491 program, 93.743 program-yıl satırı,
   194 koşul metni, 37.121/41.634 netler satırı — 2026 snapshot'ından temiz geçti. Program
   sayısı 21.602'den 21.491'e düştü (2026 kılavuzunda kapanan programlar); program-yıl satırı
   arttı çünkü kontenjan serisi 2026'ya uzarken puan serisi 2022'de duruyor.
7. **[x] Commit + push.** Kalan tek doğrulama: günlük cron'un ilk yeşil koşusu.

### Eski plan (tamamlandı)

1. **[x] Yeni alan semantiğini kanıtla.** SPA render kodunda `gk1/gk2/gk3` ve `gkY1`'in hangi
   etiketle ("Genel", "Okul Birincisi", …) eşleştiğini bul; canlı bir programın YÖK Atlas
   sayfasındaki görünen tabloyla sayıları karşılaştır.
   *Bitti ölçütü:* her alan için etiket + en az bir canlı sayı eşleşmesi belgelendi.
2. **[ ] `yok-atlas-details.ts` kontenjan kategorisi tablosunu yeni sözleşmeye taşı.**
   Kaldırılan kategoriler için veri üretmeyi bırak (uydurma yok), duran kategorileri koru.
3. **[ ] Canary listesini güncelle.** `ZEL YETENEK",value:48` ve `.kontenjanObs` yerine yeni
   sözleşmenin ayırt edici token'ları; `.gkY` canary'si `gkY1` içinde substring olarak
   eşleştiği için yanıltıcı — sınırlandır.
4. **[ ] Özel yetenek yolunu kararla.** YÖK sihirbazdan kaldırdıysa sweep'i kaldır veya
   "kaynak yayımlamıyor" durumuna indir; `project-yokatlas-details-integration` hafıza
   kaydını güncelle.
5. **[ ] Fixture ve testleri güncelle**, `npm run test:coverage` + `validate:bundled` geçir.
6. **[ ] Dry-run import** ile canlıdan tam çekim yap, satır sayılarını eski snapshot ile
   karşılaştır, sapmayı açıkla.
7. **[ ] Commit + push**, günlük cron'un yeşil döndüğünü doğrula.

## Ara çözüm (adım 1-7 tamamlanana kadar)

Günlük `import:programs` kırmızısını sustur**ma**; bunun yerine iki seçenek var:

- **A (önerilen):** Program yenilemesini geçici olarak devre dışı bırak (workflow'da adımı
  `if: false` veya cron'dan çıkar). Mevcut 2025 snapshot'ı cihazlarda geçerli kalır; CI yeşile
  döner; taşıma tamamlanınca geri açılır. *Maliyet:* program verisi taze gelmez — 2026
  yerleştirmesi yayımlanana kadar zaten değişmiyor.
- **B:** Sözleşme değişikliğini "upstream contract change" olarak sınıflandırıp uyarıyla yeşil
  geç. *Maliyet:* kalıcı bir arıza geçici kesinti gibi görünür, unutulma riski yüksek.

## Kesin devam noktası

Adım 1 açık. Başlangıç: `scripts/lib/yok-atlas-details.ts:52-68` (kategori tablosu) ve canlı
bundle `https://yokatlas.yok.gov.tr/static/js/main.ffe6ecf9.js` içinde `kategori:"Genel"`
geçen render bloğu.
