import { parseDocument, DomUtils } from 'htmlparser2';
import { canonicalUrl, parseArticle, createRevision } from '../documents';
import { sourceAllowsUrl } from '../sources';
import type { IntelligenceSource, ReportRevision } from '../types';

export function articleRevision(html: string, source: IntelligenceSource, url: string, fetchedAt: string, previous?: ReportRevision | null): ReportRevision {
  if (!sourceAllowsUrl(source, url)) throw new Error('Article URL outside verified source scope.');
  return createRevision({ sourceId: source.id, url, bytes: html, mediaType: 'HTML', fetchedAt, parsed: parseArticle(html, url), previous });
}

export function discoverLinks(html: string, source: IntelligenceSource, pageUrl: string, max = 10): string[] {
  if (Buffer.byteLength(html) > 2_000_000) throw new Error('Index size limit exceeded.');
  const dom = parseDocument(html);
  const urls = DomUtils.getElementsByTagName('a', dom.children, true).flatMap(node => {
    try { const url = canonicalUrl(new URL(node.attribs.href, pageUrl).toString()); return sourceAllowsUrl(source, url) ? [url] : []; } catch { return []; }
  });
  return [...new Set(urls)].slice(0, Math.max(0, Math.min(20, max)));
}