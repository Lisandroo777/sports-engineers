import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('manual NBA market verification approval boundary', () => {
  it('defaults to a zero-network dry run with exactly 31 contracts and the approved worst-case cost', () => {
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('./verifyLiveMarkets.mjs', import.meta.url))],
      { encoding: 'utf8', cwd: fileURLToPath(new URL('../..', import.meta.url)), env: { ...process.env, NODE_NO_WARNINGS: '1', THE_ODDS_API_KEY: '' } });
    const plan = JSON.parse(output);
    expect(plan).toMatchObject({ dryRun: true, networkRequests: 0, regions: 'us,us2', maxCredits: 63 });
    expect(plan.markets).toHaveLength(31);
    expect(new Set(plan.markets).size).toBe(31);
    expect(plan.markets).toEqual(expect.arrayContaining(['player_blocks_steals', 'player_double_double', 'player_rebounds_q1', 'player_assists_q1']));
    expect(plan.markets).not.toContain('points_q2');
  });
});