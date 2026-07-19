import { decodeHTML } from 'entities';
import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

type ChildNode = DefaultTreeAdapterMap['childNode'];
type ParentLike = { childNodes: ChildNode[] };

// script/style: çalıştırılabilir/stil içeriği hiçbir zaman görünür metin değildir.
// noscript: script açık tarayıcıda görünmez ve parse5 içini RAWTEXT okuduğundan
// bırakılırsa iç markup literal metin olarak sızar (ör. GTM'in <noscript><img>
// fallback'i sayfa-geneli metne etiket biçimli çöp enjekte ederdi).
const SKIPPED_ELEMENTS = new Set(['script', 'style', 'noscript']);

// ÖSYM'nin eski sayfaları için sahte adlandırılmış referans düzeltmesi: HTML5'te
// &odot; U+2299 (⊙) demektir; &Odot;/&udot;/&Udot; hiç tanımlı değildir. Eskiden
// dosya-başı elle yazılmış decodeHtml tabloları bunları ö/Ö/ü/Ü kabul ediyordu.
// Standart karşılıklarına çevirip gerçek decode'u tek geçişe bırakıyoruz. Bu
// normalizasyon hem metin (htmlToText) hem attribute (decodeHtmlEntities)
// yolunun ÜSTÜNDE aynı biçimde uygulanır — iki yol aynı kaynak baytını asla
// farklı karaktere çözemez.
const LEGACY_TURKISH_ENTITY_PATTERN = /&(odot|Odot|udot|Udot);/g;
const LEGACY_TURKISH_ENTITIES: Readonly<Record<string, string>> = {
  odot: '&ouml;',
  Odot: '&Ouml;',
  udot: '&uuml;',
  Udot: '&Uuml;',
};

function normalizeLegacyTurkishEntities(value: string): string {
  return value.replace(
    LEGACY_TURKISH_ENTITY_PATTERN,
    (_match, name: string) => LEGACY_TURKISH_ENTITIES[name]!,
  );
}

type HtmlTextOptions = {
  lineBreakTags?: ReadonlySet<string>;
};

/**
 * Fetch edilen resmî sayfa HTML'inden düz metin çıkarır.
 *
 * Varsayılan kip tek normalize satır döndürür: boşluk dizileri (NBSP dahil) tek
 * boşluğa iner, uçlar kırpılır. `lineBreakTags` verilirse o etiketler satır
 * sonu üretir; satırlar tek tek normalize edilir, boş satırlar atılır.
 *
 * Gezinti özyinelemesizdir (açık yığın): derin iç içe geçmiş bozuk resmî
 * sayfalar çağrı yığınını taşıramaz. <template> içeriği parse5'in ayrı
 * `content` fragment'ında durur ve oradan okunur.
 */
export function htmlToText(html: string, options: HtmlTextOptions = {}): string {
  const root = parseFragment(normalizeLegacyTurkishEntities(html));
  const chunks: string[] = [];
  const stack: ChildNode[] = [];

  const pushChildren = (parent: ParentLike): void => {
    for (let index = parent.childNodes.length - 1; index >= 0; index -= 1) {
      stack.push(parent.childNodes[index]!);
    }
  };

  pushChildren(root);
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeName === '#text') {
      chunks.push((node as DefaultTreeAdapterMap['textNode']).value);
      continue;
    }
    if (!('tagName' in node)) continue;
    const tagName = node.tagName.toLowerCase();
    if (SKIPPED_ELEMENTS.has(tagName)) continue;
    if (options.lineBreakTags?.has(tagName)) chunks.push('\n');
    if (tagName === 'template' && 'content' in node) {
      pushChildren(node.content);
      continue;
    }
    pushChildren(node);
  }

  const text = chunks.join(' ');
  if (options.lineBreakTags) {
    return text
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * HTML karakter referanslarını tam HTML5 tablosuyla (adlandırılmış + sayısal)
 * bir kez çözer; ÖSYM legacy sahte referansları htmlToText ile aynı
 * normalizasyondan geçer. Attribute değerleri için kullanılır.
 */
export function decodeHtmlEntities(value: string): string {
  return decodeHTML(normalizeLegacyTurkishEntities(value));
}

/**
 * Bir açılış etiketinin attribute dizisinden adlandırılmış değeri okur.
 *
 * Ad regex-escape'lenir ve `(?:^|\s)` sınırıyla aranır (ör. `href` sorgusu
 * `data-href`'e denk gelmez). Değer decode edilip kırpılır; boş kalırsa
 * undefined döner.
 */
export function attributeValue(openingTag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unquotedValue = '([^\\s"\'=<>`]+)';
  const match = new RegExp(
    '(?:^|\\s)' + escapedName + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|' + unquotedValue + ')',
    'i',
  ).exec(openingTag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (value === undefined) return undefined;
  const decoded = decodeHtmlEntities(value).trim();
  return decoded || undefined;
}
