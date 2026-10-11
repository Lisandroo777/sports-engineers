import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { fixtureInput } from './fixtures';

describe('explicit one-shot CLI', () => {
  it('finishes without polling or opening a server and stores an unavailable snapshot without any source requests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nba-intelligence-cli-'));
    try {
      const config = join(directory, 'config.json'); const storeDirectory = join(directory, 'store');
      const input = fixtureInput();
      await writeFile(config, JSON.stringify({ storeDirectory, requests: [], grants: [], target: input.target, identities: input.identities, teams: [] }));
      const result = await promisify(execFile)(process.execPath, ['lib/nba/intelligence/manual-refresh.mjs', config], { cwd: process.cwd(), timeout: 15000, env: { ...process.env, ODDS_ALLOW_PAID_REFRESH: 'false', THE_ODDS_API_KEY: '', OPENAI_API_KEY: '' } });
      const output = JSON.parse(result.stdout);
      expect(output.refresh.requestsUsed).toBe(0);
      expect(output.snapshot.schemaVersion).toBe('1');
      expect(output.snapshot.coverage.refreshMode).toBe('MANUAL');
      expect(output.snapshot.lineups.every((lineup: { level: string }) => lineup.level === 'UNKNOWN')).toBe(true);
      expect(await readFile(config, 'utf8')).toContain('"requests":[]');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});