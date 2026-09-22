'use client';

import Link from 'next/link';
import { AppSidebar } from '../../components/AppSidebar';
import { todaySlateDate } from '../../lib/dateModel';

const sections = [
  { title: 'Top Slate Insights', text: 'Slate-level signals will appear here when current research data is available.', tone: 'text-emerald-300' },
  { title: 'Biggest Projection vs Line Gaps', text: 'Unavailable until sportsbook lines and projections are loaded for the selected slate.', tone: 'text-teal-300' },
  { title: 'Rising Usage / Falling Usage', text: 'Role and workload trends are shown only when supported by real game logs.', tone: 'text-amber-300' },
  { title: 'Matchup Advantages', text: 'Opponent context is shown only when a connected source provides it.', tone: 'text-sky-300' },
  { title: 'Injury / Role Impact', text: 'Unavailable signals remain unavailable; no role or injury impact is inferred.', tone: 'text-rose-300' },
  { title: 'Market Movement', text: 'Timestamped movement is unavailable when snapshot history is not recorded.', tone: 'text-violet-300' },
  { title: 'Outlier Risk', text: 'Outlier dependence appears when real game-log production supports the calculation.', tone: 'text-orange-300' },
  { title: 'Best Game Environments', text: 'Game-environment metrics are unavailable until supported team context is connected.', tone: 'text-cyan-300' },
  { title: 'Research Warnings', text: 'Warnings will reflect sample size, reliability, stale prices, and missing evidence.', tone: 'text-yellow-300' },
  { title: 'What Changed Today', text: 'No cross-slate change comparison is available without stored current and prior snapshots.', tone: 'text-slate-300' },
];

export default function InsightsPage() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#060d18] text-white">
      <AppSidebar currentPath="/insights" />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="border-b border-white/5 bg-[#0b1522] px-5 py-4">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">Slate intelligence</p>
              <h1 className="mt-1 text-2xl font-bold text-white">Insights</h1>
              <p className="mt-1 text-sm text-slate-400">Broader patterns across the slate, kept separate from individual prop research.</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-right text-xs">
              <p className="text-slate-500">Current slate</p>
              <p className="mt-1 font-semibold text-white">{todaySlateDate()}</p>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-7xl p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4">
            <div>
              <p className="text-sm font-semibold text-emerald-200">Insights use existing research evidence</p>
              <p className="mt-1 text-xs text-slate-400">No new sportsbook calls are made by this page. Unsupported signals are labeled unavailable.</p>
            </div>
            <Link href="/research" className="rounded-xl border border-emerald-400/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/10">Open Prop Dive</Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sections.map((section) => (
              <article key={section.title} className="min-h-36 rounded-2xl border border-white/8 bg-white/[0.035] p-4 transition hover:border-white/15">
                <div className="flex items-start justify-between gap-3">
                  <h2 className={`text-sm font-semibold ${section.tone}`}>{section.title}</h2>
                  <span className="rounded-full border border-white/8 px-2 py-0.5 text-[10px] text-slate-500">Slate view</span>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-400">{section.text}</p>
                <p className="mt-4 text-[10px] uppercase tracking-[0.15em] text-slate-600">No fabricated metrics</p>
              </article>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
