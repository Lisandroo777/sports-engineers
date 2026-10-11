import { mkdir, readFile, readdir, link, unlink, writeFile, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, freeze, timestamp } from './documents';
import type { IntelligenceClaim, IntelligenceStore, NBAIntelligenceSnapshot, ReportRevision } from './types';

export class MemoryIntelligenceStore implements IntelligenceStore {
  private documents = new Map<string, ReportRevision>();
  private claims = new Map<string, IntelligenceClaim>();
  private snapshots = new Map<string, NBAIntelligenceSnapshot>();
  private refreshState = new Map<string, number>();
  private put<Value>(map: Map<string, Value>, id: string, value: Value) {
    const existing = map.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('Immutable record collision.');
    if (!existing) map.set(id, freeze(JSON.parse(JSON.stringify(value)) as Value));
  }
  async putDocument(value: ReportRevision) { this.put(this.documents, value.revisionId, value); }
  async listDocuments(documentId?: string) { return [...this.documents.values()].filter(value => documentId == null || value.documentId === documentId); }
  async putClaims(values: IntelligenceClaim[]) { for (const value of values) this.put(this.claims, value.id, value); }
  async listClaims() { return [...this.claims.values()]; }
  async putSnapshot(value: NBAIntelligenceSnapshot) { this.put(this.snapshots, value.snapshotId, value); }
  async latestSnapshot(gameId: string, before: string) { return [...this.snapshots.values()].filter(value => value.target.gameId === gameId && Date.parse(value.asOf) < Date.parse(before)).sort((first, second) => Date.parse(second.asOf) - Date.parse(first.asOf))[0] ?? null; }
  async reserveRefresh(key: string, at: string, minIntervalMs: number) {
    const time = Date.parse(at);
    if (!Number.isFinite(time) || minIntervalMs < 0) throw new Error('Invalid refresh reservation.');
    if (time < (this.refreshState.get(key) ?? 0)) return false;
    this.refreshState.set(key, time + minIntervalMs);
    return true;
  }
  async recordBackoff(key: string, retryAt: string) { this.refreshState.set(key, Math.max(this.refreshState.get(key) ?? 0, Date.parse(retryAt))); }
}

export function createFileIntelligenceStore(root: string): IntelligenceStore {
  if (typeof window !== 'undefined') throw new Error('File store requires Node server runtime.');
  const key = (value: string) => digest(value);
  async function put(folder: string, id: string, value: unknown) {
    const directory = join(root, folder);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${key(id)}.json`);
    const payload = JSON.stringify(value);
    if (Buffer.byteLength(payload) > 8_000_000) throw new Error('Stored record size limit exceeded.');
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, payload, { flag: 'wx', mode: 0o600 });
      try { await link(temporary, file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (await readFile(file, 'utf8') !== payload) throw new Error('Immutable durable record collision.');
      }
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  async function list<Value>(folder: string): Promise<Value[]> {
    const directory = join(root, folder);
    let files: string[];
    try { files = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (files.length > 10000) throw new Error('Store requires archival partitioning; record scan limit exceeded.');
    return Promise.all(files.filter(file => /^[a-f0-9]{64}\.json$/.test(file)).sort().map(async file => {
      const text = await readFile(join(directory, file), 'utf8');
      if (Buffer.byteLength(text) > 8_000_000) throw new Error('Stored record size limit exceeded.');
      return freeze(JSON.parse(text) as Value);
    }));
  }
  async function reserve(keyValue: string, at: string, interval: number): Promise<boolean> {
    const directory = join(root, 'refresh');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${key(keyValue)}.state`);
    const lock = `${file}.lock`;
    let handle;
    try { handle = await open(lock, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const lockStat = await stat(lock).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > 60000) await unlink(lock).catch(() => undefined);
      return false;
    }
    try {
      let next = 0;
      try { next = Number(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!Number.isFinite(next)) throw new Error('Corrupt refresh state; refusing source access.');
      const time = Date.parse(at);
      if (!Number.isFinite(time) || interval < 0) throw new Error('Invalid refresh reservation.');
      if (time < next) return false;
      await writeFile(file, String(time + interval), { mode: 0o600 });
      return true;
    } finally { await handle.close(); await unlink(lock).catch(() => undefined); }
  }
  return {
    async putDocument(value) { if (value.schemaVersion !== '1' || !timestamp(value.firstSeenAt)) throw new Error('Invalid document contract.'); await put('documents', value.revisionId, value); },
    async listDocuments(documentId) { return (await list<ReportRevision>('documents')).filter(value => !documentId || value.documentId === documentId); },
    async putClaims(values) { for (const value of values) await put('claims', value.id, value); },
    listClaims() { return list<IntelligenceClaim>('claims'); },
    async putSnapshot(value) { if (value.schemaVersion !== '1' || !timestamp(value.asOf)) throw new Error('Invalid snapshot contract.'); await put('snapshots', value.snapshotId, value); },
    async latestSnapshot(gameId, before) { return (await list<NBAIntelligenceSnapshot>('snapshots')).filter(value => value.target.gameId === gameId && Date.parse(value.asOf) < Date.parse(before)).sort((first, second) => Date.parse(second.asOf) - Date.parse(first.asOf))[0] ?? null; },
    reserveRefresh: reserve,
    async recordBackoff(keyValue, retryAt) { if (!timestamp(retryAt)) throw new Error('Invalid retry timestamp.'); await reserve(keyValue, retryAt, 0); },
  };
}