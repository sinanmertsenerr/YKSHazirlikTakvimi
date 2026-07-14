# YKS Hazırlık

YKS Hazırlık, TYT ve AYT öğrencileri için hesap gerektirmeyen, offline-first bir Expo/React Native uygulamasıdır. Konu takibi, deneme CRUD ve net grafikleri, resmî YÖK Atlas program verileri, resmî takvim bağlantıları, yerel bildirimler ve cihazlar arası JSON yedeği aynı uygulamada bulunur. Doğrulanabilir bir kişisel model bulunmadığı sürece puan ve sıralama tahmini sunulmaz.

## Teknoloji

- Expo SDK 57, React Native 0.86, TypeScript strict ve Expo Router Native Tabs
- iOS Liquid Glass; eski iOS için blur, Reduce Transparency ve Android için opak/Material fallback
- MMKV ayarları; Expo SQLite + Drizzle şemalı kullanıcı verisi ve ayrı bundled program veritabanı
- Zustand, i18next, Zod, Victory Native/Skia, FlashList ve local Expo Notifications
- GitHub Actions ile doğrulanan ve GitHub Pages'e yayımlanan statik içerik paketi

## Yerel geliştirme

Node 22 LTS kullanın. MMKV ve native tabs nedeniyle Expo Go yerine development build gerekir.

```bash
nvm use
npm ci
npm run build:pack
npx expo prebuild
npx expo run:ios
# Android SDK kurulu bir makinede:
npx expo run:android
```

Günlük geliştirmede development build kurulduktan sonra `npm start` yeterlidir. `npm run web` yalnız hızlı görsel önizleme içindir; native tab, MMKV, bildirim ve glass kabul testinin yerine geçmez.

## Kalite kapıları

```bash
npm run validate:pack
npm run test:content
npm run test:coverage
npm run typecheck
npm run lint
npx expo install --check
npx expo-doctor
```

Content validator; kaynak ve doğrulama zamanı zorunluluğunu, null/gerçek sıfır ayrımını, bölüm-yıl toplamlarını, resmî puanlama kurallarının tam yüzde ağırlıklarını, sentetik puan/sıra noktalarının reddini ve pozitif program değerlerini test eder.

## İçerik doğruluğu

`content/` tek içerik kaynağıdır. Gerçek bir değer yalnızca birincil ÖSYM/YÖK kaynağı, doğrulama kaydı ve `verified:true` ile yayımlanabilir. Yıllık konu sayımları kaynaklı editöryal uzlaşı tamamlanana kadar `null` kalır; `0` yalnızca doğrulanmış gerçek sıfırdır. Puan hesaplama ve sıralama tablosu sentetik değer üretmek yerine `unavailable` durumundadır. Takvim, 11.444 lisans programı ve haber akışı resmî ÖSYM/YÖK kaynaklarından doğrulanır. ÖSYM soru metni veya görseli depoda ve uygulamada yer almaz.

```bash
npm run validate:pack
npm run build:pack
```

Build, `assets/pack/manifest.json` içinde her dosya için SHA-256 ve byte uzunluğu üretir. Uygulama uzaktaki yeni pack'i sürümlü staging klasöründe doğrular ve en son aktif sürüm pointer'ını değiştirir; bozuk veya yarım indirme mevcut paketi etkilemez.

## Veri ve gizlilik

Kullanıcı verisi yalnız cihazdaki SQLite/MMKV alanlarında kalır. Auth, analytics, tracking, push sunucusu veya kullanıcı verisi alan bir API yoktur. Haber/content istekleri salt okunur statik veridir. Ayrıntılar [Türkçe gizlilik politikası](docs/PRIVACY_TR.md) ve [English privacy policy](docs/PRIVACY_EN.md) içindedir.

## Dizinler

- `app/`: Expo Router ekranları ve beş native sekme
- `src/components/`: tasarım sistemi, glass fallback ve grafikler
- `src/data/`: gömülü/uzak pack şeması ve yükleyiciler
- `src/db/`: Drizzle şeması, SQLite repository ve program DB yükleyicisi
- `src/scoring/`: net hesabı ve girdi doğrulama yardımcıları
- `content/`: kaynak içerik JSON/SQLite fixture'ları
- `scripts/`: pack build, doğrulama, program DB ve haber pipeline'ı
- `assets/pack/`: uygulamayla gelen doğrulanmış offline pack
- `designs/`: orijinal tasarım referansı

## Hukuki not

Uygulama resmî bir ÖSYM/YÖK ürünü değildir. YÖK Atlas verileri kaynak atfıyla kullanılır. Uygulama tercih danışmanlığı sunmaz ve doğrulanmış model olmadan puan ya da sıralama tahmini üretmez.

Kod MIT lisansı altındadır. Üçüncü taraf veriler ve marka adları kendi hak sahiplerine aittir.
