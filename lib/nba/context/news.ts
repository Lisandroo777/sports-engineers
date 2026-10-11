import { addEvidence, freshness } from './evidence';
import type { BuildEnvironment, NewsContext } from './types';

export function buildNews(env: BuildEnvironment): NewsContext {
  const evidenceIds: string[] = [];
  const seen = new Set<string>();
  for (const news of env.snapshot.news) {
    if (seen.has(news.id) || !news.playerIds.includes(env.request.playerId) && !news.teamIds.includes(env.request.teamId)) continue;
    seen.add(news.id);
    const state = freshness(news.source, env.cutoff, 48);
    if (state !== 'FRESH' || !news.source.publishedAt) continue;
    evidenceIds.push(addEvidence(env, { id: `news.${news.id}`, metric: 'attributedReport', kind: 'FACT', value: { headline: news.headline, reportText: news.text },
      detail: 'Fact of a published secondary-source report, not independent verification of the claim. No injury, lineup, coaching or restriction conclusion is extracted automatically.',
      sourceRefs: [{ ...news.source, freshness: state }], reliability: 'LOW', correlationGroup: 'news.report' }));
  }
  for (const report of env.snapshot.injuries.filter(report => report.playerId === env.request.playerId || report.teamId === env.request.teamId)) {
    if (!report.comment || freshness(report.source, env.cutoff, 48) !== 'FRESH') continue;
    const id = `news.injury.${report.playerId ?? 'unknown'}.${report.source.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    evidenceIds.push(addEvidence(env, { id, metric: 'attributedInjuryComment', kind: 'FACT', value: report.comment,
      detail: 'Provider-attributed comment; day-to-day wording does not establish a current game designation or future minutes restriction.', sourceRefs: [report.source], reliability: 'LOW', correlationGroup: 'availability.team' }));
  }
  if (!evidenceIds.length) evidenceIds.push(addEvidence(env, { id: 'news.coverage', metric: 'teamPlayerNews', detail: 'No fresh, identity-linked pre-cutoff report in connected summaries. Comprehensive team/local news and verified player/coach comments unavailable.', correlationGroup: 'news.report' }));
  return { evidenceIds };
}