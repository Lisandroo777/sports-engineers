import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('local cache-only preview guard', () => {
  it('overrides inherited acquisition settings without editing environment files or starting a deployment', () => {
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('./previewSafe.mjs', import.meta.url)), '--check'], {
      encoding: 'utf8', env: { ...process.env, ODDS_AUTO_REFRESH: 'true', ODDS_ALLOW_PAID_REFRESH: 'true',
        THE_ODDS_API_KEY: 'fixture-not-a-secret', UPSTASH_REDIS_REST_TOKEN: 'fixture-not-a-secret' },
    });
    expect(output).not.toContain('fixture-not-a-secret');
    const check = JSON.parse(output.trim().split('\n').at(-1));
    expect(check).toMatchObject({ host: '127.0.0.1', paidAcquisition: false, autoRefresh: false,
      providerCredentialsMasked: true, storageCredentialsMasked: true, deployed: false });
    expect(check.project).toContain('deepside-agent-3');
  });
});