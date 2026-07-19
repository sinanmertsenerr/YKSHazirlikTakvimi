# YKS Hazırlık — Uygulama Spesifikasyonu ve İmplementasyon Promptu

> Bu doküman, uygulamanın **tek kaynak spesifikasyonudur**. Her faz, Claude'a (veya kendine)
> doğrudan verilebilecek bir görev listesi olarak yazılmıştır. Sırayla Faz 0'dan başla;
> her fazın "Kabul Kriterleri" sağlanmadan sonrakine geçme.

---

## 1. Vizyon ve Temel İlkeler

YKS'ye (TYT + AYT) hazırlanan öğrenciler için **tamamen offline-first, sıfır sunucu maliyetli**,
native hissiyatlı bir mobil uygulama:

1. **Konu Analizi** — TYT ve AYT'nin her dersi, her konu başlığı; her konudan hangi yıl kaç soru
   çıktığı ve o soruların ne olduğu (meta veri düzeyinde).
2. **Gelişim Takibi** — kullanıcı kendi konu ilerlemesini ve deneme netlerini cihazında tutar.
3. **Tercih Simülatörü** — tahmini netlerden puan + sıralama tahmini; geçmiş yılların taban
   puan/sıralamalarıyla olası üniversite/bölüm listesi.
4. **Haberler & Takvim** — güncel YKS haberleri, ÖSYM duyuruları, başvuru/sınav/tercih tarihleri.

### Değişmez ilkeler (her fazda geçerli)

| İlke | Anlamı |
|---|---|
| **Sıfır işletme maliyeti** | Sunucu yok, veritabanı servisi yok, auth yok. Tüm kullanıcı verisi cihazda. Statik içerik GitHub Pages/raw üzerinden (ücretsiz) tazelenir. |
| **Offline-first** | Uygulama internetsiz **tam** çalışır (haber akışı hariç). İçerik paketi uygulamayla gömülü gelir, internet varsa güncellenir. |
| **Native his** | iOS'ta Liquid Glass (iOS 26+), Android'de Material 3. Tab bar, header, haptics, ikonlar platforma özgü. |
| **İki dil** | TR (varsayılan) + EN. Tüm içerik JSON'ları `{tr, en}` çiftli. |
| **İki tema** | Sistem / Açık / Koyu. |
| **Hesap yok** | Kayıt/giriş yok. Yedekleme = dosya export/import. |
| **Telif güvenliği** | ÖSYM soru metinleri uygulamada **yer almaz**; sadece meta veri (yıl, konu, kazanım, kısa tanım, zorluk) + ÖSYM'nin kendi PDF sayfasına link. |

