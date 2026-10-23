import { parseDocument, DomUtils } from 'htmlparser2';
import { fetchWithReadRetry } from '../reliability/retry';
import type { NFLGame } from './types';

export interface NFLOfficialParticipation {
  teamId: number;
  playerId: number;
  designation: 'CONFIRMED_AVAILABLE' | 'INACTIVE';
  publishedAt: string;
  url: string;
  detail: string;
}

const officialOrigins: Readonly<Record<number, string>> = { 25: 'https://www.49ers.com', 28: 'https://www.commanders.com' };
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseOfficialNFLParticipation(html: string, url: string, game: NFLGame, teamId: number,
  players: Array<{ id?: string; fullName?: string; displayName?: string }>, now: Date): NFLOfficialParticipation[] {
  const origin = officialOrigins[teamId];
  if (!origin || new URL(url).origin !== origin || !new URL(url).pathname.startsWith('/news/')) return [];
  const dom = parseDocument(html);
  const articles = DomUtils.getElementsByTagName('script', dom.children, true)
    .filter(node => node.attribs.type === 'application/ld+json').flatMap(node => {
      try { const value = JSON.parse(DomUtils.textContent(node)); return Array.isArray(value) ? value : [value]; }
      catch { return []; }
    }).filter(article => article?.['@type'] === 'NewsArticle' && article.url === url && typeof article.articleBody === 'string');
  const result: NFLOfficialParticipation[] = [];
  for (const article of articles) {
    const published = Date.parse(article.datePublished);
    const modified = Date.parse(article.dateModified ?? article.datePublished);
    const kickoff = Date.parse(game.gameTime);
    const body: string = article.articleBody;
    const easternDate = (time: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(time);
    if (!Number.isFinite(published) || !Number.isFinite(modified) || published > now.getTime() || modified > now.getTime()
      || now.getTime() - published > 12 * 3600000 || published > kickoff || easternDate(published) !== easternDate(kickoff)
      || ![game.homeTeam, game.awayTeam].every(team => normalize(body).includes(normalize(team.displayName)))) continue;
    const paragraphs = body.split(/\n+/).map(value => value.trim()).filter(Boolean);
    const inactiveHeading = paragraphs.findIndex(value => /(?:here are .*inactives|declared the following players as inactive)/i.test(value));
    for (const player of players) {
      const name = player.fullName ?? player.displayName;
      if (!name || !Number.isInteger(Number(player.id))) continue;
      const mentions = (text: string) => normalize(text).includes(normalize(name));
      const inactive = inactiveHeading >= 0 && paragraphs.slice(inactiveHeading + 1).some(mentions);
      const active = paragraphs.find(text => mentions(text) && /\b(?:is active|are active) for (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tonight)(?:'s)? (?:game|contest)\b/i.test(text));
      if (!inactive && !active) continue;
      result.push({ teamId, playerId: Number(player.id), designation: inactive ? 'INACTIVE' : 'CONFIRMED_AVAILABLE',
        publishedAt: article.datePublished, url, detail: inactive ? `${name} is explicitly listed in the official game-day inactive report.` : active! });
    }
  }
  return result;
}

export async function loadOfficialNFLParticipation(game: NFLGame, roster: { teamId: number;
  athletes: Array<{ id?: string; fullName?: string; displayName?: string }> }, now: Date): Promise<NFLOfficialParticipation[]> {
  const origin = officialOrigins[roster.teamId];
  if (!origin || Date.parse(game.gameTime) - now.getTime() > 90 * 60000 || Date.parse(game.gameTime) <= now.getTime()) return [];
  const read = async (url: string) => {
    const response = await fetchWithReadRetry(url, { headers: { accept: 'text/html' }, redirect: 'error', signal: AbortSignal.timeout(10000) }, { attempts: 1 });
    if (!response.ok) throw new Error('Official participation source unavailable.');
    const text = await response.text();
    if (text.length > 2000000) throw new Error('Official participation document too large.');
    return text;
  };
  try {
    const index = parseDocument(await read(`${origin}/news/`));
    const link = DomUtils.getElementsByTagName('a', index.children, true).find(node => {
      try { const target = new URL(node.attribs.href, origin); return target.origin === origin && target.pathname.startsWith('/news/')
        && /\binactives\b/i.test(DomUtils.textContent(node))
        && [game.homeTeam, game.awayTeam].every(team => DomUtils.textContent(node).toLowerCase().includes(team.name.toLowerCase())); }
      catch { return false; }
    });
    if (!link) return [];
    const url = new URL(link.attribs.href, origin).toString();
    return parseOfficialNFLParticipation(await read(url), url, game, roster.teamId, roster.athletes, now);
  } catch { return []; }
}