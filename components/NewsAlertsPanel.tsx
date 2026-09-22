'use client';

import { useMemo, useState } from 'react';
import { newsAlerts, type NewsAlert, type NewsAlertCategory } from '../lib/newsAlerts';

type Filter = 'all' | NewsAlertCategory;

const filters: Array<{ label: string; value: Filter }> = [
  { label: 'All', value: 'all' },
  { label: 'Injuries', value: 'injury' },
  { label: 'Lineups', value: 'lineup' },
  { label: 'Pitchers', value: 'pitcher' },
  { label: 'Weather', value: 'weather' },
  { label: 'Market', value: 'market' },
  { label: 'Player', value: 'player' },
  { label: 'Game', value: 'game' },
];

const categoryIcons: Record<NewsAlertCategory, string> = {
  injury: '♥', lineup: '☷', pitcher: '◈', weather: '◌', market: '↗', player: '●', game: '▶', team: '◆',
};

function priorityClass(priority: NewsAlert['priority']) {
  if (priority === 'critical') return 'border-rose-500/25 bg-rose-500/10 text-rose-300';
  if (priority === 'important') return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
  return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
}

function categoryLabel(category: NewsAlertCategory) {
  return category === 'pitcher' ? 'PITCHERS' : category.toUpperCase();
}

export function NewsAlertsPanel({ context, className = '' }: { context?: string[]; className?: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [collapsed, setCollapsed] = useState(false);

  const visibleAlerts = useMemo(() => {
    const relevant = context?.length
      ? newsAlerts.filter((alert) => context.some((term) => `${alert.playerName ?? ''} ${alert.teamName ?? ''} ${alert.gameId ?? ''}`.toLowerCase().includes(term.toLowerCase())))
      : [];
    const ordered = [...relevant, ...newsAlerts.filter((alert) => !relevant.includes(alert))];
    return (filter === 'all' ? ordered : ordered.filter((alert) => alert.category === filter)).slice(0, 12);
  }, [context, filter]);

  return (
    <section className={`theme-panel overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--se-border)] px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">News &amp; Alerts</h2>
            <span className="rounded-full border border-[var(--se-border)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--se-muted)]">Updates</span>
          </div>
          <p className="mt-0.5 text-[10px] text-[var(--se-muted)]">Live MLB intel, prioritized for this view</p>
        </div>
        <button type="button" aria-label={collapsed ? 'Expand News and Alerts' : 'Collapse News and Alerts'} onClick={() => setCollapsed((value) => !value)} className="theme-button-secondary flex h-7 w-7 items-center justify-center text-xs">
          {collapsed ? '+' : '−'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-[var(--se-border)] px-3 py-2">
            {filters.map((item) => (
              <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium transition ${filter === item.value ? 'bg-[var(--se-green)] text-[#041008]' : 'text-[var(--se-muted)] hover:bg-[var(--se-green-soft)] hover:text-white'}`}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="news-alert-scroll max-h-[calc(100vh-240px)] space-y-2 overflow-y-auto px-3 py-3">
            {visibleAlerts.map((alert) => (
              <article key={alert.id} className="rounded-xl border border-[var(--se-border)] bg-[rgba(255,255,255,0.025)] p-3 transition hover:-translate-y-px hover:border-[var(--se-border-strong)]">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--se-green-soft)] text-xs text-[var(--se-green)]">{categoryIcons[alert.category]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${priorityClass(alert.priority)}`}>{alert.priority}</span>
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--se-muted)]">{categoryLabel(alert.category)}</span>
                    </div>
                    <h3 className="mt-1 text-xs font-semibold text-white">{alert.title}</h3>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--se-muted)]">{alert.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] text-slate-500">
                      {alert.context && <span>{alert.context}</span>}
                      <span>{alert.createdAt}</span>
                      <span className="text-slate-600">{alert.sourceType}</span>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
