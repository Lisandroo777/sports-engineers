'use client';

import { useEffect, useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';

type Stats = { sampleSize: number; wins: number; losses: number; pushes: number; hitRate: number | null; averageOdds: number | null; units: number; roiPercent: number | null; averagePredictedProbability: number | null; actualHitRate: number | null };
type Report = {
  scope: 'GLOBAL'; modelVersion: string; overall: Stats; counts: { totalForwardPregame: number; graded: number; pending: number; void: number; ungradable: number; excludedPostKickoff: number; excludedKickoffUnverified: number };
  byTier: Record<string, Stats>; byMarket: Record<string, Stats>; byDirection: Record<string, Stats>;
  byRankingIntent: Record<string, Stats>; bySeasonPhase: Record<string, Stats>; probabilityBuckets: Record<string, Stats>;
  nuke: Stats & { separateFromOverall: boolean }; standardVsDeep: Record<string, Stats>;
  calibration: { status: string; sampleSize: number; meanSquaredError: number | null; byProbabilityBucket: Record<string, { sampleSize: number; averagePredictedProbability: number | null; actualHitRate: number | null }> };
  sampleWarning: string;
};
type Recent = { predictionId: string; createdAt: string; player: string; market: string; direction: string; line: number; odds: number; tier: string; probability: number | null; actual: number | null; grade: string };

function percent(value: number | null) { return value == null ? 'Not available' : `${(value * 100).toFixed(1)}%`; }
function odds(value: number) { return value > 0 ? `+${value}` : String(value); }
function roi(value: number | null) { return value == null ? 'Not available' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`; }
function metric(value: number | null) { return value == null ? 'Not available' : value.toFixed(2); }

function AccessGate({ onAccess }: { onAccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/nfl/ledger/access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!response.ok) throw new Error('Access was not granted.');
      setPassword(''); onAccess();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Access was not granted.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="w-full max-w-sm border border-white/10 bg-[#0a100c] p-5">
    <h2 className="text-base font-semibold text-white">Restricted track record</h2>
    <p className="mt-2 text-sm text-slate-400">Enter the authorized Performance access key. Prediction records are not public.</p>
    <label className="mt-5 block text-xs font-medium text-slate-300" htmlFor="ledger-password">Access key</label>
    <input id="ledger-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required
      className="mt-2 min-h-11 w-full border border-white/15 bg-black/30 px-3 text-sm text-white outline-none focus:border-emerald-400" />
    {error && <p role="alert" className="mt-2 text-sm text-rose-300">{error}</p>}
    <button disabled={busy} className="mt-4 min-h-10 w-full bg-emerald-400 px-4 text-sm font-bold text-black disabled:opacity-50">{busy ? 'Checking...' : 'Unlock Performance'}</button>
  </form>;
}

function StatBlock({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="min-w-0 border-l border-emerald-400/35 pl-4">
    <p className="text-[10px] font-semibold uppercase text-slate-500">{label}</p>
    <p className="mt-1 truncate text-xl font-semibold tabular-nums text-white">{value}</p>
    {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
  </div>;
}

function Breakdown({ title, values }: { title: string; values: Record<string, Stats> }) {
  const entries = Object.entries(values);
  return <section className="min-w-0 border-t border-white/10 pt-4">
    <h2 className="text-sm font-semibold text-white">{title}</h2>
    {entries.length ? <div className="mt-3 divide-y divide-white/[0.06]">
      {entries.map(([name, stats]) => <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 text-sm">
        <span className="truncate text-slate-300">{name}</span>
        <span className="tabular-nums text-slate-400">{stats.wins}-{stats.losses}{stats.pushes ? `-${stats.pushes}` : ''}</span>
        <span className="w-16 text-right tabular-nums text-white">{roi(stats.roiPercent)}</span>
      </div>)}
    </div> : <p className="mt-3 text-sm text-slate-500">No forward graded results yet.</p>}
  </section>;
}

export default function PerformancePage() {
  const [authorized, setAuthorized] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/nfl/ledger', { cache: 'no-store' });
      if (response.status === 401) { setAuthorized(false); return; }
      if (!response.ok) throw new Error('Track record data is temporarily unavailable.');
      const body = await response.json() as { report: Report; recent: Recent[] };
      setReport(body.report); setRecent(body.recent); setAuthorized(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load the track record.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    fetch('/api/nfl/ledger', { cache: 'no-store' }).then(async (response) => {
      if (response.status === 401) return null;
      if (!response.ok) throw new Error('Track record data is temporarily unavailable.');
      return await response.json() as { report: Report; recent: Recent[] };
    }).then((body) => {
      if (!active) return;
      if (!body) { setAuthorized(false); return; }
      setReport(body.report); setRecent(body.recent); setAuthorized(true);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not load the track record.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function signOut() {
    await fetch('/api/nfl/ledger/access', { method: 'DELETE' });
    setAuthorized(false); setReport(null); setRecent([]);
  }

  return <div className="flex min-h-screen bg-[var(--se-bg)] text-white">
    <AppSidebar currentPath="/performance" />
    <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-10 pt-5 sm:px-7">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
        <div><p className="text-[10px] font-bold uppercase text-emerald-300">NFL - GLOBAL</p><h1 className="mt-1 text-2xl font-semibold">Performance / Track Record</h1>
          <p className="mt-1 text-sm text-slate-400">Forward recommendations | {report?.modelVersion ?? 'NFL_MODEL_V1_1_HARDENED'}</p></div>
        {authorized && <div className="flex gap-2"><button onClick={() => void load()} title="Refresh track record" aria-label="Refresh track record" className="min-h-9 border border-white/15 px-3 text-sm text-slate-300 hover:border-emerald-400/50">Refresh</button>
          <button onClick={() => void signOut()} className="min-h-9 border border-white/15 px-3 text-sm text-slate-300 hover:text-white">Lock</button></div>}
      </header>
      {!authorized && !loading && !error ? <div className="flex min-h-[55vh] items-center justify-center"><AccessGate onAccess={() => void load()} /></div>
        : loading && !report ? <p className="py-12 text-sm text-slate-400">Loading protected track record...</p>
          : error ? <div role="alert" className="py-8 text-sm text-rose-300">{error}<button onClick={() => void load()} className="ml-3 border border-white/15 px-3 py-1 text-slate-200">Retry</button></div>
            : report && <div className="space-y-8 py-6">
              <p className="border-l-2 border-amber-300 px-3 py-2 text-sm text-amber-100">{report.sampleWarning} Probability calibration is offline reporting only and remains unvalidated.</p>
              <section aria-label="Overall performance" className="grid grid-cols-2 gap-5 border-b border-white/10 pb-6 sm:grid-cols-3 xl:grid-cols-7">
                <StatBlock label="Record" value={`${report.overall.wins}-${report.overall.losses}-${report.overall.pushes}`} detail={`${report.overall.sampleSize} binary grades`} />
                <StatBlock label="Hit rate" value={percent(report.overall.hitRate)} detail="W / (W + L), pushes excluded" />
                <StatBlock label="Unit return" value={`${report.overall.units >= 0 ? '+' : ''}${report.overall.units.toFixed(2)}u`} detail="1 unit risked per prediction" />
                <StatBlock label="ROI" value={roi(report.overall.roiPercent)} detail="Risked-unit basis" />
                <StatBlock label="Average odds" value={report.overall.averageOdds == null ? 'Not available' : `${report.overall.averageOdds >= 0 ? '+' : ''}${report.overall.averageOdds.toFixed(0)}`} detail="Saved American price" />
                <StatBlock label="Graded / pending" value={`${report.counts.graded} / ${report.counts.pending}`} detail={`${report.counts.ungradable} ungradable | ${report.counts.void} void`} />
                <StatBlock label="Forward snapshots" value={String(report.counts.totalForwardPregame)} detail={`${report.counts.excludedPostKickoff + report.counts.excludedKickoffUnverified} excluded`} />
              </section>
              <div className="grid gap-8 lg:grid-cols-2">
                <section className="border-t border-white/10 pt-4">
                  <h2 className="text-sm font-semibold">NUKE - tracked separately</h2>
                  <div className="mt-4 grid grid-cols-2 gap-y-5 sm:grid-cols-3">
                    <StatBlock label="Sample" value={String(report.nuke.sampleSize)} />
                    <StatBlock label="W-L" value={`${report.nuke.wins}-${report.nuke.losses}`} />
                    <StatBlock label="Hit rate" value={percent(report.nuke.hitRate)} />
                    <StatBlock label="ROI" value={roi(report.nuke.roiPercent)} />
                    <StatBlock label="Avg predicted" value={percent(report.nuke.averagePredictedProbability)} />
                    <StatBlock label="Actual hit rate" value={percent(report.nuke.actualHitRate)} />
                  </div>
                  <p className="mt-4 text-xs text-slate-500">Descriptive tracking only. Early results do not alter qualification requirements.</p>
                </section>
                <section className="border-t border-white/10 pt-4">
                  <h2 className="text-sm font-semibold">Probability calibration - offline</h2>
                  <p className="mt-1 text-xs text-slate-500">Brier score uses saved displayed probabilities; no feedback into production.</p>
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-white/10 pb-2 text-[10px] uppercase text-slate-500"><span>Bucket</span><span>n</span><span>Predicted / actual</span></div>
                  {Object.entries(report.calibration.byProbabilityBucket).map(([bucket, row]) => <div key={bucket} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-white/[0.06] py-2 text-sm"><span className="text-slate-300">{bucket}</span><span className="tabular-nums text-slate-400">{row.sampleSize}</span><span className="tabular-nums text-white">{percent(row.averagePredictedProbability)} / {percent(row.actualHitRate)}</span></div>)}
                  <p className="mt-3 text-xs text-slate-500">Brier score: {metric(report.calibration.meanSquaredError)} | n={report.calibration.sampleSize} | {report.calibration.status}</p>
                </section>
              </div>
              <section className="border-t border-white/10 pt-4">
                <h2 className="text-sm font-semibold">Standard vs Deep</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">{(['STANDARD', 'DEEP'] as const).map((mode) => { const stats = report.standardVsDeep[mode]; return <div key={mode} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] py-3"><span className="text-xs font-semibold uppercase text-slate-300">{mode}</span><span className="text-sm tabular-nums text-white">{stats.wins}-{stats.losses}-{stats.pushes}</span><span className="text-sm tabular-nums text-slate-300">{roi(stats.roiPercent)}</span><span className="text-xs text-slate-500">n={stats.sampleSize}</span></div>; })}</div>
              </section>
              <div className="grid gap-8 lg:grid-cols-2">
                <Breakdown title="By tier" values={report.byTier} />
                <Breakdown title="By market" values={report.byMarket} />
                <Breakdown title="By direction" values={report.byDirection} />
                <Breakdown title="By ranking intent" values={report.byRankingIntent} />
                <Breakdown title="By season phase" values={report.bySeasonPhase} />
                <Breakdown title="Probability buckets" values={report.probabilityBuckets} />
              </div>
              <section className="border-t border-white/10 pt-4">
                <h2 className="text-sm font-semibold">Recent predictions</h2>
                <p className="mt-1 text-xs text-slate-500">Saved recommendation-time values. Later market changes do not rewrite snapshots.</p>
                {recent.length ? <div className="mt-3 divide-y divide-white/[0.07]">{recent.map((item) => <div key={item.predictionId} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-4">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-white">{item.player}</p><p className="truncate text-xs text-slate-400">{item.market} | {item.direction.toUpperCase()} {item.line}</p></div>
                  <p className="text-xs text-slate-400">{odds(item.odds)} | <span className="text-emerald-300">{item.tier}</span></p>
                  <p className="text-xs text-slate-400">Pred {percent(item.probability)}</p><p className="text-xs text-slate-400">Actual {item.actual == null ? 'Unknown' : item.actual}</p>
                  <p className={`text-xs font-semibold ${item.grade === 'WIN' ? 'text-emerald-300' : item.grade === 'LOSS' ? 'text-rose-300' : 'text-slate-300'}`}>{item.grade}</p>
                </div>)}</div> : <div className="py-10 text-center"><p className="text-sm text-slate-300">No forward recommendations recorded yet.</p><p className="mt-1 text-xs text-slate-500">Only rows actually displayed with a verified receipt enter this track record.</p></div>}
              </section>
            </div>}
    </main>
  </div>;
}
