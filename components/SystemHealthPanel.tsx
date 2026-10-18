'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

type State = 'UNKNOWN' | 'NOT_CONFIGURED' | 'CONFIGURED' | 'HEALTHY' | 'DEGRADED' | 'DOWN';
export interface SystemHealthSnapshot {
  checkedAt: number;
  state: State;
  durable: { state: State; configured: boolean | null };
  providers: Record<'odds' | 'openai', { state: State; configured: boolean; authorization: State }>;
  credits: { state: State; freshness: 'UNKNOWN' | 'FRESH' | 'STALE'; balance: number | null; observedAt: number | null; ageMs: number | null };
  refresh: { state: State; enabled: boolean; limits: { perSearchCredits: number; dailyCredits: number; minProviderRemaining: number; requestsPerMinute: number } | null };
  monitoring: { state: State; sports: Array<{ sport: string; state: State; observedAt: number | null; ageMs: number | null; total: number | null; complete: number | null; partial: number | null; failed: number | null; completeRate: number | null; lastOutcome: string | null; durability: 'durable' | 'process-local' | 'unavailable' | null }> };
  healthReadErrors: string[];
}

function label(value: string | null | undefined) {
  if (!value) return 'Unknown';
  return value.toLowerCase().replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
}

function timestamp(value: number | null | undefined) {
  return value == null ? 'Not observed' : new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

function age(value: number | null | undefined) {
  return value == null ? 'Unknown' : `${Math.floor(value / 1000)}s`;
}

function Status({ value }: { value?: string | null }) {
  return <span data-state={value ?? 'UNKNOWN'}>{label(value)}</span>;
}

export function SystemHealthView({ snapshot }: { snapshot: SystemHealthSnapshot | null }) {
  const limits = snapshot?.refresh.limits;
  return <div className="system-health-data">
    <dl className="system-health-facts">
      <div><dt>Last check</dt><dd>{timestamp(snapshot?.checkedAt)}</dd></div>
      <div><dt>Status</dt><dd><Status value={snapshot?.state} /></dd></div>
      <div><dt>Durable storage</dt><dd><Status value={snapshot?.durable.state} /></dd></div>
      <div><dt>Odds API</dt><dd><Status value={snapshot?.providers.odds.state} /></dd></div>
      <div><dt>Odds authorization</dt><dd><Status value={snapshot?.providers.odds.authorization} /></dd></div>
      <div><dt>OpenAI</dt><dd><Status value={snapshot?.providers.openai.state} /></dd></div>
      <div><dt>OpenAI authorization</dt><dd><Status value={snapshot?.providers.openai.authorization} /></dd></div>
      <div><dt>Cached credits</dt><dd>{snapshot?.credits.balance ?? 'Unknown'}</dd></div>
      <div><dt>Credit freshness</dt><dd><Status value={snapshot?.credits.freshness} /></dd></div>
      <div><dt>Credit observation</dt><dd>{timestamp(snapshot?.credits.observedAt)}</dd></div>
      <div><dt>Credit age</dt><dd>{age(snapshot?.credits.ageMs)}</dd></div>
      <div><dt>Automatic refresh</dt><dd>{snapshot ? snapshot.refresh.enabled ? 'Enabled' : 'Disabled' : 'Unknown'}</dd></div>
      <div><dt>Refresh limits</dt><dd><Status value={snapshot?.refresh.state} /></dd></div>
      <div><dt>Credits / search</dt><dd>{limits?.perSearchCredits ?? 'Unknown'}</dd></div>
      <div><dt>Credits / day</dt><dd>{limits?.dailyCredits ?? 'Unknown'}</dd></div>
      <div><dt>Minimum remaining</dt><dd>{limits?.minProviderRemaining ?? 'Unknown'}</dd></div>
      <div><dt>Requests / minute</dt><dd>{limits?.requestsPerMinute ?? 'Unknown'}</dd></div>
      <div><dt>Monitoring</dt><dd><Status value={snapshot?.monitoring.state} /></dd></div>
      <div><dt>Health read errors</dt><dd>{snapshot ? snapshot.healthReadErrors.length : 'Unknown'}</dd></div>
    </dl>
    <h2>Recorded Research</h2>
    {['NFL', 'MLB', 'NBA'].map(sport => {
      const entry = snapshot?.monitoring.sports.find(row => row.sport === sport);
      return <section key={sport} aria-labelledby={`system-health-${sport}`}>
        <h3 id={`system-health-${sport}`}>{sport}</h3>
        <dl className="system-health-facts">
          <div><dt>Recorded status</dt><dd><Status value={entry?.state} /></dd></div>
          <div><dt>Recorded durability</dt><dd>{label(entry?.durability)}</dd></div>
          <div><dt>Observed at</dt><dd>{timestamp(entry?.observedAt)}</dd></div>
          <div><dt>Observation age</dt><dd>{age(entry?.ageMs)}</dd></div>
          <div><dt>Total</dt><dd>{entry?.total ?? 'Not observed'}</dd></div>
          <div><dt>Complete</dt><dd>{entry?.complete ?? 'Not observed'}</dd></div>
          <div><dt>Partial</dt><dd>{entry?.partial ?? 'Not observed'}</dd></div>
          <div><dt>Failed</dt><dd>{entry?.failed ?? 'Not observed'}</dd></div>
          <div><dt>Complete rate</dt><dd>{entry?.completeRate == null ? 'Not observed' : `${(entry.completeRate * 100).toFixed(1)}%`}</dd></div>
          <div><dt>Last outcome</dt><dd>{entry?.lastOutcome ? label(entry.lastOutcome) : 'Not observed'}</dd></div>
        </dl>
      </section>;
    })}
  </div>;
}

export default function SystemHealthPanel() {
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function readHealth() {
    const response = await fetch('/api/system/health', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) {
      setAuthenticated(false);
      setSnapshot(null);
      setMessage('Authentication required');
      return;
    }
    if (!response.ok) throw new Error('Health unavailable');
    setSnapshot(await response.json() as SystemHealthSnapshot);
    setAuthenticated(true);
    setMessage('');
  }

  async function refresh() {
    if (!authenticated) return;
    setBusy(true);
    setMessage('');
    try { await readHealth(); }
    catch { setSnapshot(null); setMessage('Health unavailable'); }
    finally { setBusy(false); }
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = new FormData(form).get('password');
    form.reset();
    if (typeof password !== 'string' || !password) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/nfl/ledger/access', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
      });
      if (!response.ok) { setMessage(response.status === 401 ? 'Access denied' : 'Authentication unavailable'); return; }
      await readHealth();
    } catch { setSnapshot(null); setMessage('Health unavailable'); }
    finally { setBusy(false); }
  }

  return <main className="system-health" aria-busy={busy}>
    <style>{`
      .system-health { width:100%; max-width:860px; min-width:0; margin:0 auto; padding:32px 20px; color:var(--se-text); }
      .system-health * { min-width:0; overflow-wrap:anywhere; letter-spacing:0; }
      .system-health header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; padding-bottom:20px; border-bottom:1px solid var(--se-border); }
      .system-health h1 { font-size:24px; font-weight:600; }
      .system-health h2 { font-size:18px; margin-top:32px; font-weight:600; }
      .system-health h3 { font-size:15px; margin-top:20px; font-weight:600; }
      .system-health button { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:40px; padding:8px 14px; border:1px solid var(--se-border-strong); border-radius:4px; font-size:14px; cursor:pointer; }
      .system-health button:disabled { opacity:.6; cursor:wait; }
      .system-health :focus-visible { outline:2px solid var(--se-cyan); outline-offset:3px; }
      .system-health form { display:flex; flex-wrap:wrap; align-items:end; gap:12px; padding:24px 0; border-bottom:1px solid var(--se-border); }
      .system-health label { display:grid; flex:1 1 180px; gap:8px; font-size:14px; }
      .system-health input { width:100%; max-width:100%; min-height:40px; padding:8px; border:1px solid var(--se-border); border-radius:4px; background:var(--se-bg-elevated); }
      .system-health-facts { margin:16px 0 0; }
      .system-health-facts > div { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; padding:10px 0; border-bottom:1px solid var(--se-border); font-size:14px; }
      .system-health dt { color:var(--se-muted); }
      .system-health dd { margin:0; font-variant-numeric:tabular-nums; }
      .system-health [data-state=HEALTHY] { color:#86efac; }
      .system-health [data-state=DEGRADED], .system-health [data-state=STALE] { color:var(--se-yellow); }
      .system-health [data-state=DOWN] { color:var(--se-red); }
      .system-health-message { font-size:14px; color:var(--se-yellow); margin-top:16px; }
      .system-health-spinner { width:14px; height:14px; flex:none; border:2px solid var(--se-muted); border-top-color:transparent; border-radius:50%; animation:system-health-spin .8s linear infinite; }
      @keyframes system-health-spin { to { transform:rotate(360deg); } }
      @media (max-width:400px) { .system-health { padding:24px 14px; } }
      @media (prefers-reduced-motion:reduce) { .system-health-spinner { animation:none; } }
    `}</style>
    <header><h1>System Health</h1><Link href="/ai">DeepSide AI</Link><button type="button" onClick={refresh} disabled={busy || !authenticated}>{busy && <span className="system-health-spinner" aria-hidden="true" />}Refresh</button></header>
    {!authenticated && <form onSubmit={authenticate}>
      <label htmlFor="system-health-password">Password<input id="system-health-password" name="password" type="password" autoComplete="current-password" required maxLength={512} disabled={busy} /></label>
      <button type="submit" disabled={busy}>Authenticate</button>
    </form>}
    <p role="status" aria-live="polite" className="system-health-message">{busy ? 'Checking' : message}</p>
    <SystemHealthView snapshot={snapshot} />
  </main>;
}