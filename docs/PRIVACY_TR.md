# YKS Hazırlık Gizlilik Politikası

## Toplanan veriler

YKS Hazırlık hesap, reklam, analytics veya kullanıcı takibi kullanmaz. Geliştirici tarafından işletilen bir kullanıcı verisi sunucusu yoktur. Konu ilerlemesi, deneme sonuçları, favoriler ve ayarlar cihazdaki SQLite ve MMKV depolarında tutulur; uygulama tarafından bir geliştirici sunucusuna gönderilmez.

## Yedekleme ve veri kontrolü

Android otomatik bulut ve cihaz yedeklemesi kapalıdır. Veriler yalnız kullanıcı “Verini yedekle” işlemini açıkça başlattığında, kullanıcının seçtiği hedefe JSON dosyası olarak çıkar. Paylaşılan hedefteki harici kopyayı kullanıcı yönetir; uygulama bu kopyayı daha sonra uzaktan göremez veya silemez. Cihazdaki uygulama verileri Android ayarlarından temizlenerek ya da uygulama kaldırılarak silinebilir.

## İçerik ve ağ istekleri

Haber, takvim ve içerik güncellemeleri yalnız herkese açık statik dosyaları HTTPS üzerinden indirir; bu isteklere konu ilerlemesi, deneme sonucu, favori veya ayar verisi eklenmez. Barındırma sağlayıcısı GitHub Pages, normal web sunucuları gibi IP adresi, istek zamanı ve tarayıcı/cihaz bilgisi içeren standart teknik erişim kayıtları işleyebilir. Bu kayıtlar uygulama içi kullanıcı verileriyle birleştirilmez ve geliştirici tarafından kullanıcı profili oluşturmak için kullanılmaz.

## Bildirimler

Hatırlatmalar kullanıcı tercihiyle cihaz üzerinde yerel olarak zamanlanır. Uygulama bir push tokenını geliştirici tarafından işletilen bir sunucuya göndermez ve uzaktan kişisel bildirim içeriği göndermez. Bildirim izni yalnız kullanıcı bildirim özelliğini açtığında istenir.

## Çocuklar ve genç kullanıcılar

Uygulama eğitim amaçlıdır ve hesap, reklam, davranışsal profilleme veya geliştirici sunucusuna kişisel veri aktarımı içermez. Ebeveynler ve kullanıcılar cihazdaki verileri Android ayarlarından yönetebilir.

## Bağımsızlık bildirimi

YKS Hazırlık resmî bir ÖSYM veya YÖK ürünü değildir. Resmî kaynak bağlantıları yalnız bilgilendirme amacıyla sunulur.

## İletişim

Gizlilik ve destek talepleri: [sinanmertsener9@gmail.com](mailto:sinanmertsener9@gmail.com)

Public policy: <https://sinanmertsenerr.github.io/YKSHazirlikTakvimi/privacy.html>

Son güncelleme: 19 Temmuz 2026