### Kaçınılmaz tek maliyet
Mağaza hesapları: Apple Developer 99$/yıl, Google Play 25$ (tek seferlik). Başka hiçbir kalem yok
(build'ler lokal alınır; EAS zorunlu değil).

---

## 2. Ürün Özeti — Sekme Yapısı

5 native tab + 1 modal:

| Tab | Rota | İçerik |
|---|---|---|
| **Ana Sayfa** | `(tabs)/index` | YKS geri sayımı, günlük özet, seri (streak), hızlı erişim |
| **Konular** | `(tabs)/konular` | TYT/AYT → ders → konu → yıllara göre soru dağılımı + çıkmış soru listesi + ilerleme işaretleme |
| **Gelişim** | `(tabs)/gelisim` | Deneme girişi, net grafikleri, ders/konu bazlı analiz |
| **Tercih** | `(tabs)/tercih` | Net → puan → sıralama tahmini; geçmiş yıl taban puan/sıralamalı program listesi, favoriler |
| **Haberler** | `(tabs)/haberler` | YKS haber akışı + resmi takvim şeridi |
| Ayarlar | `ayarlar` (modal) | Dil, tema, sınav yılı, bildirimler, yedekle/geri yükle, hakkında/feragat |

---

## 3. Teknoloji Yığını (kesin kararlar)

| Katman | Seçim | Not |
|---|---|---|
| Framework | **Expo SDK 55+** (React Native, TypeScript strict) | `npx create-expo-app` — development build ile çalış (Expo Go değil; glass ve native tab davranışları için) |
| Navigasyon | **expo-router** + **`expo-router/native-tabs`** (`NativeTabs`) | iOS: UITabBar (iOS 26'da Liquid Glass otomatik), Android: Material bottom navigation. İkonlar: `sf` (SF Symbols) + `md` (Material) çiftli ver |
| Liquid Glass | **`expo-glass-effect`** → `GlassView`, `GlassContainer`, `isLiquidGlassAvailable()` | `false` dönerse (iOS < 26 / Android) `expo-blur` veya düz yüzeyle fallback. `AccessibilityInfo.isReduceTransparencyEnabled()` kontrolünü unutma |
| Durum | **zustand** + **react-native-mmkv** (persist) | Ayarlar, hafif UI durumu |
| Veritabanı | **expo-sqlite** + **drizzle-orm** | Kullanıcı verisi (ilerleme, denemeler, favoriler) + büyük içerik (program taban puanları) |
| i18n | **i18next + react-i18next + expo-localization** | Cihaz dilinden otomatik başlangıç |
| Grafikler | **victory-native** (Skia tabanlı) | Bar/line chart'lar için |
| Animasyon | **react-native-reanimated** + haptics (`expo-haptics`) | |
| Bildirim | **expo-notifications** (yalnızca **local** bildirim) | Push sunucusu yok = maliyet yok |
| Doğrulama | **zod** | Content pack şema doğrulaması (hem CI'da hem uygulamada) |
| Test | **jest + @testing-library/react-native** | Puan motoru için golden testler zorunlu |
| İçerik dağıtımı | **GitHub Pages + GitHub Actions** | Ücretsiz CDN; aşağıda §9 |

---

## 4. Mimari

### 4.1 Veri akışı

```
┌─ GitHub repo (content/) ─┐   GitHub Action    ┌─ GitHub Pages ─┐
│ topics.json, programs.db │ ──build+validate──▶│ manifest.json  │
│ coefficients.json, ...   │                    │ pack dosyaları │
└──────────────────────────┘                    └──────┬─────────┘
                                                       │ uygulama açılışında
                                                       │ (24 saatte 1, versiyon karşılaştır)
┌──────────────────────────── Cihaz ────────────────────▼─────────┐
│ Gömülü pack (app bundle) ──ilk açılış──▶ FileSystem'deki pack   │
│ SQLite: kullanıcı verisi (ilerleme, denemeler, favoriler)       │
│ MMKV: ayarlar (dil, tema, sınav yılı, hedef puan türü)          │
└─────────────────────────────────────────────────────────────────┘
```

- **Content pack** uygulamayla gömülü gelir → internetsiz ilk açılış sorunsuz.
- Açılışta (24 saatte en fazla 1 kez) `manifest.json` çekilir; `version` yeniyse dosyalar indirilir,
  zod ile doğrulanır, **atomik** olarak eskisiyle değiştirilir. Doğrulama başarısızsa eski pack kalır.
- Kullanıcı verisi **hiçbir zaman** dışarı gitmez.

### 4.2 Dizin yapısı

```
app/
  _layout.tsx              # Root: tema + i18n + DB provider, ayarlar modalı
  ayarlar.tsx
  (tabs)/
    _layout.tsx            # NativeTabs (5 trigger)
    index.tsx              # Ana Sayfa
    konular/
      index.tsx            # TYT/AYT segment + ders listesi
      [dersId].tsx         # Konu listesi
      konu/[konuId].tsx    # Konu detayı (yıl grafiği + soru listesi)
    gelisim/
      index.tsx
      deneme/[id].tsx      # Deneme detay/düzenleme
      deneme/yeni.tsx
    tercih/
      index.tsx            # Net girişi + sonuç
      programlar.tsx       # Filtreli program listesi
      program/[id].tsx
    haberler/index.tsx
src/
  components/              # Ortak UI (Card, GlassSurface, SegmentedControl, ProgressRing, ...)
  features/                # konular/, gelisim/, tercih/, haberler/ — ekran mantığı
  data/                    # pack loader, updater, zod şemaları
  db/                      # drizzle şema + migration'lar
  scoring/                 # puan & sıralama motoru (saf fonksiyonlar, UI'sız)
  stores/                  # zustand
  i18n/                    # tr.json, en.json
  theme/                   # token'lar, useTheme
content/                   # pack kaynak JSON'ları (repo'da elle düzenlenir)
scripts/                   # build-pack.ts, validate-pack.ts, fetch-news.ts
assets/pack/               # gömülü (bundled) pack kopyası — build-pack üretir
```

---

## 5. Veri Modelleri

### 5.1 Content pack — `manifest.json`

```jsonc
{
  "packVersion": "2026.07.1",        // YYYY.AA.artan — string karşılaştırması yeterli
  "minAppVersion": "1.0.0",
  "examYear": 2027,                   // hedeflenen sınav
  "files": {
    "topics":       { "path": "topics.json",       "sha256": "..." },
    "coefficients": { "path": "coefficients.json", "sha256": "..." },
    "rankTables":   { "path": "rank-tables.json",  "sha256": "..." },
    "programs":     { "path": "programs.db",       "sha256": "...", "bytes": 9000000 },
    "calendar":     { "path": "calendar.json",     "sha256": "..." }
  }
}
```

### 5.2 `topics.json` — sınav → bölüm → ders → konu → yıl istatistikleri + soru meta

```jsonc
{
  "exams": [
    {
      "id": "tyt",
      "name": { "tr": "TYT", "en": "TYT" },
      "durationMin": 165,
      "totalQuestions": 120,
      "sections": [
        {
          "id": "tyt-turkce",
          "name": { "tr": "Türkçe", "en": "Turkish" },
          "questionCount": 40,
          "subjects": [
            {
              "id": "turkce",
              "name": { "tr": "Türkçe", "en": "Turkish" },
              "color": "#0D9488",              // UI'da ders rengi
              "icon": { "sf": "text.book.closed", "md": "menu_book" },
              "topics": [
                {
                  "id": "paragraf",
                  "name": { "tr": "Paragraf", "en": "Reading Comprehension" },
                  "grade": [9, 10, 11, 12],     // müfredat sınıfı
                  "yearlyStats": [
                    { "year": 2026, "count": 0, "verified": false },  // ⚠ PLACEHOLDER
                    { "year": 2025, "count": 0, "verified": false }
                    // ... 2018'e kadar
                  ],
                  "questions": [
                    {
                      "year": 2026,
                      "no": 12,                              // kitapçıktaki soru no (varsa)
                      "descriptor": {
                        "tr": "Ana düşünce — bilim konulu metin",
                        "en": "Main idea — science passage"
                      },
                      "kazanim": "Paragrafta konu ve ana düşünceyi belirler",
                      "difficulty": "orta",                  // kolay | orta | zor
                      "sourceUrl": "https://www.osym.gov.tr/TR,8834/cikmis-sorular.html"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

> ⚠ **Veri doldurma kuralı:** `count` ve `questions` alanları bu repoda placeholder olarak başlar
> (`verified: false`). Gerçek sayılar **yalnızca resmi kaynaklardan** doldurulur — ayrıntılı zorunlu
> akış için §9'daki **Veri Kaynakları ve Doğruluk Protokolü**'ne bak. Doğrulanan kayıt
> `verified: true` + `source` referansı alır. **Uygulama, `verified: false` veriyi "tahmini"
> rozetiyle gösterir.** Uydurma/ezbere istatistik asla `verified: true` işaretlenmez.

### 5.3 `coefficients.json` — puan hesabı katsayıları (koda gömme, veriye koy)

```jsonc
{
  "year": 2026,                      // hangi yılın verisine göre kalibre
  "base": 100,
  "obpMultiplier": 0.12,             // OBP katkısı: diploma notu × 5 × 0.12
  "scoreTypes": [
    { "id": "tyt", "name": { "tr": "TYT", "en": "TYT" },
      "netCoefficients": { "tyt-turkce": 3.32, "tyt-sosyal": 3.40, "tyt-matematik": 3.32, "tyt-fen": 3.40 } },
    { "id": "say", "name": { "tr": "Sayısal", "en": "Science" },
      "netCoefficients": { "tyt-turkce": 1.32, "tyt-sosyal": 1.36, "tyt-matematik": 1.32, "tyt-fen": 1.36,
                            "ayt-matematik": 3.00, "ayt-fizik": 2.85, "ayt-kimya": 3.07, "ayt-biyoloji": 3.07 } },
    { "id": "ea",  "...": "..." },
    { "id": "soz", "...": "..." }
  ]
}
```

> Katsayılar ÖSYM'nin standart sapma bazlı gerçek formülünün **yaklaşıklamasıdır**; her yıl açıklanan
> sonuç verileriyle yeniden kalibre edilir ve pack güncellemesiyle dağıtılır. Buradaki değerler örnektir —
> güncel yaygın yaklaşıklama katsayılarıyla doldurulacak. UI her yerde "tahmini" ibaresi taşır.

### 5.4 `rank-tables.json` — puan → sıralama dönüşümü

```jsonc
{
  "year": 2026,
  "tables": [
    { "scoreType": "say",
      "points": [ { "score": 560.0, "rank": 1000 }, { "score": 540.0, "rank": 3500 }, { "score": 500.0, "rank": 18000 } ] }
    // monoton azalan; ara değerler lineer interpolasyonla
  ]
}
```

### 5.5 `programs.db` (SQLite, önceden derlenmiş — YÖK Atlas kaynaklı)

~13.000 program × yıllar JSON için büyük; **hazır SQLite dosyası** olarak pack ile indirilir ve
doğrudan attach edilir.

```sql
CREATE TABLE program (
  id TEXT PRIMARY KEY,          -- YÖP kodu
  university TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  type TEXT NOT NULL,           -- devlet | vakif | kibris
  score_type TEXT NOT NULL,     -- say | ea | soz | dil | tyt
  scholarship TEXT,             -- burslu | %50 | ucretli | NULL
  language TEXT
);
CREATE TABLE program_year (
  program_id TEXT REFERENCES program(id),
  year INTEGER,
  quota INTEGER, placed INTEGER,
  min_score REAL, min_rank INTEGER,
  PRIMARY KEY (program_id, year)
);
-- program.latest_min_rank_sort: build-time materyalize sıralama anahtarı — en güncel
-- yayınlanabilir SIRALI yılın min_rank'i; sırasız programlarda 99999999 sentineli.
-- Liste sorgusu `ORDER BY latest_min_rank_sort, id` ile bu indeksi kullanır (TEMP
-- B-TREE yok); gerçek DDL scripts/build-programs.ts'tedir (source of truth).
CREATE INDEX ix_program_sort ON program(score_type, latest_min_rank_sort, id);
```

Kaynak: YÖK Atlas'ın kamuya açık verileri (`yokatlas.yok.gov.tr`). Derleme `scripts/` altında yapılır;
uygulama içinde scraping **yapılmaz**. Ekranda "Kaynak: YÖK Atlas" atfı gösterilir.

### 5.6 `calendar.json` ve `news.json`

```jsonc
// calendar.json — resmi tarihler
[ { "id": "yks27-basvuru", "start": "2027-02-04", "end": "2027-03-03",
    "type": "basvuru", "title": { "tr": "YKS başvuruları", "en": "YKS applications" } } ]

// news.json — GitHub Action üretir (§9)
[ { "id": "sha1...", "ts": "2026-07-13T09:30:00+03:00", "source": "ÖSYM",
    "title": "…", "url": "https://…", "summary": "…" } ]
```

### 5.7 Cihazdaki kullanıcı verisi (drizzle/SQLite)

```sql
CREATE TABLE topic_progress (
  topic_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'none',   -- none | working | done
  confidence INTEGER,                     -- 1..5 (öz değerlendirme)
  updated_at INTEGER NOT NULL
);
CREATE TABLE deneme (
  id TEXT PRIMARY KEY, date INTEGER NOT NULL,
  exam TEXT NOT NULL,                     -- tyt | ayt
  publisher TEXT, notes TEXT
);
CREATE TABLE deneme_net (
  deneme_id TEXT REFERENCES deneme(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,               -- tyt-matematik, ayt-fizik, ...
  correct INTEGER NOT NULL, wrong INTEGER NOT NULL, blank INTEGER NOT NULL,
  PRIMARY KEY (deneme_id, section_id)
);
CREATE TABLE favorite_program (
  program_id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, added_at INTEGER NOT NULL
);
```

MMKV: `{ language, theme, examYear, targetScoreType, diplomaNote, notificationPrefs, lastPackCheckTs }`

**Yedekleme:** tüm kullanıcı tabloları + MMKV → tek JSON dosyası (`yks-yedek-2026-07-14.json`),
`expo-sharing` ile dışa aktar; import'ta zod doğrulaması + versiyon migration.

---

## 6. Ekran Spesifikasyonları

Ortak kurallar: her liste ekranının **boş durumu** (illüstrasyon + tek cümle + CTA) tasarlanır;
tüm sayılar TR locale ile formatlanır (`1.234,5`); tarih/saat `Europe/Istanbul`; her ekran koyu/açık
temada test edilir; dokunma hedefleri ≥ 44pt; Dynamic Type'a saygı.

### 6.1 Ana Sayfa
- **Geri sayım kartı** (marka gradyanı): "YKS {yıl}" + kalan gün büyük; altında TYT/AYT tarihleri.
  Kaynak: `calendar.json`. Sınav geçtiyse bir sonraki yıla otomatik döner.
- **Seri (streak):** üst üste uygulamaya girip ilerleme/deneme kaydı yapılan gün sayısı. Abartısız —
  sadece sayı + alev ikonu.
- **Konu ilerlemesi özeti:** TYT ve AYT için iki progress bar (tamamlanan konu / toplam).
- **Son deneme kartı:** tarih + toplam net + önceki denemeye göre fark (▲/▼).
- **Yaklaşan tarih:** takvimden en yakın kayıt ("Tercihler 24 Tem'de başlıyor").
- Boş durumlar: hiç deneme yoksa "İlk denemeni ekle" CTA'sı.

### 6.2 Konular
- Üstte **TYT / AYT** segment kontrolü (glass yüzey).
- Ders kartları: ikon + ad + sınavdaki soru sayısı + konu ilerleme yüzdesi (ring).
  AYT'de bölüm bilgisi görünür (ör. Tarih-1: 10, Tarih-2: 11).
- **Ders ekranı:** konu listesi; her satırda konu adı, son sınav yılındaki soru sayısı rozeti,
  durum noktası (gri/sarı/yeşil), mini trend (son 5 yılın sparkline'ı).
  Sıralama seçenekleri: müfredat sırası · en çok soru çıkan · tamamlanmamışlar önce.
- **Konu detayı:**
  - Yıllara göre soru sayısı **bar chart** (2018→son yıl). `verified:false` yıllar soluk +
    "tahmini" rozetli.
  - Durum seçici: `Başlamadım / Çalışıyorum / Bitti` + 1-5 güven yıldızı.
  - **Çıkmış sorular listesi:** yıl rozeti + descriptor + zorluk noktası; satıra dokununca
    kaynak (ÖSYM PDF sayfası) dış tarayıcıda açılır. Soru metni gösterilmez (§11).
  - Kazanım listesi (katlanabilir).

### 6.3 Gelişim
- Üstte dönem filtresi (Son 5 / 10 / tümü) + TYT/AYT segmenti.
- **Net grafiği:** deneme başına toplam net line chart; hedef net çizgisi (ayarlardan).
- **Ders kırılımı:** son N denemenin ders bazlı ortalama neti; en zayıf 3 ders vurgulu.
- **Konu ısı haritası (v1.1):** yanlış işaretlenen konuların yoğunluğu.
- **Deneme listesi:** tarih, yayınevi, toplam net, fark. Kaydırma ile sil (onaylı).
- **Deneme girişi:** sınav türü seç → bölüm bölüm D/Y/B girişi (numpad, otomatik net hesabı,
  D+Y+B ≤ bölüm soru sayısı doğrulaması) → kaydet. Düzenlenebilir.

### 6.4 Tercih Simülatörü
- **Girdi:** puan türü seç (SAY/EA/SÖZ) → ilgili bölümlerin net alanları (deneme ortalamasından
  "doldur" kısayolu) + diploma notu (50-100).
- **Sonuç kartı:** Tahmini puan (OBP dahil) + tahmini sıralama **aralık** olarak
  (ör. "≈ 24.000 – 29.000"; interpolasyon ± %10 bant). Her yerde "tahmindir" dipnotu.
- **Program listesi:** tahmini sıralamaya göre üç kova rozeti:
  `Güvenli` (taban sıralaması tahminden %20+ altta) · `Sınırda` (±%20) · `İddialı` (üstte).
  Satır: üniversite, bölüm, şehir, tür, son yıl taban puan/sıralama; detayda son 4 yıl tablosu +
  kontenjan. Filtreler: şehir, devlet/vakıf, burs, dil, bölüm adı arama.
- **Favoriler:** yıldızla, sürükle-sırala; favori listesi yedeğe dahil.
- Sıralama karşılaştırması **puan değil `min_rank` üzerinden** yapılır (yıllar arası puan enflasyonundan
  etkilenmez).

### 6.5 Haberler
- Üstte **takvim şeridi**: yaklaşan resmi tarihler yatay kartlar.
- Haber kartları: kaynak etiketi (ÖSYM/YÖK/Basın) + başlık + göreli zaman; dokununca dış tarayıcı/
  in-app browser (`expo-web-browser`).
- Çevrimdışıysa: son önbelleklenen liste + "çevrimdışı" bandı. Pull-to-refresh.

### 6.6 Ayarlar (modal)
Dil (Sistem/TR/EN) · Tema (Sistem/Açık/Koyu) · Sınav yılı · Hedef puan türü + hedef net ·
Diploma notu · Bildirimler (günlük hatırlatma saati, tarih uyarıları — hepsi local) ·
**Verini yedekle / Geri yükle** · İçeriği şimdi güncelle (pack versiyonu görünür) ·
Hakkında + feragat + kaynak atıfları + lisanslar.

---

## 7. Puan ve Sıralama Motoru (`src/scoring/` — saf, UI'sız, %100 test kapsamı)

```
net(section)        = doğru − yanlış / 4
hamPuan(type)       = base + Σ ( net(section) × coefficients[type][section] )
yerleştirmePuanı    = hamPuan + (diplomaNotu × 5) × obpMultiplier      // OBP = not × 5 (250–500)
tahminiSıralama     = interpolate(rankTable[type], yerleştirmePuanı)   // lineer, monoton
sıralamaAralığı     = [sıralama × 0.9, sıralama × 1.1]
```

Kurallar:
- Katsayılar **her zaman** content pack'ten okunur; koda sabit yazılmaz.
- TYT puanı 150'nin altındaysa AYT puanı hesaplansa da "baraj altı" uyarısı göster
  (baraj kuralları da pack'te tutulur — yıllara göre değişebilir).
- Golden testler: bilinen (net → puan) örnek setleriyle ±0.5 puan toleranslı doğrulama;
  uç durumlar: tüm boş, tüm yanlış, negatif net, diploma notu sınırları.

---

## 8. Sınav Yapısı (sabit referans — pack'teki `topics.json` bununla tutarlı olmalı)

**TYT — 120 soru, 165 dk:** Türkçe 40 · Sosyal 20 (Tarih 5, Coğrafya 5, Felsefe 5, Din Kültürü 5*) ·
Temel Matematik 40 (Mat ~31 + Geometri ~9) · Fen 20 (Fizik 7, Kimya 7, Biyoloji 6)

**AYT — 160 soru, 180 dk:**
- Türk Dili ve Edebiyatı–Sosyal-1: 40 (Edebiyat 24, Tarih-1 10, Coğrafya-1 6)
- Sosyal-2: 40 (Tarih-2 11, Coğrafya-2 11, Felsefe Grubu 12, Din Kültürü 6*)
- Matematik: 40 (Mat ~30 + Geometri ~10)
- Fen: 40 (Fizik 14, Kimya 13, Biyoloji 13)

\* Din Kültürü okumamışlar için ek Felsefe soruları — veri modelinde `altSubjectId` ile temsil et.

**Puan türleri:** SAY = TYT %40 + AYT(Mat+Fen) · EA = TYT + AYT(Mat+Edb+Tar1+Coğ1) ·
SÖZ = TYT + AYT(Edb+Sos1+Sos2) · (DİL/YDT kapsam dışı — backlog).

---

## 9. İçerik Tazeleme ve Haber Boru Hattı (sıfır maliyet)

1. **Pack yayını:** `content/` düzenlenir → PR → GitHub Action `validate-pack` (zod) →
   merge'de `build-pack` çıktıyı `gh-pages` dalına yayımlar. Uygulama
   `https://<kullanıcı>.github.io/<repo>/pack/manifest.json` adresini kontrol eder.
2. **Haberler:** GitHub Action **cron (6 saatte bir)** `scripts/fetch-news.ts` çalıştırır:
   ÖSYM duyuru sayfası + YÖK duyuruları + seçili eğitim RSS'leri → normalize → son 50 kayıt →
   `news.json` olarak Pages'e yazar. Uygulama sadece bu statik JSON'u çeker
   (cihazda scraping yok → kırılganlık ve hukuki risk uygulamaya taşınmaz).
3. **Yeni sınav yılı geçişi:** sınav yapıldıktan sonra pack'e yeni yılın `yearlyStats` +
   `questions` kayıtları ve yeni `rank-tables`/`programs` eklenir; uygulama güncellemesi gerekmez.

### 9.1 Veri Kaynakları ve Doğruluk Protokolü — ZORUNLU

Bu uygulamanın değeri verinin doğruluğudur. **Hiçbir sayı ezberden/LLM hafızasından/ikincil bir
siteden kopyalanarak yazılmaz.** Her veri tipinin tek yetkili (birincil) kaynağı vardır:

| Veri | Birincil kaynak (tek otorite) | Çapraz kontrol |
|---|---|---|
| Konu başına yıllık soru sayısı + soru meta | **ÖSYM temel soru kitapçıkları** — osym.gov.tr → Sınavlar → YKS → "Çıkmış Sorular / Temel Soru Kitapçıkları ve Cevap Anahtarları" (her yılın TYT/AYT PDF'leri, soru soru sayılır) | Büyük yayınevlerinin konu analiz tabloları (yalnız kontrol; çelişkide **kitapçık kazanır**) |
| Sınav yapısı, oturum süreleri, baraj kuralları | **ÖSYM YKS Kılavuzu** (her yıl yayımlanır) | — |
| Puan katsayıları kalibrasyonu | **ÖSYM "YKS Değerlendirme / Sayısal Bilgiler" raporları** + açıklanan min-max puanlar | Bilinen gerçek (net → puan) örnekleriyle golden test |
| Puan → sıralama tabloları | **ÖSYM'nin yıllık puan dağılım / sayısal bilgi tabloları** | — |
| Program taban puan/sıralama/kontenjan | **YÖK Atlas** (yokatlas.yok.gov.tr) | ÖSYM yerleştirme sonuç kılavuz ekleri |
| Sınav/başvuru/tercih tarihleri | **ÖSYM sınav takvimi** sayfası | — |
| Haberler/duyurular | **ÖSYM + YÖK duyuru sayfaları** (birincil), seçili basın RSS (ikincil, "Basın" etiketiyle) | — |

**Zorunlu akış (her veri girişinde):**
1. Birincil kaynaktan oku (PDF/sayfa linkini kaydet).
2. `content/`e gir; kayda `source` (kaynak referansı/URL) + `verified: true` + doğrulama tarihi yaz.
   Kaynağı olmayan kayıt `verified: false` kalır ve UI'da "tahmini" rozetiyle gösterilir.
3. CI `validate-pack` **tutarlılık kontrolleri** (şema doğrulamasına ek — otomatik, her PR'da):
   - Her yıl için bir bölümdeki konu `count` toplamı = bölümün `questionCount`'u
     (ör. TYT Matematik konu sayıları toplamı 40 olmalı; değilse build kırılır).
   - `questions` dizisindeki kayıt sayısı ≤ o yılın `count` değeri.
   - `rank-tables` monoton (puan artarken sıralama küçülür); `programs` yıl kayıtlarında
     `min_rank`/`min_score` boş veya pozitif.
   - Her `verified: true` kayıtta `source` alanı dolu; yoksa build kırılır.
4. Yayınevi analiziyle çelişki varsa kitapçıktan yeniden sayılır; karar `content/CHANGELOG.md`e not düşülür.

**Tazelik:** sınav sonrası (Haziran) ve yerleştirme sonrası (Ağustos–Eylül, YÖK Atlas güncellenince)
olmak üzere yılda en az iki büyük pack güncellemesi planlanır; takvim/haber zaten sürekli akar.

---

## 10. Tasarım Sistemi (detaylı mockup: `designs/tasarim.html`)

### Renk token'ları

| Token | Açık | Koyu | Kullanım |
|---|---|---|---|
| `brand` | `#4F46E5` | `#818CF8` | Ana vurgu, geri sayım gradyanı |
| `tyt` | `#0D9488` | `#2DD4BF` | TYT'ye ait her şey |
| `ayt` | `#7C3AED` | `#A78BFA` | AYT'ye ait her şey |
| `success / warning / danger` | `#16A34A / #D97706 / #DC2626` | `#4ADE80 / #FBBF24 / #F87171` | durum/rozet |
| `bg` | `#F2F2F7` | `#000000` | iOS system grouped background |
| `surface` | `#FFFFFF` | `#1C1C1E` | kartlar |
| `label / secondaryLabel` | `#111113 / #6E6E73` | `#F2F2F7 / #98989F` | metin |

### Kurallar
- **Tipografi:** sistem fontu (SF Pro / Roboto). iOS ölçeği: LargeTitle 34 · Title2 22 ·
  Headline 17 semibold · Body 17 · Subhead 15 · Footnote 13 · Caption 11.
- **Glass kullanımı:** yalnızca *yüzen/katmanlı* öğelerde — tab bar (native zaten glass), segment
  kontrol, yüzen aksiyon alanları. İçerik kartları **düz surface** kalır (okunabilirlik).
  `isLiquidGlassAvailable() === false` → `expo-blur` yumuşak fallback; reduce-transparency açıksa düz yüzey.
- **Android:** aynı token'lar Material 3 yüzeylerine eşlenir; tab bar Material bottom nav;
  köşe yarıçapları M3 ölçeğine (12/16/28) yuvarlanır. Dynamic Color (Material You) v1.1 backlog.
- Radius: kart 16 · buton 12 · sheet 24 (iOS continuous corner). Spacing: 4'ün katları (4/8/12/16/24).

---

## 11. Hukuki ve Etik Sınırlar (uygulama içinde "Hakkında"da da yer alır)

1. **ÖSYM soruları teliflidir** → uygulamada soru metni/görseli yok; yalnızca istatistik + meta veri +
   ÖSYM'nin kendi sayfasına link.
2. **YÖK Atlas verisi** kaynak atfıyla kullanılır; uygulama resmi bir ÖSYM/YÖK ürünü değildir —
   bunu açıkça yazan feragat metni.
3. Puan/sıralama çıktıları **tahmindir**; "tercihlerinizi yalnızca bu uygulamaya dayanarak yapmayın"
   uyarısı simülatör ekranında kalıcıdır.
4. Kişisel veri cihaz dışına çıkmaz → gizlilik politikası tek paragraf; analytics/tracking **yok**.

---

## 12. Kalite Standartları ve Edge-Case'ler

- **Pack güncellemesi yarıda kesilirse** eski pack bozulmamalı (indir → doğrula → atomik değiştir).
- **Şema evrimi:** pack'te `schemaVersion`; uygulama bilmediği major versiyonu reddeder, gömülüsüyle çalışır.
- **Cihaz değişimi:** export/import akışı ilk sürümde var (yoksa kullanıcı verisi kaybolur — kabul edilemez).
- **Yıl geçişi:** sınav tarihi geçince geri sayım/istatistikler otomatik yeni yıla döner.
- **Deneme girişi doğrulaması:** D+Y+B bölüm soru sayısını aşamaz; negatif olamaz.
- **Erişilebilirlik:** VoiceOver/TalkBack etiketleri, Dynamic Type, reduce-transparency, kontrast ≥ 4.5:1.
- **Performans:** konu listeleri FlashList; programs sorguları indeksli; grafikler Skia.
- Türkçe karakter içeren aramalar locale-aware (`toLocaleLowerCase('tr')` — ı/İ tuzağı).

---

## 13. Yol Haritası — Fazlar (her biri ayrı oturumda implemente edilebilir)

### Faz 0 — İskelet
Expo SDK 55 + TS strict + expo-router; `NativeTabs` ile 5 tab (SF + Material ikonlar); tema
altyapısı (token'lar + sistem/açık/koyu); i18n (tr/en, cihaz dilinden başlangıç); MMKV ayar store'u;
ayarlar modalında dil+tema değişimi çalışır; ESLint/Prettier; jest kurulu.
**Kabul:** iOS ve Android'de native tab bar; dil ve tema anında değişiyor; `npx tsc --noEmit` temiz.

### Faz 1 — Content pack + Konular tabı
zod şemaları; `content/topics.json` **Ek A'daki tam taksonomiyle** (sayılar placeholder,
`verified:false`); `scripts/build-pack.ts` + `validate-pack` CI; pack loader (gömülü → FileSystem →
uzaktan güncelleme); Konular tabının 3 ekranı (§6.2) + `topic_progress` tablosu ve durum işaretleme.
**Kabul:** TYT+AYT tüm dersler/konular geziliyor; durum işaretleme kalıcı; uçak modunda tam çalışıyor;
pack versiyon güncellemesi test edildi; §9.1'deki tutarlılık kontrolleri CI'da çalışıyor (bilerek
bozuk bir örnekle kırıldığı doğrulandı).

### Faz 2 — Gelişim tabı
drizzle şemaları (`deneme`, `deneme_net`); deneme giriş akışı (doğrulamalı); net/ders grafikleri
(victory-native); Ana Sayfa gerçek verilere bağlanır (geri sayım, streak, son deneme, ilerleme).
**Kabul:** deneme CRUD + grafikler; giriş doğrulama uç durumları testli; Ana Sayfa canlı.

### Faz 3 — Puan motoru + Tercih
`src/scoring/` golden testlerle; `coefficients.json` + `rank-tables.json`; `programs.db` derleme
scripti (küçük örnek veriyle başla, ~100 program); Tercih tabının 3 ekranı (§6.4) + favoriler.
**Kabul:** net→puan→sıralama→kovalı liste uçtan uca; scoring test kapsamı %100; filtreler ve
favori sıralama çalışıyor; "tahmindir" uyarıları yerinde.

### Faz 4 — Haberler + takvim + bildirimler
`fetch-news.ts` + cron Action; Haberler tabı (önbellek + pull-to-refresh + çevrimdışı bandı);
takvim şeridi; local bildirimler (günlük hatırlatma + tarih uyarıları).
**Kabul:** Action, Pages'e `news.json` yazıyor; uygulama çevrimdışı son listeyi gösteriyor;
bildirim izin akışı iki platformda doğru.

### Faz 5 — Cila + yayın hazırlığı
Yedekle/geri yükle; boş durum illüstrasyonları; `GlassView` dokunuşları + fallback'ler; haptics;
erişilebilirlik taraması; app icon/splash; store metinleri (TR/EN); gizlilik politikası + feragat;
lokal release build'ler.
**Kabul:** export→silme→import kayıpsız; VoiceOver/TalkBack ile ana akışlar kullanılabilir;
iki platformda release build alınıyor.

### Backlog (v1.x)
YDT/DİL desteği · konu ısı haritası · yanlış defteri (soru künyesiyle) · pomodoro/çalışma süresi ·
widget'lar (iOS WidgetKit geri sayım) · Material You dynamic color · iPad düzeni ·
deneme fotoğrafından D/Y/B okuma (on-device).

---

## Ek A — Konu Taksonomisi (tam liste; `topics.json` bunu birebir izler)

> ID'ler kebab-case slug (ör. `sozcukte-anlam`). Sayılar placeholder ile başlar; §5.2'deki
> doğrulama kuralı geçerli.

### TYT

**Türkçe (40):** Sözcükte Anlam · Söz Yorumu · Deyim ve Atasözü · Cümlede Anlam · Paragraf (Anlatım
Teknikleri, Düşünceyi Geliştirme Yolları, Yapı, Konu–Ana Düşünce, Yardımcı Düşünce) · Ses Bilgisi ·
Yazım Kuralları · Noktalama İşaretleri · Sözcükte Yapı ve Ekler · Sözcük Türleri (İsim, Sıfat, Zamir,
Zarf, Edat–Bağlaç–Ünlem) · Fiiller (Fiilde Anlam, Ek Fiil, Fiilimsi, Fiil Çatısı) · Cümlenin Ögeleri ·
Cümle Türleri · Anlatım Bozukluğu

**Matematik (~31):** Temel Kavramlar · Sayı Basamakları · Bölme ve Bölünebilme · EBOB–EKOK ·
Rasyonel Sayılar · Basit Eşitsizlikler · Mutlak Değer · Üslü Sayılar · Köklü Sayılar · Çarpanlara
Ayırma · Oran–Orantı · Denklem Çözme · Problemler (Sayı, Kesir, Yaş, Hız, İşçi, Yüzde, Kâr–Zarar,
Karışım, Grafik, Rutin Olmayan) · Kümeler · Mantık · Fonksiyonlar · 2. Dereceden Denklemler ·
Permütasyon–Kombinasyon · Olasılık · Veri–İstatistik

**Geometri (~9):** Doğruda Açılar · Üçgende Açılar · Özel Üçgenler · Açıortay–Kenarortay · Üçgende
Alan · Benzerlik · Açı–Kenar Bağıntıları · Çokgenler · Dörtgenler (Yamuk, Paralelkenar, Eşkenar
Dörtgen, Dikdörtgen, Kare, Deltoid) · Çember ve Daire · Analitik Geometri (Nokta, Doğru) · Katı
Cisimler (Prizma, Piramit, Silindir, Koni, Küre)

**Tarih (5):** Tarih ve Zaman · İnsanlığın İlk Dönemleri · Orta Çağ'da Dünya · İlk ve Orta Çağlarda
Türk Dünyası · İslam Medeniyetinin Doğuşu · İlk Türk İslam Devletleri · Selçuklu Türkiyesi ·
Beylikten Devlete Osmanlı · Dünya Gücü Osmanlı · Osmanlı Merkez Teşkilatı ve Toplum Düzeni ·
Değişen Dünya Dengeleri ve Osmanlı · Uluslararası İlişkilerde Denge · Devrimler Çağı · Sermaye ve
Emek · XX. Yüzyıl Başında Osmanlı ve Dünya · Millî Mücadele · Atatürkçülük ve Türk İnkılabı

**Coğrafya (5):** Doğa ve İnsan · Dünya'nın Şekli ve Hareketleri · Coğrafi Konum · Harita Bilgisi ·
Atmosfer ve Sıcaklık · İklim Tipleri · Basınç ve Rüzgârlar · Nem–Yağış · İç ve Dış Kuvvetler ·
Su–Toprak–Bitki · Nüfus ve Göç · Yerleşme · Türkiye'nin Yer Şekilleri · Ekonomik Faaliyetler ·
Bölgeler ve Ülkeler · Doğal Afetler · Çevre ve Toplum

**Felsefe (5):** Felsefeyi Tanıma · Bilgi Felsefesi · Varlık Felsefesi · Ahlak Felsefesi · Sanat
Felsefesi · Din Felsefesi · Siyaset Felsefesi · Bilim Felsefesi

**Din Kültürü (5):** Bilgi ve İnanç · İslam ve İbadet · Ahlak ve Değerler · Din–Kültür–Medeniyet ·
Hz. Muhammed · Vahiy ve Akıl · İslam Düşüncesinde Yorumlar · Din ve Hayat

**Fizik (7):** Fizik Bilimine Giriş · Madde ve Özellikleri · Basınç · Kaldırma Kuvveti · Isı,
Sıcaklık ve Genleşme · Hareket ve Kuvvet · Dinamik · İş, Güç ve Enerji · Elektrostatik · Elektrik
Devreleri · Manyetizma · Dalgalar · Optik

**Kimya (7):** Kimya Bilimi · Atom ve Periyodik Sistem · Kimyasal Türler Arası Etkileşimler ·
Maddenin Hâlleri · Kimyanın Temel Kanunları · Kimyasal Hesaplamalar (Mol) · Karışımlar ·
Asit–Baz–Tuz · Doğa ve Kimya · Kimya Her Yerde

**Biyoloji (6):** Canlıların Ortak Özellikleri · Canlıların Temel Bileşenleri · Hücre ve Organeller ·
Madde Geçişleri · Canlıların Sınıflandırılması · Hücre Bölünmeleri (Mitoz–Mayoz) · Üreme · Kalıtım ·
Ekosistem Ekolojisi · Güncel Çevre Sorunları

### AYT

**Matematik (~30):** Fonksiyonlar · Polinomlar · 2. Dereceden Denklem ve Eşitsizlikler · Karmaşık
Sayılar · Parabol · Trigonometri · Logaritma · Diziler · Limit ve Süreklilik · Türev · İntegral ·
Permütasyon–Kombinasyon–Binom · Olasılık

**Geometri (~10):** TYT geometri konuları ileri düzey + Çemberin Analitik İncelenmesi · Dönüşüm
Geometrisi · Uzay Geometri

**Fizik (14):** Vektörler · Kuvvet–Tork–Denge · Kütle Merkezi · Basit Makineler · Bağıl Hareket ·
Newton'un Hareket Yasaları · Atışlar · İş–Güç–Enerji II · İtme ve Momentum · Elektrik Alan ve
Potansiyel · Paralel Levhalar ve Sığa · Manyetik Alan ve Kuvvet · İndüksiyon ve Alternatif Akım ·
Transformatörler · Çembersel Hareket · Kütle Çekimi ve Kepler · Basit Harmonik Hareket · Dalga
Mekaniği · Atom Fiziği ve Radyoaktivite · Modern Fizik · Modern Fiziğin Teknolojideki Uygulamaları

**Kimya (13):** Modern Atom Teorisi · Gazlar · Sıvı Çözeltiler ve Çözünürlük · Kimyasal Tepkimelerde
Enerji · Tepkime Hızı · Kimyasal Denge · Asit–Baz Dengesi · Çözünürlük Dengesi · Elektrokimya ·
Karbon Kimyasına Giriş · Organik Bileşikler (Hidrokarbonlar, Alkoller–Eterler, Aldehit–Keton,
Karboksilik Asitler, Esterler) · Enerji Kaynakları ve Bilimsel Gelişmeler

**Biyoloji (13):** Sinir Sistemi · Endokrin Sistem · Duyu Organları · Destek ve Hareket · Sindirim ·
Dolaşım ve Bağışıklık · Solunum · Boşaltım · Üreme ve Embriyonik Gelişim · Komünite ve Popülasyon
Ekolojisi · Genden Proteine (Nükleik Asitler, Protein Sentezi) · Canlılarda Enerji Dönüşümleri
(Fotosentez, Solunum) · Bitki Biyolojisi · Canlılar ve Çevre

**Edebiyat (24):** Anlam Bilgisi · Edebî Sanatlar · Şiir Bilgisi (Nazım Biçimi, Ölçü, Uyak) ·
İslamiyet Öncesi Türk Edebiyatı ve Geçiş Dönemi · Halk Edebiyatı (Anonim, Âşık, Dinî–Tasavvufi) ·
Divan Edebiyatı · Tanzimat · Servetifünun · Fecriati · Millî Edebiyat · Cumhuriyet Dönemi (Şiir,
Roman–Hikâye, Tiyatro, Öğretici Metinler) · Edebiyat Akımları · Dünya Edebiyatı

**Tarih-1 (10) / Tarih-2 (11):** TYT tarih taksonomisinin tamamı + İki Savaş Arası Dönem · II. Dünya
Savaşı · Soğuk Savaş · Yumuşama Dönemi · Küreselleşen Dünya (Çağdaş Türk ve Dünya Tarihi)

**Coğrafya-1 (6) / Coğrafya-2 (11):** Ekosistem ve Madde Döngüleri · Nüfus Politikaları · Şehirleşme ·
Göç ve Ekonomi · Türkiye Ekonomisi · Bölgesel Kalkınma Projeleri · Hizmet Sektörü · Ulaşım ve
Ticaret · Küresel Ortam: Bölgeler ve Ülkeler · Doğal Kaynaklar ve Enerji · Çevre Sorunları ve
Politikaları

**Felsefe Grubu (12):** Felsefe Tarihi (MÖ 6.–MS 2. yy · MS 2.–15. yy · 15.–17. yy · 18.–19. yy ·
20. yy) · Psikoloji (Psikoloji Bilimi, Öğrenme–Bellek–Düşünme, Ruh Sağlığı) · Sosyoloji (Giriş,
Birey ve Toplum, Toplumsal Yapı ve Değişme, Kültür, Kurumlar) · Mantık (Giriş, Klasik Mantık,
Sembolik Mantık)

**Din Kültürü (6):** Dünya ve Ahiret · Kur'an'a Göre Hz. Muhammed · Kur'an'da Bazı Kavramlar ·
İnançla İlgili Meseleler · İslam ve Bilim · Anadolu'da İslam · Güncel Dinî Meseleler
