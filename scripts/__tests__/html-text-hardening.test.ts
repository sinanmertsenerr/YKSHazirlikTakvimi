import assert from 'node:assert/strict';
import test from 'node:test';

import { attributeValue, decodeHtmlEntities, htmlToText } from '../lib/html-text.ts';

test('htmlToText decodes the legacy ÖSYM pseudo-entities as Turkish letters', () => {
  assert.equal(
    htmlToText('F&odot;rsat &udot;niversite &Odot;dev &Udot;nite'),
    'Försat üniversite Ödev Ünite',
  );
});

test('htmlToText keeps standard entity semantics and decodes exactly once', () => {
  // &amp;odot; yazarın kaçırdığı literal metindir; ikinci bir decode'a uğramamalı.
  assert.equal(htmlToText('&amp;odot; ve &ccedil;ift'), '&odot; ve çift');
});

test('legacy entities decode identically on the text and attribute paths', () => {
  const anchor = '<a href="/duyuru/f&odot;rsat-&udot;niversite.pdf">F&odot;rsat &udot;niversite</a>';
  assert.equal(htmlToText(anchor), 'Försat üniversite');
  const openingTag = 'a href="/duyuru/f&odot;rsat-&udot;niversite.pdf"';
  assert.equal(attributeValue(openingTag, 'href'), '/duyuru/försat-üniversite.pdf');
});

test('htmlToText survives 50,000 levels of nesting without recursion overflow', () => {
  const html = `${'<div>'.repeat(50_000)}derin${'</div>'.repeat(50_000)}`;
  assert.equal(htmlToText(html), 'derin');
});

test('htmlToText includes <template> subtree text', () => {
  assert.equal(
    htmlToText('<p>önce</p><template><p>şablon metni</p></template><p>sonra</p>'),
    'önce şablon metni sonra',
  );
});

test('htmlToText skips <noscript> content entirely', () => {
  assert.equal(
    htmlToText('<noscript><img src="x.gif" alt="Güncelleme Tarihi: 01.01.2020"></noscript>görünür'),
    'görünür',
  );
});

test('htmlToText collapses whitespace (NBSP dahil) by default', () => {
  assert.equal(htmlToText('  a&nbsp;b\n\n c  '), 'a b c');
});

test('htmlToText line mode trims lines and drops empties', () => {
  assert.equal(
    htmlToText('  ilk<br><br>  ikinci  <br /> üçüncü ', { lineBreakTags: new Set(['br']) }),
    'ilk\nikinci\nüçüncü',
  );
});

test('htmlToText pins parse5 foster-parenting order for malformed tables', () => {
  // Bilinçli olarak sabitlenen parser semantiği: <td> dışında kalan tablo metni
  // tablonun ÖNÜNE taşınır (eski regex kaynak sırasını korurdu). Bu test
  // davranış değişirse haber versin diye var; tüketiciler "tam 1 eşleşme"
  // korumalarıyla kapalı-hata verir.
  assert.equal(
    htmlToText('<table>KaçakMetin<tr><td>Hücre</td></tr></table>'),
    'KaçakMetin Hücre',
  );
});

test('attributeValue does not match prefixed attribute names', () => {
  assert.equal(attributeValue('a data-href="/yanlış" href="/doğru"', 'href'), '/doğru');
});

test('attributeValue decodes standard entities the old hand-rolled maps missed', () => {
  assert.equal(
    attributeValue("div title='Kılavuz &mdash; &ldquo;2026&rdquo; &hellip;'", 'title'),
    'Kılavuz — “2026” …',
  );
});

test('decodeHtmlEntities handles named, numeric, and legacy references in one pass', () => {
  assert.equal(decodeHtmlEntities('&Udot;nite &#x2014; &#65; &ccedil;ok'), 'Ünite — A çok');
});
