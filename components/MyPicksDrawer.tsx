'use client';

import { useMemo, useState } from 'react';
import { usePicks, type SavedPick } from './PicksProvider';

function oddsLabel(odds: number) {
  return odds > 0 ? `+${odds}` : odds.toString();
}

function priorityOffer(pick: SavedPick) {
  return pick.sportsbooks.filter((offer) => offer.available).sort((a, b) => b.odds - a.odds)[0];
}

export function MyPicksDrawer() {
  const { picks, isOpen, togglePicks, closePicks, removePick } = usePicks();
  const [bookFilter, setBookFilter] = useState<string | null>(null);
  const availableBooks = useMemo(() => Array.from(new Set(picks.flatMap((pick) => pick.sportsbooks.filter((offer) => offer.available).map((offer) => offer.sportsbookId)))), [picks]);
  const fullSlipBooks = useMemo(() => availableBooks.filter((bookId) => picks.length > 0 && picks.every((pick) => pick.sportsbooks.some((offer) => offer.available && offer.sportsbookId === bookId))), [availableBooks, picks]);
  const filteredPicks = bookFilter ? picks.filter((pick) => pick.sportsbooks.some((offer) => offer.available && offer.sportsbookId === bookFilter)) : picks;
  const bookName = (id: string) => picks.flatMap((pick) => pick.sportsbooks).find((offer) => offer.sportsbookId === id)?.sportsbookName ?? id;

  return (
    <>
      <button type="button" onClick={togglePicks} aria-label="Open My Picks" className="fixed bottom-6 right-6 z-[70] flex h-12 items-center gap-2 rounded-full border border-[var(--se-border-strong)] bg-[var(--se-green)] px-4 text-sm font-bold text-[#041008] shadow-[0_8px_30px_rgba(0,0,0,0.35)] transition hover:bg-[#63f99a]">
        <span className="text-lg">▣</span>
        {picks.length > 0 && <span>{picks.length}</span>}
      </button>

      {isOpen && <button type="button" aria-label="Close My Picks" onClick={closePicks} className="fixed inset-0 z-[80] bg-black/55" />}
      <aside className={`fixed right-0 top-0 z-[90] flex h-full w-full max-w-[430px] flex-col border-l border-[var(--se-border)] bg-[#080c09] shadow-[-20px_0_60px_rgba(0,0,0,0.4)] transition-transform duration-200 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`} aria-hidden={!isOpen}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--se-border)] bg-[#080c09]/95 px-5 py-4 backdrop-blur">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--se-green)]">My Picks</p>
            <h2 className="mt-1 text-lg font-bold text-white">Your research slip</h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="theme-button-secondary px-3 py-1.5 text-xs">Share</button>
            <button type="button" onClick={closePicks} aria-label="Close My Picks" className="theme-button-secondary flex h-8 w-8 items-center justify-center text-lg">×</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {picks.length === 0 ? (
            <div className="theme-panel mt-10 p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--se-green-soft)] text-xl text-[var(--se-green)]">▣</div>
              <h3 className="mt-4 font-semibold text-white">Your slip is empty.</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--se-muted)]">Add props from Research, AI Finder or The Secret to compare sportsbooks.</p>
              <button type="button" onClick={closePicks} className="theme-button-primary mt-5 px-4 py-2 text-sm">Browse Props</button>
            </div>
          ) : (
            <>
              <section className="theme-panel mb-4 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--se-muted)]">Full Slip Available At</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {fullSlipBooks.length > 0 ? fullSlipBooks.map((bookId) => <span key={bookId} className="rounded-full border border-[var(--se-border-strong)] bg-[var(--se-green-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--se-green)]">✓ {bookName(bookId)}</span>) : <span className="text-xs text-[var(--se-muted)]">No single sportsbook currently has every saved play.</span>}
                </div>
              </section>

              <section className="theme-panel mb-4 p-4">
                <div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--se-muted)]">Sportsbooks</p><button type="button" onClick={() => setBookFilter(null)} className="text-[10px] text-[var(--se-green)]">All picks</button></div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {availableBooks.map((bookId) => { const count = picks.filter((pick) => pick.sportsbooks.some((offer) => offer.available && offer.sportsbookId === bookId)).length; return <button type="button" key={bookId} onClick={() => setBookFilter(bookFilter === bookId ? null : bookId)} className={`rounded-xl border px-3 py-2 text-left transition ${bookFilter === bookId ? 'border-[var(--se-border-strong)] bg-[var(--se-green-soft)]' : 'border-[var(--se-border)] bg-white/[0.02] hover:border-[var(--se-border-strong)]'}`}><span className="block text-xs font-semibold text-white">{bookName(bookId)}</span><span className="text-[10px] text-[var(--se-muted)]">{count}/{picks.length} available</span></button>; })}
                </div>
              </section>

              <div className="space-y-3">
                {filteredPicks.map((pick) => {
                  const best = priorityOffer(pick);
                  return <article key={pick.id} className="theme-panel p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--se-green-soft)] text-xs font-bold text-[var(--se-green)]">{pick.playerName.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div><div className="min-w-0"><h3 className="truncate text-sm font-bold text-white">{pick.playerName}</h3><p className="text-[10px] text-[var(--se-muted)]">{pick.teamName} vs {pick.opponentName}</p></div></div>
                      <button type="button" onClick={() => removePick(pick.id)} aria-label={`Remove ${pick.playerName}`} className="text-lg text-[var(--se-muted)] transition hover:text-rose-300">×</button>
                    </div>
                    <p className="mt-3 text-xs font-bold uppercase tracking-wide text-[var(--se-green)]">{pick.side} {pick.line} {pick.propType}</p>
                    <p className="mt-1 text-[10px] text-[var(--se-muted)]">{pick.gameTime}</p>
                    <div className="mt-3 border-t border-[var(--se-border)] pt-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--se-muted)]">Available At <span className="font-normal">(demo data)</span></p><div className="mt-2 space-y-1.5">{pick.sportsbooks.filter((offer) => !bookFilter || offer.sportsbookId === bookFilter).map((offer) => <div key={offer.sportsbookId} className="flex items-center justify-between text-xs"><span className="text-slate-300">{offer.sportsbookName}</span><span className={best?.sportsbookId === offer.sportsbookId ? 'font-bold text-[var(--se-green)]' : 'text-[var(--se-muted)]'}>{oddsLabel(offer.odds)} {best?.sportsbookId === offer.sportsbookId && <span className="ml-1 text-[9px] uppercase">Best</span>}</span></div>)}</div></div>
                  </article>;
                })}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
