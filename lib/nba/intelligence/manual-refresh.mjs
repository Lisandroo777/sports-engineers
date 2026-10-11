import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const config = process.argv[2];
if (!config) throw new Error('Usage: node lib/nba/intelligence/manual-refresh.mjs /absolute/path/to/refresh-config.json');
const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
try {
  const refreshModule = await server.ssrLoadModule(fileURLToPath(new URL('./refresh.cli.ts', import.meta.url)));
  console.log(JSON.stringify(await refreshModule.runManualRefresh(config), null, 2));
} finally { await server.close(); }