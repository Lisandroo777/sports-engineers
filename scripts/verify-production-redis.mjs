import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function verifyRedis(kv, sessions) {
  const prefix = `deepside:diagnostic:${randomUUID()}:`;
  const lockKey = `${prefix}lock`;
  const countKey = `${prefix}count`;
  const jsonKey = `${prefix}json`;
  const owner = randomUUID();
  let sessionId;
  try {
    assert.equal(kv.hasDurableKV(), true);
    assert.equal(await kv.kvSetNx(lockKey, owner, 60000), true);
    assert.equal(await kv.kvSetNx(lockKey, 'other-owner', 60000), false);
    const increment = "local value = redis.call('INCR', KEYS[1]); redis.call('PEXPIRE', KEYS[1], 60000); return value";
    const counts = await Promise.all(Array.from({ length: 5 }, () => kv.kvEval(increment, [countKey], [])));
    assert.deepEqual(counts.sort((left, right) => left - right), [1, 2, 3, 4, 5]);
    const unlock = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
    assert.equal(await kv.kvEval(unlock, [lockKey], ['other-owner']), 0);
    assert.equal(await kv.kvEval(unlock, [lockKey], [owner]), 1);
    await kv.kvSetJson(jsonKey, { diagnostic: true, owner }, 60000);
    assert.deepEqual(await kv.kvGetJson(jsonKey), { diagnostic: true, owner });
    const session = {
      sport: 'nfl', date: '2026-10-15', queryIntent: 'isolated Redis diagnostic; not a pick',
      generatedAt: new Date().toISOString(), candidates: [],
      toolMeta: { gamesFound: 0, gamesScheduled: 0, propsFound: 0, booksFound: 0,
        candidatesFound: 0, eliteFound: 0, cached: false, dataFreshnessSeconds: null, budgetLimited: false },
    };
    sessionId = await sessions.saveResearchSession(session);
    const stored = await kv.kvGetJson(`ai-session:${sessionId}`);
    assert.equal(stored.sessionEncoding, 'deflate-base64-v1');
    assert.ok(stored.expiresAt > Date.now());
    assert.deepEqual(await sessions.getResearchSession(sessionId), session);
  } finally {
    const cleanup = await Promise.allSettled([
      ...[lockKey, countKey, jsonKey].map(key => kv.kvDel(key)),
      ...(sessionId ? [sessions.deleteResearchSession(sessionId)] : []),
    ]);
    assert.ok(cleanup.every(result => result.status === 'fulfilled'), 'Diagnostic cleanup failed');
  }
  assert.equal(await kv.kvGetJson(jsonKey), null);
  assert.equal(await sessions.getResearchSession(sessionId), null);
  assert.equal(await kv.kvEval('return redis.call("EXISTS", KEYS[1], KEYS[2], KEYS[3])', [lockKey, countKey, jsonKey], []), 0);
  return { atomicOperations: true, sessionPersistence: true, cleanup: true };
}

async function main() {
  const { default: typescript } = await import('typescript');
  const ledgerPrefix = process.env.DEEPSIDE_VERIFY_LEDGER === 'true' ? `deepside:diagnostic:${randomUUID()}:ledger` : null;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && context.parentURL) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.endsWith('.ts')) {
        let source = readFileSync(fileURLToPath(url), 'utf8');
        if (ledgerPrefix && url.endsWith('/lib/nfl/predictionLedger/redisStore.ts')) {
          assert.ok(source.includes("const PREFIX = 'nfl-ledger:v1';"));
          source = source.replace("const PREFIX = 'nfl-ledger:v1';", `const PREFIX = '${ledgerPrefix}';`);
        }
        return { format: 'module', shortCircuit: true, source: typescript.transpileModule(source, {
          compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 },
        }).outputText };
      }
      return nextLoad(url, context);
    },
  });
  const kv = await import('../lib/storage/kv.ts');
  const sessions = await import('../lib/ai/agent/sessionStore.ts');
  console.log(JSON.stringify({ redisDiagnostic: await verifyRedis(kv, sessions), storage: kv.getDurableKVStatus() }));
  if (ledgerPrefix) {
    try {
      const { signPresentationReceipt, verifyPresentationReceipt } = await import('../lib/nfl/predictionLedger/security.ts');
      const { captureAcknowledgedNFLRows } = await import('../lib/nfl/predictionLedger/capture.ts');
      const { redisNFLLedgerRepository } = await import('../lib/nfl/predictionLedger/redisStore.ts');
      const { verifyLedger } = await import('./verify-production-ledger.mjs');
      const result = await verifyLedger({ sign: signPresentationReceipt, verify: verifyPresentationReceipt,
        capture: captureAcknowledgedNFLRows, repository: redisNFLLedgerRepository });
      console.log(JSON.stringify({ isolatedLedgerDiagnostic: result }));
    } finally {
      await kv.kvDeleteByPrefix(`${ledgerPrefix}:`);
      assert.equal(await kv.kvEval("return #redis.call('KEYS', ARGV[1])", [], [`${ledgerPrefix}:*`]), 0);
      console.log(JSON.stringify({ isolatedLedgerCleanup: true }));
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error('Isolated Redis/session diagnostic failed; details withheld to protect credentials. Paid activation is blocked.');
    process.exitCode = 1;
  });
}