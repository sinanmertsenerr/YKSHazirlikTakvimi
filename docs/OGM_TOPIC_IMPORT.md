# OGM YKS konu kaynağı denetimi

`content/ogm-yks-topic-sources.json`, OGM Materyal'in 2018-2025 YKS çıkmış soru
derlemeleri için yalnız kaynak/provenans kaydıdır. Altı TYT/AYT kaynağı denetime dahildir;
YDT, mevcut konu taksonomisinin dışında olduğu için açıkça hariç tutulur.

Bu katman soru metni, görseli veya konu eşlemesi yayımlamaz. Varsayılan komut salt okunur
bir ağ denetimidir:

```sh
npx tsx scripts/sync-ogm-topic-books.ts
```

Yalnız şemayı çevrimdışı doğrulamak için `--validate-only` kullanılabilir. İndirme sırasında
yalnız geçici, izinleri kısıtlı dosyalar oluşturulur ve başarı/hata durumunda silinir. HTTPS,
host allowlist'i, yönlendirme sınırı, zaman aşımı, `Content-Length`, akış boyutu, PDF imzası,
içerik türü, byte uzunluğu ve SHA-256 birlikte doğrulanır. Herhangi bir boyut/hash değişimi
kapalı durumda hata verir; komut registry'yi güncellemez. Upstream değişiklik ancak resmî
kaynak manuel incelendikten ve registry değişikliği normal kod incelemesinden geçtikten sonra
kabul edilebilir.
