import { Worker } from 'node:worker_threads';
import { createRevision, digest, freeze } from '../documents';
import { resolveIdentity } from '../identity';
import type { IdentityEntry, IntelligenceClaim, ReportRevision, TargetEvent } from '../types';

export interface PdfItem { str: string; x: number; y: number; width: number; height: number }
export interface OfficialReportRow { gameDate: string; matchup: string; teamName: string; playerName: string | null; status: string; reason: string | null; page: number; excerpt: string }
export interface ParsedOfficialReport { reportedAt: string | null; rows: OfficialReportRow[]; text: string; issues: string[] }

export function easternTimestamp(date: string, hours: number, minutes: number): string | null {
  for (const offset of [4, 5]) {
    const at = new Date(`${date}T00:00:00Z`);
    at.setUTCHours(hours + offset, minutes);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(part => [part.type, part.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === date && Number(parts.hour) === hours && Number(parts.minute) === minutes) return at.toISOString();
  }
  return null;
}

function reportTimestamp(text: string): string | null {
  const match = text.match(/Injury\s+Report:\s*(\d{2})\/(\d{2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const hours = Number(match[4]);
  if (hours < 1 || hours > 12 || Number(match[5]) > 59) return null;
  return easternTimestamp(`${year}-${match[1]}-${match[2]}`, hours % 12 + (match[6].toUpperCase() === 'PM' ? 12 : 0), Number(match[5]));
}

export function parseOfficialItems(pages: PdfItem[][]): ParsedOfficialReport {
  const rows: OfficialReportRow[] = [];
  const issues: string[] = [];
  const lines: string[] = [];
  const timestamps = new Set<string>();
  let carry = { date: '', matchup: '', team: '' };
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const items = pages[pageIndex].filter(item => item.str.trim() && Number.isFinite(item.x) && Number.isFinite(item.y));
    const groups = new Map<number, PdfItem[]>();
    for (const item of items) {
      const line = [...groups.keys()].find(y => Math.abs(y - item.y) <= 2) ?? item.y;
      groups.set(line, [...(groups.get(line) ?? []), item]);
    }
    const sorted = [...groups].sort(([first], [second]) => second - first);
    for (const [, line] of sorted) {
      const value = line.sort((first, second) => first.x - second.x).map(item => item.str.trim()).join(' ');
      lines.push(value);
      const stamp = reportTimestamp(value);
      if (stamp) timestamps.add(stamp);
    }
    const header = sorted.find(([, line]) => line.some(item => /^Game\s*Date$/i.test(item.str.trim())) && line.some(item => /^Current\s*Status$/i.test(item.str.trim())));
    if (!header) { issues.push(`Page ${pageIndex + 1}: verified injury-table columns missing.`); continue; }
    const headings = header[1].sort((first, second) => first.x - second.x);
    const names = headings.map(item => item.str.replace(/\s/g, '').toLowerCase());
    const required = ['gamedate', 'gametime', 'matchup', 'team', 'playername', 'currentstatus', 'reason'];
    if (required.some(name => !names.includes(name))) { issues.push(`Page ${pageIndex + 1}: incomplete or split column headings.`); continue; }
    for (const [y, line] of sorted.filter(([y]) => y < header[0] - 2)) {
      void y;
      const cells = new Map<string, string>();
      for (const item of line) {
        let index = headings.findIndex((heading, index) => item.x >= heading.x - 2 && (index === headings.length - 1 || item.x < headings[index + 1].x - 2));
        if (index < 0) index = 0;
        cells.set(names[index], `${cells.get(names[index]) ?? ''} ${item.str}`.trim());
      }
      const rawDate = cells.get('gamedate');
      if (rawDate && /^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
        const [month, day, year] = rawDate.split('/'); carry = { date: `${year}-${month}-${day}`, matchup: '', team: '' };
      }
      const matchup = cells.get('matchup');
      if (matchup && /^[A-Z]{2,4}\s*@\s*[A-Z]{2,4}$/.test(matchup)) { carry.matchup = matchup.replace(/\s/g, ''); carry.team = ''; }
      if (cells.get('team')) carry.team = cells.get('team')!;
      const player = cells.get('playername') ?? null;
      const status = cells.get('currentstatus') ?? '';
      const combined = line.sort((first, second) => first.x - second.x).map(item => item.str.trim()).join(' ');
      const missing = /NOT\s+YET\s+SUBMITTED/i.test(combined);
      if (!missing && !['Out', 'Doubtful', 'Questionable', 'Probable', 'Available'].includes(status)) continue;
      if (!carry.date || !carry.matchup || !carry.team || !missing && !player) { issues.push(`Page ${pageIndex + 1}: row without complete date/matchup/team/player context.`); continue; }
      rows.push({ gameDate: carry.date, matchup: carry.matchup, teamName: carry.team, playerName: missing ? null : player,
        status: missing ? 'NOT_SUBMITTED' : status.toUpperCase(), reason: cells.get('reason') ?? null, page: pageIndex + 1, excerpt: combined });
    }
  }
  if (timestamps.size !== 1) issues.push('Unique document report timestamp unavailable or inconsistent.');
  return { reportedAt: timestamps.size === 1 ? [...timestamps][0] : null, rows, text: lines.join('\n'), issues };
}

export async function extractOfficialPdf(bytes: Uint8Array): Promise<PdfItem[][]> {
  if (bytes.byteLength > 5_000_000 || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new Error('Bounded valid PDF required.');
  const moduleUrl = import.meta.resolve('unpdf');
  return new Promise((resolve, reject) => {
    const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads'); (async()=>{let pdf;try{const {getDocumentProxy,extractTextItems}=await import(workerData.moduleUrl);pdf=await getDocumentProxy(new Uint8Array(workerData.bytes),{isEvalSupported:false,maxImageSize:1000000});if(pdf.numPages>30)throw new Error('PDF page limit');const result=await extractTextItems(pdf);if(result.items.reduce((sum,page)=>sum+page.length,0)>50000)throw new Error('PDF item limit');parentPort.postMessage({items:result.items});}catch(error){parentPort.postMessage({error:String(error.message)});}finally{if(pdf&&typeof pdf.destroy==='function')await pdf.destroy().catch(()=>{});}})();`,
      { eval: true, workerData: { moduleUrl, bytes }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('PDF extraction timeout.')); }, 10000);
    worker.once('message', (result: { items?: PdfItem[][]; error?: string }) => { clearTimeout(timer); void worker.terminate(); if (result.error || !result.items) reject(new Error(result.error ?? 'PDF extraction unavailable.')); else resolve(result.items); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('PDF worker terminated.')); });
  });
}

export function officialReportRevision(parsed: ParsedOfficialReport, bytes: Uint8Array | string, url: string, fetchedAt: string, previous?: ReportRevision | null): ReportRevision {
  return createRevision({ sourceId: 'nba-official-injuries', url, bytes, mediaType: 'PDF', fetchedAt, previous,
    parsed: { title: 'NBA Official Injury Report', author: null, publishedAt: parsed.reportedAt, updatedAt: parsed.reportedAt, text: parsed.text, originalUrls: [], issues: parsed.issues } });
}

export function officialReportClaims(parsed: ParsedOfficialReport, document: ReportRevision, target: TargetEvent, teams: Array<{ teamId: number; names: string[] }>, identities: IdentityEntry[]): { claims: IntelligenceClaim[]; missing: string[] } {
  const claims: IntelligenceClaim[] = [];
  const missing = [...parsed.issues];
  if (!parsed.reportedAt || parsed.issues.length) return { claims, missing };
  for (const row of parsed.rows) {
    if (row.gameDate !== target.basketballDate || !target.matchupAliases.includes(row.matchup)) continue;
    const matchingTeams = teams.filter(team => team.names.includes(row.teamName) && [target.homeTeamId, target.awayTeamId].includes(team.teamId));
    if (matchingTeams.length !== 1) { missing.push(`Unresolved report team: ${row.teamName}`); continue; }
    const teamId = matchingTeams[0].teamId;
    const identity = row.playerName ? resolveIdentity(row.playerName, teamId, target.startsAt, identities) : { playerId: null, reason: null };
    if (row.playerName && identity.playerId == null) { missing.push(`${row.playerName}: ${identity.reason}`); continue; }
    const start = document.text.indexOf(row.excerpt);
    if (start < 0) { missing.push('Report row is not preserved in document text.'); continue; }
    const endsAt = new Date(Date.parse(target.startsAt) + 12 * 3600000).toISOString();
    const value = row.status;
    claims.push(freeze({ id: digest(`${document.revisionId}:${target.gameId}:${teamId}:${identity.playerId}:${row.page}:${start}`), documentRevisionId: document.revisionId, sourceId: document.sourceId,
      topic: value === 'NOT_SUBMITTED' ? 'MISSING_SUBMISSION' : 'INJURY', playerIds: identity.playerId ? [identity.playerId] : [], teamId, gameId: target.gameId,
      appliesFrom: `${target.basketballDate}T00:00:00Z`, appliesUntil: endsAt, statementAt: parsed.reportedAt, reportedAt: parsed.reportedAt,
      value, qualifier: 'EXPLICIT', lineupLevel: null, speaker: null, evidence: { excerpt: row.excerpt, start, end: start + row.excerpt.length, page: row.page, timecode: null },
      originalClaimId: null, originalUrls: [], extraction: 'OFFICIAL_STRUCTURED', reviewedBy: null, reviewedAt: null, correctionOf: null }));
  }
  for (const teamId of [target.homeTeamId, target.awayTeamId]) if (!claims.some(claim => claim.teamId === teamId)) missing.push(`No matched official report rows for team ${teamId}; absence from document is not ACTIVE or a proven missing submission.`);
  return { claims, missing };
}