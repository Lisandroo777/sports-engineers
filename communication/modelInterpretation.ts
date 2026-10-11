import type { BettingIntent } from './intent';

export function needsModelInterpretation(query: string, intent: BettingIntent): boolean {
  if (intent.action === 'INTERPRET') return true;
  if (intent.action === 'OUT_OF_SCOPE' || intent.action === 'CLARIFY' || intent.action === 'EDUCATION') return false;
  return !/\b(?:give|best|favorite|top|only|safest|most likely|highest probability|most confident|most probable|trust (?:the )?most|most value|where'?s the (?:value|edge)|compare|why|risk|deep|deeper|left|anything|make it|props?|picks?|plays?|receptions?|yards?|unders?|overs?|nukes?|elite|lines?|moneyline|what do you like|what are you on)\b/i.test(query);
}
export async function interpretWithLanguageModel(query: string, base: BettingIntent, apiKey: string, model: string): Promise<BettingIntent> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_output_tokens: 1200, text: { format: { type: 'json_object' } },
      instructions: 'You interpret sports-betting language ONLY. Return a JSON object of intent fields, not picks, stats, odds or research. Never invent candidates. Use action PICKS, EXPLAIN, COMPARE, EDUCATION, OUT_OF_SCOPE or CLARIFY. Optional fields sport (nfl/nba/mlb/soccer/tennis), requestedCount (1..15), rankingIntent (BEST/MOST_LIKELY/BEST_VALUE), researchMode (STANDARD/DEEP; explicit deeper request only), players(string[]), markets(canonical player market keys[]), directions(over/under[]), requestedTiers(NUKE/ELITE/SHARP/EDGE/LEAN[]), linePreference(LOW_THRESHOLD/null), combinationIntent(boolean), clarification(string), unsupportedMarket(string). Preserve existing dimensions unless the user explicitly changes them. For ambiguous signed odds ask a clarification; do not invent a bound. Unrelated requests OUT_OF_SCOPE. Unsupported game/half/quarter markets must be reported honestly. Do not emit candidate IDs.',
      input: [{ role: 'user', content: JSON.stringify({ request: query, priorIntent: base }) }] }),
  });
  if (!response.ok) return { ...base, action: 'CLARIFY', clarification: 'Could you clarify the picks or betting research you want?' };
  const payload = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  let interpreted: Record<string, unknown>;
  try {
    interpreted = JSON.parse(payload.output?.flatMap((item) => item.content ?? []).filter((chunk) => chunk.type === 'output_text').map((chunk) => chunk.text ?? '').join('') ?? '{}');
  } catch { return { ...base, action: 'CLARIFY', clarification: 'Could you clarify the picks or betting research you want?' }; }
  const result = structuredClone(base);
  const locked = new Set(base.changedDimensions);
  const enumField = (key: keyof BettingIntent, values: string[]) => {
    if (!locked.has(key) && typeof interpreted[key] === 'string' && values.includes(interpreted[key] as string)) Object.assign(result, { [key]: interpreted[key] });
  };
  enumField('sport', ['nfl', 'nba', 'mlb', 'soccer', 'tennis']);
  enumField('rankingIntent', ['BEST', 'MOST_LIKELY', 'BEST_VALUE']);
  enumField('action', ['PICKS', 'EXPLAIN', 'COMPARE', 'EDUCATION', 'OUT_OF_SCOPE', 'CLARIFY']);
  if (!locked.has('requestedCount') && Number.isInteger(interpreted.requestedCount) && Number(interpreted.requestedCount) >= 1 && Number(interpreted.requestedCount) <= 15) result.requestedCount = Number(interpreted.requestedCount);
  for (const key of ['players', 'markets', 'directions', 'requestedTiers'] as const) {
    const value = interpreted[key];
    if (locked.has(key) || !Array.isArray(value) || value.length > 15 || !value.every((entry) => typeof entry === 'string' && entry.length <= 100)) continue;
    if (key === 'directions' && !value.every((entry) => ['over', 'under'].includes(entry))) continue;
    if (key === 'requestedTiers' && !value.every((entry) => ['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN'].includes(entry))) continue;
    if (key === 'markets' && !value.every((entry) => /^player_[a-z_]+$/.test(entry))) continue;
    Object.assign(result, { [key]: value });
  }
  if (typeof interpreted.unsupportedMarket === 'string' && interpreted.unsupportedMarket.length <= 100) result.unsupportedMarket = interpreted.unsupportedMarket;
  if (result.action === 'CLARIFY') result.clarification = typeof interpreted.clarification === 'string' ? interpreted.clarification.slice(0, 200) : 'Which bet or market do you mean?';
  result.explanationIntent = result.action === 'EXPLAIN';
  result.comparisonIntent = result.action === 'COMPARE';
  if (!locked.has('combinationIntent') && interpreted.combinationIntent === true) result.combinationIntent = true;
  return result;
}