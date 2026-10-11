import { hasDurableKV } from '../../storage/kv';
import type { NFLGradeRevision, NFLLedgerRepository, NFLPredictionRecord, NFLPredictionSnapshot } from './types';

const PREFIX = 'nfl-ledger:v1';
const CAPTURE_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if existing then return cjson.encode({record=cjson.decode(redis.call('GET', ARGV[2] .. existing)),snapshot=cjson.decode(redis.call('GET', ARGV[1] .. existing))}) end
local snapshot = cjson.decode(ARGV[3])
local prior = redis.call('GET', KEYS[2])
if prior then snapshot.lineageFromPredictionId = prior end
local record = {currentGrade='PENDING',currentActual=cjson.null,currentRevisionId=cjson.null}
local encoded = cjson.encode(record)
redis.call('SET', KEYS[1], snapshot.predictionId)
redis.call('SET', ARGV[1] .. snapshot.predictionId, cjson.encode(snapshot))
redis.call('SET', ARGV[2] .. snapshot.predictionId, encoded)
redis.call('ZADD', KEYS[3], ARGV[4], snapshot.predictionId)
redis.call('SET', KEYS[2], snapshot.predictionId)
redis.call('ZADD', KEYS[4], ARGV[4], snapshot.gameId .. '|' .. snapshot.playerId)
return cjson.encode({record=record,snapshot=snapshot})
`;
const REVISION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return redis.error_reply('prediction not found') end
local record = cjson.decode(raw)
local revision = cjson.decode(ARGV[2])
if record.currentRevisionId then
  local current = redis.call('GET', ARGV[1] .. 'revision:' .. record.currentRevisionId)
  if current then
    local currentRevision = cjson.decode(current)
    if currentRevision.sourceSignature == revision.sourceSignature and currentRevision.grade == revision.grade and currentRevision.actual == revision.actual then return raw end
  end
end
revision.supersedesRevisionId = record.currentRevisionId
local encodedRevision = cjson.encode(revision)
redis.call('SET', ARGV[1] .. 'revision:' .. revision.revisionId, encodedRevision)
redis.call('ZADD', ARGV[1] .. 'revisions:' .. revision.predictionId, ARGV[3], revision.revisionId)
record.currentGrade = revision.grade
record.currentActual = revision.actual
record.currentRevisionId = revision.revisionId
redis.call('SET', KEYS[1], cjson.encode(record))
return cjson.encode(record)
`;

function config() {
  const url = process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function command<T>(args: Array<string | number>): Promise<T> {
  const target = config();
  if (!target || !hasDurableKV()) throw new Error('NFL prediction ledger requires shared durable Redis/KV in every environment.');
  const response = await fetch(target.url, { method: 'POST', headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  if (!response.ok) throw new Error(`NFL ledger Redis request failed (${response.status}).`);
  const body = await response.json() as { result?: T; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result as T;
}

const recordKey = (id: string) => `${PREFIX}:record:${id}`;
const snapshotKey = (id: string) => `${PREFIX}:snapshot:${id}`;
const fingerprintKey = (fingerprint: string) => `${PREFIX}:dedupe:${fingerprint}`;
const playKey = (snapshot: NFLPredictionSnapshot) => `${PREFIX}:lineage:${snapshot.gameId}:${snapshot.playerId ?? snapshot.player.toLowerCase()}:${snapshot.marketKey}:${snapshot.direction}`;
const recordFromEncoded = (value: string | null): Omit<NFLPredictionRecord, 'snapshot'> | null => value ? JSON.parse(value) : null;
const mergeRecord = (record: Omit<NFLPredictionRecord, 'snapshot'> | null, snapshot: NFLPredictionSnapshot | null): NFLPredictionRecord | null => record && snapshot ? { ...record, snapshot } : null;

export const redisNFLLedgerRepository: NFLLedgerRepository = {
  async capture(snapshot) {
    const playId = `${snapshot.gameId}|${snapshot.playerId ?? snapshot.player.toLowerCase()}|${snapshot.marketKey}|${snapshot.direction}`;
    const result = await command<string>(['EVAL', CAPTURE_SCRIPT, 4, fingerprintKey(snapshot.dedupeFingerprint), playKey(snapshot), `${PREFIX}:recent`, `${PREFIX}:grading`, `${PREFIX}:snapshot:`, `${PREFIX}:record:`, JSON.stringify(snapshot), Date.parse(snapshot.createdAt), playId]);
    const encoded = JSON.parse(result) as { record: Omit<NFLPredictionRecord, 'snapshot'>; snapshot: NFLPredictionSnapshot };
    const record = mergeRecord(encoded.record, encoded.snapshot);
    if (!record) throw new Error('Atomic ledger capture returned no record.');
    return { created: record.snapshot.predictionId === snapshot.predictionId, record };
  },
  async get(id) {
    const [record, snapshot] = await Promise.all([command<string | null>(['GET', recordKey(id)]), command<string | null>(['GET', snapshotKey(id)])]);
    return mergeRecord(recordFromEncoded(record), snapshot ? JSON.parse(snapshot) as NFLPredictionSnapshot : null);
  },
  async list({ offset = 0, limit = 100 } = {}) {
    const ids = await command<string[]>(['ZREVRANGE', `${PREFIX}:recent`, Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit) - 1]);
    if (!ids?.length) return [];
    const records = await Promise.all(ids.map((id) => redisNFLLedgerRepository.get(id)));
    return records.filter((record): record is NFLPredictionRecord => record != null);
  },
  async appendRevision(revision) {
    const key = recordKey(revision.predictionId);
    const before = await redisNFLLedgerRepository.get(revision.predictionId);
    if (!before) throw new Error('Prediction not found.');
    const result = recordFromEncoded(await command<string>(['EVAL', REVISION_SCRIPT, 1, key, `${PREFIX}:`, JSON.stringify(revision), Date.parse(revision.revisedAt)]));
    const record = mergeRecord(result, before.snapshot);
    if (!record) throw new Error('Atomic grading revision returned no record.');
    return { created: record.currentRevisionId === revision.revisionId, record };
  },
  async revisions(id) {
    const ids = await command<string[]>(['ZRANGE', `${PREFIX}:revisions:${id}`, 0, -1]);
    const values = await Promise.all((ids ?? []).map((revisionId) => command<string | null>(['GET', `${PREFIX}:revision:${revisionId}`])));
    return values.filter((value): value is string => value != null).map((value) => JSON.parse(value) as NFLGradeRevision);
  },
};
