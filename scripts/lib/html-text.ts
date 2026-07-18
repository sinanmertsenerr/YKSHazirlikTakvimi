import { parseFragment } from 'parse5';

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
};

const SKIPPED_ELEMENTS = new Set(['script', 'style']);

type HtmlTextOptions = {
  lineBreakTags?: ReadonlySet<string>;
};

export function htmlToText(html: string, options: HtmlTextOptions = {}): string {
  const root = parseFragment(html) as unknown as HtmlNode;
  const chunks: string[] = [];

  const visit = (node: HtmlNode): void => {
    const tagName = node.tagName?.toLocaleLowerCase('en-US');
    if (tagName && SKIPPED_ELEMENTS.has(tagName)) return;
    if (node.nodeName === '#text' && node.value) chunks.push(node.value);
    if (tagName && options.lineBreakTags?.has(tagName)) chunks.push('\n');
    for (const child of node.childNodes ?? []) visit(child);
  };

  visit(root);
  return chunks.join(' ');
}
