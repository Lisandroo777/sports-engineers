import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const port = process.env.NBA_SAFE_PREVIEW_PORT ?? '3118';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Invalid local preview port.');
const env = { ...process.env, ODDS_AUTO_REFRESH: 'false', ODDS_ALLOW_PAID_REFRESH: 'false',
  NEXT_DIST_DIR: '.next-verify', THE_ODDS_API_KEY: '', OPENAI_API_KEY: '',
  KV_REST_API_URL: '', KV_REST_API_TOKEN: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' };
console.log(`Local-only cache/mock preview: http://127.0.0.1:${port}/ai?sport=nba`);
console.log('Paid acquisition disabled; provider and durable storage credentials masked in child process. No environment files changed.');
if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ project: root, host: '127.0.0.1', port, paidAcquisition: false, autoRefresh: false,
    providerCredentialsMasked: !env.THE_ODDS_API_KEY && !env.OPENAI_API_KEY,
    storageCredentialsMasked: !env.KV_REST_API_TOKEN && !env.UPSTASH_REDIS_REST_TOKEN, deployed: false }));
} else {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', root, '--hostname', '127.0.0.1', '--port', port],
    { cwd: root, env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', code => { process.exitCode = code ?? 1; });
}