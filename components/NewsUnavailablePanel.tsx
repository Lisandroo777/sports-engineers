/** Honest placeholder for Research Lab / AI Finder — no real news/injury/line-movement provider is connected yet. */
export function NewsUnavailablePanel({ className = '' }: { className?: string }) {
  return (
    <section className={`theme-panel overflow-hidden ${className}`}>
      <div className="border-b border-[var(--se-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">News &amp; Alerts</h2>
          <span className="rounded-full border border-[var(--se-border)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--se-muted)]">Updates</span>
        </div>
        <p className="mt-0.5 text-[10px] text-[var(--se-muted)]">Live news, injury, and line-movement feed not connected yet.</p>
      </div>
    </section>
  );
}
