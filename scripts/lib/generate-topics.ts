/**
 * SUPERSEDED (2026-07-15): content/topics.json is now generated from the official MEB groups by
 * scripts/build-topics-from-official.ts. The ids below are the PRE-MEB taxonomy, kept only as a
 * historical reference for content/topic-annotations/legacy-id-map.json.
 *
 * Deterministically materializes content/topics.json from PROMPT.md Appendix A.
 *
 * This is deliberately a catalog generator, not a source of question statistics.
 * Every yearly statistic starts as an unknown null placeholder and may only be
 * replaced after the official-source workflow documented in content/README.md.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CURRENT_SCHEMA_VERSION, topicCoverageYears } from './content-schemas.ts';

type LocalizedText = { tr: string; en: string };
type TopicSeed = readonly [id: string, tr: string, en: string];

type SubjectSeed = {
  id: string;
  name: LocalizedText;
  questionCount: number;
  countApproximate?: boolean;
  color: string;
  icon: { sf: string; md: string };
  altSubjectId?: string;
  topics: readonly TopicSeed[];
};

type SectionSeed = {
  id: string;
  name: LocalizedText;
  questionCount: number;
  subjects: readonly SubjectSeed[];
};

type ExamSeed = {
  id: 'tyt' | 'ayt';
  name: LocalizedText;
  durationMin: number;
  totalQuestions: number;
  sections: readonly SectionSeed[];
};

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');

const t = (id: string, tr: string, en: string): TopicSeed => [id, tr, en] as const;

const tytTurkce = [
  t('sozcukte-anlam', 'Sözcükte Anlam', 'Meaning in Words'),
  t('soz-yorumu', 'Söz Yorumu', 'Interpretation of Expressions'),
  t('deyim-ve-atasozu', 'Deyim ve Atasözü', 'Idioms and Proverbs'),
  t('cumlede-anlam', 'Cümlede Anlam', 'Meaning in Sentences'),
  t(
    'paragraf-anlatim-teknikleri',
    'Paragraf — Anlatım Teknikleri',
    'Paragraph — Narrative Techniques',
  ),
  t(
    'paragraf-dusunceyi-gelistirme-yollari',
    'Paragraf — Düşünceyi Geliştirme Yolları',
    'Paragraph — Methods of Developing Ideas',
  ),
  t('paragraf-yapi', 'Paragraf — Yapı', 'Paragraph — Structure'),
  t(
    'paragraf-konu-ana-dusunce',
    'Paragraf — Konu ve Ana Düşünce',
    'Paragraph — Topic and Main Idea',
  ),
  t('paragraf-yardimci-dusunce', 'Paragraf — Yardımcı Düşünce', 'Paragraph — Supporting Ideas'),
  t('ses-bilgisi', 'Ses Bilgisi', 'Phonology'),
  t('yazim-kurallari', 'Yazım Kuralları', 'Spelling Rules'),
  t('noktalama-isaretleri', 'Noktalama İşaretleri', 'Punctuation'),
  t('sozcukte-yapi-ve-ekler', 'Sözcükte Yapı ve Ekler', 'Word Structure and Affixes'),
  t('sozcuk-turleri-isim', 'Sözcük Türleri — İsim', 'Parts of Speech — Noun'),
  t('sozcuk-turleri-sifat', 'Sözcük Türleri — Sıfat', 'Parts of Speech — Adjective'),
  t('sozcuk-turleri-zamir', 'Sözcük Türleri — Zamir', 'Parts of Speech — Pronoun'),
  t('sozcuk-turleri-zarf', 'Sözcük Türleri — Zarf', 'Parts of Speech — Adverb'),
  t(
    'sozcuk-turleri-edat-baglac-unlem',
    'Sözcük Türleri — Edat, Bağlaç ve Ünlem',
    'Parts of Speech — Preposition, Conjunction and Interjection',
  ),
  t('fiilde-anlam', 'Fiiller — Fiilde Anlam', 'Verbs — Meaning'),
  t('ek-fiil', 'Fiiller — Ek Fiil', 'Verbs — Auxiliary Copula'),
  t('fiilimsi', 'Fiiller — Fiilimsi', 'Verbs — Verbals'),
  t('fiil-catisi', 'Fiiller — Fiil Çatısı', 'Verbs — Voice'),
  t('cumlenin-ogeleri', 'Cümlenin Ögeleri', 'Elements of the Sentence'),
  t('cumle-turleri', 'Cümle Türleri', 'Sentence Types'),
  t('anlatim-bozuklugu', 'Anlatım Bozukluğu', 'Expression Errors'),
] as const;

const tytMatematik = [
  t('temel-kavramlar', 'Temel Kavramlar', 'Basic Concepts'),
  t('sayi-basamaklari', 'Sayı Basamakları', 'Place Value'),
  t('bolme-ve-bolunebilme', 'Bölme ve Bölünebilme', 'Division and Divisibility'),
  t('ebob-ekok', 'EBOB–EKOK', 'GCD–LCM'),
  t('rasyonel-sayilar', 'Rasyonel Sayılar', 'Rational Numbers'),
  t('basit-esitsizlikler', 'Basit Eşitsizlikler', 'Basic Inequalities'),
  t('mutlak-deger', 'Mutlak Değer', 'Absolute Value'),
  t('uslu-sayilar', 'Üslü Sayılar', 'Exponents'),
  t('koklu-sayilar', 'Köklü Sayılar', 'Radicals'),
  t('carpanlara-ayirma', 'Çarpanlara Ayırma', 'Factorization'),
  t('oran-oranti', 'Oran–Orantı', 'Ratio and Proportion'),
  t('denklem-cozme', 'Denklem Çözme', 'Solving Equations'),
  t('problemler-sayi', 'Problemler — Sayı', 'Problems — Numbers'),
  t('problemler-kesir', 'Problemler — Kesir', 'Problems — Fractions'),
  t('problemler-yas', 'Problemler — Yaş', 'Problems — Age'),
  t('problemler-hiz', 'Problemler — Hız', 'Problems — Speed'),
  t('problemler-isci', 'Problemler — İşçi', 'Problems — Work Rate'),
  t('problemler-yuzde', 'Problemler — Yüzde', 'Problems — Percentages'),
  t('problemler-kar-zarar', 'Problemler — Kâr–Zarar', 'Problems — Profit and Loss'),
  t('problemler-karisim', 'Problemler — Karışım', 'Problems — Mixtures'),
  t('problemler-grafik', 'Problemler — Grafik', 'Problems — Graphs'),
  t('problemler-rutin-olmayan', 'Problemler — Rutin Olmayan', 'Problems — Non-routine'),
  t('kumeler', 'Kümeler', 'Sets'),
  t('mantik', 'Mantık', 'Logic'),
  t('fonksiyonlar', 'Fonksiyonlar', 'Functions'),
  t('ikinci-dereceden-denklemler', '2. Dereceden Denklemler', 'Quadratic Equations'),
  t('permutasyon-kombinasyon', 'Permütasyon–Kombinasyon', 'Permutations and Combinations'),
  t('olasilik', 'Olasılık', 'Probability'),
  t('veri-istatistik', 'Veri–İstatistik', 'Data and Statistics'),
] as const;

const tytGeometri = [
  t('dogruda-acilar', 'Doğruda Açılar', 'Angles on Lines'),
  t('ucgende-acilar', 'Üçgende Açılar', 'Angles in Triangles'),
  t('ozel-ucgenler', 'Özel Üçgenler', 'Special Triangles'),
  t('aciortay-kenarortay', 'Açıortay–Kenarortay', 'Angle Bisector and Median'),
  t('ucgende-alan', 'Üçgende Alan', 'Area of Triangles'),
  t('benzerlik', 'Benzerlik', 'Similarity'),
  t('aci-kenar-bagintilari', 'Açı–Kenar Bağıntıları', 'Angle–Side Relationships'),
  t('cokgenler', 'Çokgenler', 'Polygons'),
  t('dortgenler-yamuk', 'Dörtgenler — Yamuk', 'Quadrilaterals — Trapezoid'),
  t('dortgenler-paralelkenar', 'Dörtgenler — Paralelkenar', 'Quadrilaterals — Parallelogram'),
  t('dortgenler-eskenar-dortgen', 'Dörtgenler — Eşkenar Dörtgen', 'Quadrilaterals — Rhombus'),
  t('dortgenler-dikdortgen', 'Dörtgenler — Dikdörtgen', 'Quadrilaterals — Rectangle'),
  t('dortgenler-kare', 'Dörtgenler — Kare', 'Quadrilaterals — Square'),
  t('dortgenler-deltoid', 'Dörtgenler — Deltoid', 'Quadrilaterals — Kite'),
  t('cember-ve-daire', 'Çember ve Daire', 'Circle and Disk'),
  t('analitik-geometri-nokta', 'Analitik Geometri — Nokta', 'Analytic Geometry — Point'),
  t('analitik-geometri-dogru', 'Analitik Geometri — Doğru', 'Analytic Geometry — Line'),
  t('kati-cisimler-prizma', 'Katı Cisimler — Prizma', 'Solid Geometry — Prism'),
  t('kati-cisimler-piramit', 'Katı Cisimler — Piramit', 'Solid Geometry — Pyramid'),
  t('kati-cisimler-silindir', 'Katı Cisimler — Silindir', 'Solid Geometry — Cylinder'),
  t('kati-cisimler-koni', 'Katı Cisimler — Koni', 'Solid Geometry — Cone'),
  t('kati-cisimler-kure', 'Katı Cisimler — Küre', 'Solid Geometry — Sphere'),
] as const;

const tytTarih = [
  t('tarih-ve-zaman', 'Tarih ve Zaman', 'History and Time'),
  t('insanligin-ilk-donemleri', 'İnsanlığın İlk Dönemleri', 'Early Periods of Humanity'),
  t('orta-cagda-dunya', "Orta Çağ'da Dünya", 'The World in the Middle Ages'),
  t(
    'ilk-ve-orta-caglarda-turk-dunyasi',
    'İlk ve Orta Çağlarda Türk Dünyası',
    'The Turkic World in Antiquity and the Middle Ages',
  ),
  t(
    'islam-medeniyetinin-dogusu',
    'İslam Medeniyetinin Doğuşu',
    'The Birth of Islamic Civilization',
  ),
  t('ilk-turk-islam-devletleri', 'İlk Türk İslam Devletleri', 'Early Turkic-Islamic States'),
  t('selcuklu-turkiyesi', 'Selçuklu Türkiyesi', 'Seljuk Türkiye'),
  t(
    'beylikten-devlete-osmanli',
    'Beylikten Devlete Osmanlı',
    'The Ottomans: From Principality to State',
  ),
  t('dunya-gucu-osmanli', 'Dünya Gücü Osmanlı', 'The Ottoman Empire as a World Power'),
  t(
    'osmanli-merkez-teskilati-ve-toplum-duzeni',
    'Osmanlı Merkez Teşkilatı ve Toplum Düzeni',
    'Ottoman Central Administration and Social Order',
  ),
  t(
    'degisen-dunya-dengeleri-ve-osmanli',
    'Değişen Dünya Dengeleri ve Osmanlı',
    'Changing World Balances and the Ottomans',
  ),
  t(
    'uluslararasi-iliskilerde-denge',
    'Uluslararası İlişkilerde Denge',
    'Balance in International Relations',
  ),
  t('devrimler-cagi', 'Devrimler Çağı', 'Age of Revolutions'),
  t('sermaye-ve-emek', 'Sermaye ve Emek', 'Capital and Labor'),
  t(
    'yirminci-yuzyil-basinda-osmanli-ve-dunya',
    'XX. Yüzyıl Başında Osmanlı ve Dünya',
    'The Ottomans and the World at the Start of the 20th Century',
  ),
  t('milli-mucadele', 'Millî Mücadele', 'Turkish War of Independence'),
  t(
    'ataturkculuk-ve-turk-inkilabi',
    'Atatürkçülük ve Türk İnkılabı',
    "Atatürk's Principles and Turkish Reforms",
  ),
] as const;

const tytCografya = [
  t('doga-ve-insan', 'Doğa ve İnsan', 'Nature and Humans'),
  t(
    'dunyanin-sekli-ve-hareketleri',
    "Dünya'nın Şekli ve Hareketleri",
    "Earth's Shape and Movements",
  ),
  t('cografi-konum', 'Coğrafi Konum', 'Geographical Location'),
  t('harita-bilgisi', 'Harita Bilgisi', 'Map Knowledge'),
  t('atmosfer-ve-sicaklik', 'Atmosfer ve Sıcaklık', 'Atmosphere and Temperature'),
  t('iklim-tipleri', 'İklim Tipleri', 'Climate Types'),
  t('basinc-ve-ruzgarlar', 'Basınç ve Rüzgârlar', 'Pressure and Winds'),
  t('nem-yagis', 'Nem–Yağış', 'Humidity and Precipitation'),
  t('ic-ve-dis-kuvvetler', 'İç ve Dış Kuvvetler', 'Internal and External Forces'),
  t('su-toprak-bitki', 'Su–Toprak–Bitki', 'Water, Soil and Vegetation'),
  t('nufus-ve-goc', 'Nüfus ve Göç', 'Population and Migration'),
  t('yerlesme', 'Yerleşme', 'Settlement'),
  t('turkiyenin-yer-sekilleri', "Türkiye'nin Yer Şekilleri", "Türkiye's Landforms"),
  t('ekonomik-faaliyetler', 'Ekonomik Faaliyetler', 'Economic Activities'),
  t('bolgeler-ve-ulkeler', 'Bölgeler ve Ülkeler', 'Regions and Countries'),
  t('dogal-afetler', 'Doğal Afetler', 'Natural Disasters'),
  t('cevre-ve-toplum', 'Çevre ve Toplum', 'Environment and Society'),
] as const;

const tytFelsefe = [
  t('felsefeyi-tanima', 'Felsefeyi Tanıma', 'Introduction to Philosophy'),
  t('bilgi-felsefesi', 'Bilgi Felsefesi', 'Epistemology'),
  t('varlik-felsefesi', 'Varlık Felsefesi', 'Ontology'),
  t('ahlak-felsefesi', 'Ahlak Felsefesi', 'Ethics'),
  t('sanat-felsefesi', 'Sanat Felsefesi', 'Philosophy of Art'),
  t('din-felsefesi', 'Din Felsefesi', 'Philosophy of Religion'),
  t('siyaset-felsefesi', 'Siyaset Felsefesi', 'Political Philosophy'),
  t('bilim-felsefesi', 'Bilim Felsefesi', 'Philosophy of Science'),
] as const;

const tytDin = [
  t('bilgi-ve-inanc', 'Bilgi ve İnanç', 'Knowledge and Faith'),
  t('islam-ve-ibadet', 'İslam ve İbadet', 'Islam and Worship'),
  t('ahlak-ve-degerler', 'Ahlak ve Değerler', 'Morality and Values'),
  t('din-kultur-medeniyet', 'Din–Kültür–Medeniyet', 'Religion, Culture and Civilization'),
  t('hz-muhammed', 'Hz. Muhammed', 'Prophet Muhammad'),
  t('vahiy-ve-akil', 'Vahiy ve Akıl', 'Revelation and Reason'),
  t(
    'islam-dusuncesinde-yorumlar',
    'İslam Düşüncesinde Yorumlar',
    'Interpretations in Islamic Thought',
  ),
  t('din-ve-hayat', 'Din ve Hayat', 'Religion and Life'),
] as const;

const tytFizik = [
  t('fizik-bilimine-giris', 'Fizik Bilimine Giriş', 'Introduction to Physics'),
  t('madde-ve-ozellikleri', 'Madde ve Özellikleri', 'Matter and Its Properties'),
  t('basinc', 'Basınç', 'Pressure'),
  t('kaldirma-kuvveti', 'Kaldırma Kuvveti', 'Buoyant Force'),
  t('isi-sicaklik-ve-genlesme', 'Isı, Sıcaklık ve Genleşme', 'Heat, Temperature and Expansion'),
  t('hareket-ve-kuvvet', 'Hareket ve Kuvvet', 'Motion and Force'),
  t('dinamik', 'Dinamik', 'Dynamics'),
  t('is-guc-ve-enerji', 'İş, Güç ve Enerji', 'Work, Power and Energy'),
  t('elektrostatik', 'Elektrostatik', 'Electrostatics'),
  t('elektrik-devreleri', 'Elektrik Devreleri', 'Electric Circuits'),
  t('manyetizma', 'Manyetizma', 'Magnetism'),
  t('dalgalar', 'Dalgalar', 'Waves'),
  t('optik', 'Optik', 'Optics'),
] as const;

const tytKimya = [
  t('kimya-bilimi', 'Kimya Bilimi', 'Chemistry as a Science'),
  t('atom-ve-periyodik-sistem', 'Atom ve Periyodik Sistem', 'Atoms and the Periodic System'),
  t(
    'kimyasal-turler-arasi-etkilesimler',
    'Kimyasal Türler Arası Etkileşimler',
    'Interactions between Chemical Species',
  ),
  t('maddenin-halleri', 'Maddenin Hâlleri', 'States of Matter'),
  t('kimyanin-temel-kanunlari', 'Kimyanın Temel Kanunları', 'Fundamental Laws of Chemistry'),
  t('kimyasal-hesaplamalar-mol', 'Kimyasal Hesaplamalar — Mol', 'Chemical Calculations — Mole'),
  t('karisimlar', 'Karışımlar', 'Mixtures'),
  t('asit-baz-tuz', 'Asit–Baz–Tuz', 'Acids, Bases and Salts'),
  t('doga-ve-kimya', 'Doğa ve Kimya', 'Nature and Chemistry'),
  t('kimya-her-yerde', 'Kimya Her Yerde', 'Chemistry Everywhere'),
] as const;

const tytBiyoloji = [
  t(
    'canlilarin-ortak-ozellikleri',
    'Canlıların Ortak Özellikleri',
    'Common Characteristics of Living Things',
  ),
  t(
    'canlilarin-temel-bilesenleri',
    'Canlıların Temel Bileşenleri',
    'Basic Components of Living Things',
  ),
  t('hucre-ve-organeller', 'Hücre ve Organeller', 'Cells and Organelles'),
  t('madde-gecisleri', 'Madde Geçişleri', 'Transport across Membranes'),
  t(
    'canlilarin-siniflandirilmasi',
    'Canlıların Sınıflandırılması',
    'Classification of Living Things',
  ),
  t(
    'hucre-bolunmeleri-mitoz-mayoz',
    'Hücre Bölünmeleri — Mitoz ve Mayoz',
    'Cell Division — Mitosis and Meiosis',
  ),
  t('ureme', 'Üreme', 'Reproduction'),
  t('kalitim', 'Kalıtım', 'Heredity'),
  t('ekosistem-ekolojisi', 'Ekosistem Ekolojisi', 'Ecosystem Ecology'),
  t('guncel-cevre-sorunlari', 'Güncel Çevre Sorunları', 'Current Environmental Issues'),
] as const;

const aytMatematik = [
  t('ayt-fonksiyonlar', 'Fonksiyonlar', 'Functions'),
  t('ayt-polinomlar', 'Polinomlar', 'Polynomials'),
  t(
    'ayt-ikinci-dereceden-denklem-ve-esitsizlikler',
    '2. Dereceden Denklem ve Eşitsizlikler',
    'Quadratic Equations and Inequalities',
  ),
  t('ayt-karmasik-sayilar', 'Karmaşık Sayılar', 'Complex Numbers'),
  t('ayt-parabol', 'Parabol', 'Parabola'),
  t('ayt-trigonometri', 'Trigonometri', 'Trigonometry'),
  t('ayt-logaritma', 'Logaritma', 'Logarithms'),
  t('ayt-diziler', 'Diziler', 'Sequences'),
  t('ayt-limit-ve-sureklilik', 'Limit ve Süreklilik', 'Limits and Continuity'),
  t('ayt-turev', 'Türev', 'Derivatives'),
  t('ayt-integral', 'İntegral', 'Integrals'),
  t(
    'ayt-permutasyon-kombinasyon-binom',
    'Permütasyon–Kombinasyon–Binom',
    'Permutations, Combinations and Binomial Theorem',
  ),
  t('ayt-olasilik', 'Olasılık', 'Probability'),
] as const;

const aytGeometri = [
  ...tytGeometri.map(([id, tr, en]) => t(`ayt-${id}`, `${tr} — İleri Düzey`, `${en} — Advanced`)),
  t(
    'ayt-cemberin-analitik-incelenmesi',
    'Çemberin Analitik İncelenmesi',
    'Analytic Study of the Circle',
  ),
  t('ayt-donusum-geometrisi', 'Dönüşüm Geometrisi', 'Transformation Geometry'),
  t('ayt-uzay-geometri', 'Uzay Geometri', 'Spatial Geometry'),
] as const;

const aytFizik = [
  t('ayt-vektorler', 'Vektörler', 'Vectors'),
  t('ayt-kuvvet-tork-denge', 'Kuvvet–Tork–Denge', 'Force, Torque and Equilibrium'),
  t('ayt-kutle-merkezi', 'Kütle Merkezi', 'Center of Mass'),
  t('ayt-basit-makineler', 'Basit Makineler', 'Simple Machines'),
  t('ayt-bagil-hareket', 'Bağıl Hareket', 'Relative Motion'),
  t('ayt-newtonun-hareket-yasalari', "Newton'un Hareket Yasaları", "Newton's Laws of Motion"),
  t('ayt-atislar', 'Atışlar', 'Projectile Motion'),
  t('ayt-is-guc-enerji-ii', 'İş–Güç–Enerji II', 'Work, Power and Energy II'),
  t('ayt-itme-ve-momentum', 'İtme ve Momentum', 'Impulse and Momentum'),
  t(
    'ayt-elektrik-alan-ve-potansiyel',
    'Elektrik Alan ve Potansiyel',
    'Electric Field and Potential',
  ),
  t('ayt-paralel-levhalar-ve-siga', 'Paralel Levhalar ve Sığa', 'Parallel Plates and Capacitance'),
  t('ayt-manyetik-alan-ve-kuvvet', 'Manyetik Alan ve Kuvvet', 'Magnetic Field and Force'),
  t(
    'ayt-induksiyon-ve-alternatif-akim',
    'İndüksiyon ve Alternatif Akım',
    'Induction and Alternating Current',
  ),
  t('ayt-transformatorler', 'Transformatörler', 'Transformers'),
  t('ayt-cembersel-hareket', 'Çembersel Hareket', 'Circular Motion'),
  t('ayt-kutle-cekimi-ve-kepler', 'Kütle Çekimi ve Kepler', 'Gravitation and Kepler'),
  t('ayt-basit-harmonik-hareket', 'Basit Harmonik Hareket', 'Simple Harmonic Motion'),
  t('ayt-dalga-mekanigi', 'Dalga Mekaniği', 'Wave Mechanics'),
  t(
    'ayt-atom-fizigi-ve-radyoaktivite',
    'Atom Fiziği ve Radyoaktivite',
    'Atomic Physics and Radioactivity',
  ),
  t('ayt-modern-fizik', 'Modern Fizik', 'Modern Physics'),
  t(
    'ayt-modern-fizigin-teknolojideki-uygulamalari',
    'Modern Fiziğin Teknolojideki Uygulamaları',
    'Technological Applications of Modern Physics',
  ),
] as const;

const aytKimya = [
  t('ayt-modern-atom-teorisi', 'Modern Atom Teorisi', 'Modern Atomic Theory'),
  t('ayt-gazlar', 'Gazlar', 'Gases'),
  t(
    'ayt-sivi-cozeltiler-ve-cozunurluk',
    'Sıvı Çözeltiler ve Çözünürlük',
    'Liquid Solutions and Solubility',
  ),
  t(
    'ayt-kimyasal-tepkimelerde-enerji',
    'Kimyasal Tepkimelerde Enerji',
    'Energy in Chemical Reactions',
  ),
  t('ayt-tepkime-hizi', 'Tepkime Hızı', 'Reaction Rate'),
  t('ayt-kimyasal-denge', 'Kimyasal Denge', 'Chemical Equilibrium'),
  t('ayt-asit-baz-dengesi', 'Asit–Baz Dengesi', 'Acid–Base Equilibrium'),
  t('ayt-cozunurluk-dengesi', 'Çözünürlük Dengesi', 'Solubility Equilibrium'),
  t('ayt-elektrokimya', 'Elektrokimya', 'Electrochemistry'),
  t('ayt-karbon-kimyasina-giris', 'Karbon Kimyasına Giriş', 'Introduction to Carbon Chemistry'),
  t(
    'ayt-organik-bilesikler-hidrokarbonlar',
    'Organik Bileşikler — Hidrokarbonlar',
    'Organic Compounds — Hydrocarbons',
  ),
  t(
    'ayt-organik-bilesikler-alkoller-eterler',
    'Organik Bileşikler — Alkoller ve Eterler',
    'Organic Compounds — Alcohols and Ethers',
  ),
  t(
    'ayt-organik-bilesikler-aldehit-keton',
    'Organik Bileşikler — Aldehit ve Keton',
    'Organic Compounds — Aldehydes and Ketones',
  ),
  t(
    'ayt-organik-bilesikler-karboksilik-asitler',
    'Organik Bileşikler — Karboksilik Asitler',
    'Organic Compounds — Carboxylic Acids',
  ),
  t(
    'ayt-organik-bilesikler-esterler',
    'Organik Bileşikler — Esterler',
    'Organic Compounds — Esters',
  ),
  t(
    'ayt-enerji-kaynaklari-ve-bilimsel-gelismeler',
    'Enerji Kaynakları ve Bilimsel Gelişmeler',
    'Energy Resources and Scientific Developments',
  ),
] as const;

const aytBiyoloji = [
  t('ayt-sinir-sistemi', 'Sinir Sistemi', 'Nervous System'),
  t('ayt-endokrin-sistem', 'Endokrin Sistem', 'Endocrine System'),
  t('ayt-duyu-organlari', 'Duyu Organları', 'Sense Organs'),
  t('ayt-destek-ve-hareket', 'Destek ve Hareket', 'Support and Movement'),
  t('ayt-sindirim', 'Sindirim', 'Digestion'),
  t('ayt-dolasim-ve-bagisiklik', 'Dolaşım ve Bağışıklık', 'Circulation and Immunity'),
  t('ayt-solunum', 'Solunum', 'Respiration'),
  t('ayt-bosaltim', 'Boşaltım', 'Excretion'),
  t(
    'ayt-ureme-ve-embriyonik-gelisim',
    'Üreme ve Embriyonik Gelişim',
    'Reproduction and Embryonic Development',
  ),
  t(
    'ayt-komunite-ve-populasyon-ekolojisi',
    'Komünite ve Popülasyon Ekolojisi',
    'Community and Population Ecology',
  ),
  t(
    'ayt-genden-proteine-nukleik-asitler',
    'Genden Proteine — Nükleik Asitler',
    'From Gene to Protein — Nucleic Acids',
  ),
  t(
    'ayt-genden-proteine-protein-sentezi',
    'Genden Proteine — Protein Sentezi',
    'From Gene to Protein — Protein Synthesis',
  ),
  t(
    'ayt-enerji-donusumleri-fotosentez',
    'Canlılarda Enerji Dönüşümleri — Fotosentez',
    'Energy Transformations in Living Things — Photosynthesis',
  ),
  t(
    'ayt-enerji-donusumleri-solunum',
    'Canlılarda Enerji Dönüşümleri — Solunum',
    'Energy Transformations in Living Things — Cellular Respiration',
  ),
  t('ayt-bitki-biyolojisi', 'Bitki Biyolojisi', 'Plant Biology'),
  t('ayt-canlilar-ve-cevre', 'Canlılar ve Çevre', 'Living Things and the Environment'),
] as const;

const aytEdebiyat = [
  t('ayt-anlam-bilgisi', 'Anlam Bilgisi', 'Semantics'),
  t('ayt-edebi-sanatlar', 'Edebî Sanatlar', 'Literary Devices'),
  t('ayt-siir-bilgisi-nazim-bicimi', 'Şiir Bilgisi — Nazım Biçimi', 'Poetry — Verse Forms'),
  t('ayt-siir-bilgisi-olcu', 'Şiir Bilgisi — Ölçü', 'Poetry — Meter'),
  t('ayt-siir-bilgisi-uyak', 'Şiir Bilgisi — Uyak', 'Poetry — Rhyme'),
  t(
    'ayt-islamiyet-oncesi-turk-edebiyati-ve-gecis-donemi',
    'İslamiyet Öncesi Türk Edebiyatı ve Geçiş Dönemi',
    'Pre-Islamic Turkish Literature and the Transition Period',
  ),
  t('ayt-halk-edebiyati-anonim', 'Halk Edebiyatı — Anonim', 'Folk Literature — Anonymous'),
  t('ayt-halk-edebiyati-asik', 'Halk Edebiyatı — Âşık', 'Folk Literature — Minstrel'),
  t(
    'ayt-halk-edebiyati-dini-tasavvufi',
    'Halk Edebiyatı — Dinî–Tasavvufi',
    'Folk Literature — Religious and Sufi',
  ),
  t('ayt-divan-edebiyati', 'Divan Edebiyatı', 'Divan Literature'),
  t('ayt-tanzimat', 'Tanzimat', 'Tanzimat Literature'),
  t('ayt-servetifunun', 'Servetifünun', 'Servet-i Fünun Literature'),
  t('ayt-fecriati', 'Fecriati', 'Fecr-i Ati Literature'),
  t('ayt-milli-edebiyat', 'Millî Edebiyat', 'National Literature'),
  t('ayt-cumhuriyet-siir', 'Cumhuriyet Dönemi — Şiir', 'Republican Era — Poetry'),
  t(
    'ayt-cumhuriyet-roman-hikaye',
    'Cumhuriyet Dönemi — Roman ve Hikâye',
    'Republican Era — Novels and Short Stories',
  ),
  t('ayt-cumhuriyet-tiyatro', 'Cumhuriyet Dönemi — Tiyatro', 'Republican Era — Drama'),
  t(
    'ayt-cumhuriyet-ogretici-metinler',
    'Cumhuriyet Dönemi — Öğretici Metinler',
    'Republican Era — Didactic Texts',
  ),
  t('ayt-edebiyat-akimlari', 'Edebiyat Akımları', 'Literary Movements'),
  t('ayt-dunya-edebiyati', 'Dünya Edebiyatı', 'World Literature'),
] as const;

const contemporaryHistory = [
  t('iki-savas-arasi-donem', 'İki Savaş Arası Dönem', 'Interwar Period'),
  t('ikinci-dunya-savasi', 'II. Dünya Savaşı', 'World War II'),
  t('soguk-savas', 'Soğuk Savaş', 'Cold War'),
  t('yumusama-donemi', 'Yumuşama Dönemi', 'Détente'),
  t('kuresellesen-dunya', 'Küreselleşen Dünya', 'Globalizing World'),
] as const;

const historyFor = (prefix: 'ayt-tarih-1' | 'ayt-tarih-2'): readonly TopicSeed[] => [
  ...tytTarih.map(([id, tr, en]) => t(`${prefix}-${id}`, tr, en)),
  ...contemporaryHistory.map(([id, tr, en]) => t(`${prefix}-${id}`, tr, en)),
];

const aytCografyaBase = [
  t('ekosistem-ve-madde-donguleri', 'Ekosistem ve Madde Döngüleri', 'Ecosystems and Matter Cycles'),
  t('nufus-politikalari', 'Nüfus Politikaları', 'Population Policies'),
  t('sehirlesme', 'Şehirleşme', 'Urbanization'),
  t('goc-ve-ekonomi', 'Göç ve Ekonomi', 'Migration and the Economy'),
  t('turkiye-ekonomisi', 'Türkiye Ekonomisi', "Türkiye's Economy"),
  t('bolgesel-kalkinma-projeleri', 'Bölgesel Kalkınma Projeleri', 'Regional Development Projects'),
  t('hizmet-sektoru', 'Hizmet Sektörü', 'Service Sector'),
  t('ulasim-ve-ticaret', 'Ulaşım ve Ticaret', 'Transportation and Trade'),
  t(
    'kuresel-ortam-bolgeler-ve-ulkeler',
    'Küresel Ortam — Bölgeler ve Ülkeler',
    'Global Environment — Regions and Countries',
  ),
  t('dogal-kaynaklar-ve-enerji', 'Doğal Kaynaklar ve Enerji', 'Natural Resources and Energy'),
  t(
    'cevre-sorunlari-ve-politikalari',
    'Çevre Sorunları ve Politikaları',
    'Environmental Issues and Policies',
  ),
] as const;

const geographyFor = (prefix: 'ayt-cografya-1' | 'ayt-cografya-2'): readonly TopicSeed[] =>
  aytCografyaBase.map(([id, tr, en]) => t(`${prefix}-${id}`, tr, en));

const aytFelsefeGrubu = [
  t(
    'ayt-felsefe-tarihi-mo-6-ms-2',
    'Felsefe Tarihi — MÖ 6.–MS 2. yy',
    'History of Philosophy — 6th c. BCE–2nd c. CE',
  ),
  t(
    'ayt-felsefe-tarihi-ms-2-15',
    'Felsefe Tarihi — MS 2.–15. yy',
    'History of Philosophy — 2nd–15th c.',
  ),
  t(
    'ayt-felsefe-tarihi-15-17',
    'Felsefe Tarihi — 15.–17. yy',
    'History of Philosophy — 15th–17th c.',
  ),
  t(
    'ayt-felsefe-tarihi-18-19',
    'Felsefe Tarihi — 18.–19. yy',
    'History of Philosophy — 18th–19th c.',
  ),
  t('ayt-felsefe-tarihi-20', 'Felsefe Tarihi — 20. yy', 'History of Philosophy — 20th c.'),
  t('ayt-psikoloji-bilimi', 'Psikoloji — Psikoloji Bilimi', 'Psychology — Psychology as a Science'),
  t(
    'ayt-psikoloji-ogrenme-bellek-dusunme',
    'Psikoloji — Öğrenme, Bellek ve Düşünme',
    'Psychology — Learning, Memory and Thinking',
  ),
  t('ayt-psikoloji-ruh-sagligi', 'Psikoloji — Ruh Sağlığı', 'Psychology — Mental Health'),
  t('ayt-sosyoloji-giris', 'Sosyoloji — Giriş', 'Sociology — Introduction'),
  t(
    'ayt-sosyoloji-birey-ve-toplum',
    'Sosyoloji — Birey ve Toplum',
    'Sociology — Individual and Society',
  ),
  t(
    'ayt-sosyoloji-toplumsal-yapi-ve-degisme',
    'Sosyoloji — Toplumsal Yapı ve Değişme',
    'Sociology — Social Structure and Change',
  ),
  t('ayt-sosyoloji-kultur', 'Sosyoloji — Kültür', 'Sociology — Culture'),
  t('ayt-sosyoloji-kurumlar', 'Sosyoloji — Kurumlar', 'Sociology — Institutions'),
  t('ayt-mantik-giris', 'Mantık — Giriş', 'Logic — Introduction'),
  t('ayt-klasik-mantik', 'Mantık — Klasik Mantık', 'Logic — Classical Logic'),
  t('ayt-sembolik-mantik', 'Mantık — Sembolik Mantık', 'Logic — Symbolic Logic'),
] as const;

const aytDin = [
  t('ayt-dunya-ve-ahiret', 'Dünya ve Ahiret', 'This World and the Hereafter'),
  t(
    'ayt-kurana-gore-hz-muhammed',
    "Kur'an'a Göre Hz. Muhammed",
    'Prophet Muhammad According to the Quran',
  ),
  t('ayt-kuranda-bazi-kavramlar', "Kur'an'da Bazı Kavramlar", 'Selected Concepts in the Quran'),
  t('ayt-inancla-ilgili-meseleler', 'İnançla İlgili Meseleler', 'Issues Concerning Faith'),
  t('ayt-islam-ve-bilim', 'İslam ve Bilim', 'Islam and Science'),
  t('ayt-anadoluda-islam', "Anadolu'da İslam", 'Islam in Anatolia'),
  t('ayt-guncel-dini-meseleler', 'Güncel Dinî Meseleler', 'Contemporary Religious Issues'),
] as const;

const subject = (
  id: string,
  tr: string,
  en: string,
  questionCount: number,
  color: string,
  icon: { sf: string; md: string },
  topics: readonly TopicSeed[],
  extra: Pick<SubjectSeed, 'countApproximate' | 'altSubjectId'> = {},
): SubjectSeed => ({ id, name: { tr, en }, questionCount, color, icon, topics, ...extra });

const exams: readonly ExamSeed[] = [
  {
    id: 'tyt',
    name: { tr: 'TYT', en: 'TYT' },
    durationMin: 165,
    totalQuestions: 120,
    sections: [
      {
        id: 'tyt-turkce',
        name: { tr: 'Türkçe', en: 'Turkish' },
        questionCount: 40,
        subjects: [
          subject(
            'tyt-turkce',
            'Türkçe',
            'Turkish',
            40,
            '#0D9488',
            { sf: 'text.book.closed', md: 'menu_book' },
            tytTurkce,
          ),
        ],
      },
      {
        id: 'tyt-sosyal',
        name: { tr: 'Sosyal Bilimler', en: 'Social Sciences' },
        questionCount: 20,
        subjects: [
          subject(
            'tyt-tarih',
            'Tarih',
            'History',
            5,
            '#B45309',
            { sf: 'clock.arrow.circlepath', md: 'history_edu' },
            tytTarih,
          ),
          subject(
            'tyt-cografya',
            'Coğrafya',
            'Geography',
            5,
            '#15803D',
            { sf: 'globe.europe.africa', md: 'public' },
            tytCografya,
          ),
          subject(
            'tyt-felsefe',
            'Felsefe',
            'Philosophy',
            5,
            '#7C3AED',
            { sf: 'brain.head.profile', md: 'psychology' },
            tytFelsefe,
          ),
          subject(
            'tyt-din-kulturu',
            'Din Kültürü',
            'Religious Culture',
            5,
            '#A16207',
            { sf: 'book.closed', md: 'auto_stories' },
            tytDin,
            { altSubjectId: 'tyt-felsefe' },
          ),
        ],
      },
      {
        id: 'tyt-matematik',
        name: { tr: 'Temel Matematik', en: 'Basic Mathematics' },
        questionCount: 40,
        subjects: [
          subject(
            'tyt-matematik',
            'Matematik',
            'Mathematics',
            31,
            '#2563EB',
            { sf: 'function', md: 'calculate' },
            tytMatematik,
            { countApproximate: true },
          ),
          subject(
            'tyt-geometri',
            'Geometri',
            'Geometry',
            9,
            '#0891B2',
            { sf: 'triangle', md: 'change_history' },
            tytGeometri,
            { countApproximate: true },
          ),
        ],
      },
      {
        id: 'tyt-fen',
        name: { tr: 'Fen Bilimleri', en: 'Natural Sciences' },
        questionCount: 20,
        subjects: [
          subject(
            'tyt-fizik',
            'Fizik',
            'Physics',
            7,
            '#DC2626',
            { sf: 'atom', md: 'science' },
            tytFizik,
          ),
          subject(
            'tyt-kimya',
            'Kimya',
            'Chemistry',
            7,
            '#9333EA',
            { sf: 'flask', md: 'biotech' },
            tytKimya,
          ),
          subject(
            'tyt-biyoloji',
            'Biyoloji',
            'Biology',
            6,
            '#16A34A',
            { sf: 'leaf', md: 'eco' },
            tytBiyoloji,
          ),
        ],
      },
    ],
  },
  {
    id: 'ayt',
    name: { tr: 'AYT', en: 'AYT' },
    durationMin: 180,
    totalQuestions: 160,
    sections: [
      {
        id: 'ayt-edebiyat-sosyal-1',
        name: {
          tr: 'Türk Dili ve Edebiyatı–Sosyal Bilimler-1',
          en: 'Turkish Language and Literature–Social Sciences 1',
        },
        questionCount: 40,
        subjects: [
          subject(
            'ayt-edebiyat',
            'Türk Dili ve Edebiyatı',
            'Turkish Language and Literature',
            24,
            '#DB2777',
            { sf: 'books.vertical', md: 'local_library' },
            aytEdebiyat,
          ),
          subject(
            'ayt-tarih-1',
            'Tarih-1',
            'History 1',
            10,
            '#B45309',
            { sf: 'clock.arrow.circlepath', md: 'history_edu' },
            historyFor('ayt-tarih-1'),
          ),
          subject(
            'ayt-cografya-1',
            'Coğrafya-1',
            'Geography 1',
            6,
            '#15803D',
            { sf: 'globe.europe.africa', md: 'public' },
            geographyFor('ayt-cografya-1'),
          ),
        ],
      },
      {
        id: 'ayt-sosyal-2',
        name: { tr: 'Sosyal Bilimler-2', en: 'Social Sciences 2' },
        questionCount: 40,
        subjects: [
          subject(
            'ayt-tarih-2',
            'Tarih-2',
            'History 2',
            11,
            '#C2410C',
            { sf: 'clock.arrow.circlepath', md: 'history_edu' },
            historyFor('ayt-tarih-2'),
          ),
          subject(
            'ayt-cografya-2',
            'Coğrafya-2',
            'Geography 2',
            11,
            '#047857',
            { sf: 'globe.europe.africa', md: 'public' },
            geographyFor('ayt-cografya-2'),
          ),
          subject(
            'ayt-felsefe-grubu',
            'Felsefe Grubu',
            'Philosophy Group',
            12,
            '#7C3AED',
            { sf: 'brain.head.profile', md: 'psychology' },
            aytFelsefeGrubu,
          ),
          subject(
            'ayt-din-kulturu',
            'Din Kültürü',
            'Religious Culture',
            6,
            '#A16207',
            { sf: 'book.closed', md: 'auto_stories' },
            aytDin,
            { altSubjectId: 'ayt-felsefe-grubu' },
          ),
        ],
      },
      {
        id: 'ayt-matematik',
        name: { tr: 'Matematik', en: 'Mathematics' },
        questionCount: 40,
        subjects: [
          subject(
            'ayt-matematik',
            'Matematik',
            'Mathematics',
            30,
            '#4F46E5',
            { sf: 'function', md: 'calculate' },
            aytMatematik,
            { countApproximate: true },
          ),
          subject(
            'ayt-geometri',
            'Geometri',
            'Geometry',
            10,
            '#0891B2',
            { sf: 'triangle', md: 'change_history' },
            aytGeometri,
            { countApproximate: true },
          ),
        ],
      },
      {
        id: 'ayt-fen',
        name: { tr: 'Fen Bilimleri', en: 'Natural Sciences' },
        questionCount: 40,
        subjects: [
          subject(
            'ayt-fizik',
            'Fizik',
            'Physics',
            14,
            '#DC2626',
            { sf: 'atom', md: 'science' },
            aytFizik,
          ),
          subject(
            'ayt-kimya',
            'Kimya',
            'Chemistry',
            13,
            '#9333EA',
            { sf: 'flask', md: 'biotech' },
            aytKimya,
          ),
          subject(
            'ayt-biyoloji',
            'Biyoloji',
            'Biology',
            13,
            '#16A34A',
            { sf: 'leaf', md: 'eco' },
            aytBiyoloji,
          ),
        ],
      },
    ],
  },
] as const;

const OFFICIAL_2026_GUIDE_URL =
  'https://dokuman.osym.gov.tr/pdfdokuman/2026/YKS/basvuru_kilavuz06022026.pdf';

export function createTopicsDocument(
  verifiedAt = new Date().toISOString(),
  coverageLastYear = 2026,
) {
  const years = topicCoverageYears(coverageLastYear);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    dataStatus: {
      verified: false,
      approximate: false,
      sample: false,
      source: null,
      note: {
        tr: 'Taksonomi PROMPT.md Ek A kaynaklıdır; yıllık konu sayımları resmî kitapçıklar editöryal uzlaşıyla sınıflandırılana kadar bilinmiyor (null) olarak tutulur.',
        en: 'The taxonomy follows PROMPT.md Appendix A; yearly topic counts remain unknown (null) until official booklets are classified by editorial consensus.',
      },
    },
    exams: exams.map((exam) => ({
      ...exam,
      structureVerified: true,
      structureSource: OFFICIAL_2026_GUIDE_URL,
      structureVerifiedAt: verifiedAt,
      sections: exam.sections.map((section) => ({
        ...section,
        subjects: section.subjects.map(({ topics, ...seed }) => ({
          ...seed,
          topics: topics.map(([id, tr, en]) => ({
            id,
            name: { tr, en },
            grade: [],
            gradeVerified: false,
            gradeApproximate: false,
            gradeSource: null,
            yearlyStats: years.map((year) => ({
              year,
              count: null,
              verified: false,
              source: null,
              verificationMethod: null,
              verifiedAt: null,
            })),
            questions: [],
          })),
        })),
      })),
    })),
  };
}

export async function writeTopics(
  outputPath = resolve(projectRoot, 'content/topics.json'),
  coverageLastYear = 2026,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(createTopicsDocument(new Date().toISOString(), coverageLastYear), null, 2)}\n`,
    'utf8',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  writeTopics(process.argv[2] ? resolve(process.argv[2]) : undefined)
    .then(() => {
      console.log(
        'content/topics.json generated with null, unverified contiguous topic-count placeholders.',
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
