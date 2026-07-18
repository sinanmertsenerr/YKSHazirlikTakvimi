import assert from 'node:assert/strict';
import test from 'node:test';

import { htmlToText } from '../lib/html-text.ts';

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

test('htmlToText excludes script and style content under browser-tolerated end tags', () => {
  const html = [
    '<p>before</p>',
    '<!-- hidden -->',
    '<script>LEAK</script foo="bar">',
    '<style>HIDE</style data-source="official">',
    '<p>safe &amp; sound</p>',
  ].join('');

  assert.equal(normalized(htmlToText(html)), 'before safe & sound');
});

test('htmlToText decodes character references exactly once', () => {
  assert.equal(normalized(htmlToText('&amp;lt;strong&amp;gt;')), '&lt;strong&gt;');
});

test('htmlToText preserves configured line-break elements', () => {
  const text = htmlToText('first<br>second<BR />third', {
    lineBreakTags: new Set(['br']),
  });
  assert.deepEqual(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    ['first', 'second', 'third'],
  );
});
