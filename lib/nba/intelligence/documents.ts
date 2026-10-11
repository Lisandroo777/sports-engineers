import { createHash } from 'node:crypto';
import { parseDocument, DomUtils } from 'htmlparser2';
import type { ReportRevision } from './types';

export const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const timestamp = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export function canonicalUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Public HTTPS URL required.');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}

export function freeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export interface ParsedArticle { title: string | null; author: string | null; publishedAt: string | null; updatedAt: string | null; text: string; originalUrls: string[]; issues: string[] }
export function parseArticle(html: string, url: string): ParsedArticle {
  if (Buffer.byteLength(html) > 2_000_000) throw new Error('Article size limit exceeded.');
  const dom = parseDocument(html);
  const tags = DomUtils.getElementsByTagName('*', dom.children, true);
  const meta = new Map(tags.filter(node => node.name === 'meta').map(node => [node.attribs.property ?? node.attribs.name, node.attribs.content]));
  const scripts = tags.filter(node => node.name === 'script' && node.attribs.type === 'application/ld+json');
  const articles: Record<string, unknown>[] = [];
  function collect(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== 'object') return;
    const data = value as Record<string, unknown>;
    if (['NewsArticle', 'Article', 'BlogPosting'].some(type => Array.isArray(data['@type']) ? data['@type'].includes(type) : data['@type'] === type)) articles.push(data);
    if (data['@graph']) collect(data['@graph']);
  }
  const issues: string[] = [];
  for (const script of scripts) {
    try { collect(JSON.parse(DomUtils.textContent(script))); } catch { issues.push('Invalid article JSON-LD.'); }
  }
  const article = articles[0];
  if (articles.length > 1) issues.push('Multiple article metadata records; requires review.');
  const authorData = article?.author;
  const authors = Array.isArray(authorData) ? authorData : [authorData];
  const authorNames = authors.flatMap(author => typeof author === 'string' ? [author] : author && typeof author === 'object' && typeof (author as Record<string, unknown>).name === 'string' ? [String((author as Record<string, unknown>).name)] : []);
  const body = typeof article?.articleBody === 'string' ? article.articleBody : null;
  const articleNode = tags.find(node => node.name === 'article');
  const paragraphs = articleNode ? DomUtils.getElementsByTagName('p', articleNode.children, true).map(node => DomUtils.textContent(node).trim()).filter(Boolean) : [];
  const content = body ?? paragraphs.join('\n');
  const publishedAt = timestamp(article?.datePublished ?? meta.get('article:published_time'));
  const updatedAt = timestamp(article?.dateModified ?? meta.get('article:modified_time'));
  if (!publishedAt) issues.push('Exact timezone-qualified publication timestamp unavailable.');
  if (!content) issues.push('Article body unavailable; no claim extraction from headlines alone.');
  const links = articleNode ? DomUtils.getElementsByTagName('a', articleNode.children, true).flatMap(node => {
    try { return node.attribs.href ? [canonicalUrl(new URL(node.attribs.href, url).toString())] : []; } catch { return []; }
  }) : [];
  return { title: typeof article?.headline === 'string' ? article.headline : meta.get('og:title') ?? null,
    author: authorNames.join('; ') || meta.get('author') || null, publishedAt, updatedAt,
    text: content, originalUrls: [...new Set(links)], issues };
}

export function createRevision(input: {
  sourceId: string; url: string; bytes: Uint8Array | string; mediaType: ReportRevision['mediaType']; fetchedAt: string;
  parsed: ParsedArticle; previous?: ReportRevision | null; etag?: string | null; lastModified?: string | null;
}): ReportRevision {
  const fetchedAt = timestamp(input.fetchedAt);
  if (!fetchedAt) throw new Error('Valid fetchedAt required.');
  const url = canonicalUrl(input.url);
  const documentId = digest(`${input.sourceId}:${url}`);
  const contentHash = digest(input.bytes);
  const previous = input.previous?.documentId === documentId ? input.previous : null;
  const revisionId = digest(`${documentId}:${contentHash}:${input.parsed.publishedAt}:${input.parsed.updatedAt}`);
  if (previous?.revisionId === revisionId) return previous;
  return freeze({ schemaVersion: '1', revisionId, documentId, sourceId: input.sourceId, url, contentHash, mediaType: input.mediaType,
    ...input.parsed, firstSeenAt: fetchedAt, fetchedAt, statementAt: null, etag: input.etag ?? null, lastModified: input.lastModified ?? null,
    supersedesRevisionId: previous?.revisionId ?? null });
}