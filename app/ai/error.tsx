"use client";

import { useEffect } from "react";

/** Next.js route-level error boundary for /ai. Catches any render-time throw in the page tree
 * (e.g. from a malformed restored candidate) and shows a recoverable DeepSide-styled state instead
 * of a blank screen. `reset()` re-renders the segment; the Reset link does a full clean reload. */
export default function AiFinderError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ai] page render failed", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050807] px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <p className="text-3xl">⚠</p>
        <h1 className="mt-3 text-lg font-bold text-white">AI Finder hit a problem</h1>
        <p className="mt-2 text-sm text-slate-400">
          Something in the AI Finder view failed to render. Your research data is safe on the server — this only affects this browser tab.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={() => reset()}
            className="rounded-xl bg-[#39f27f] px-4 py-2 text-sm font-bold text-[#041008] transition hover:brightness-110"
          >
            Try again
          </button>
          <button
            onClick={() => {
              try { window.sessionStorage.removeItem("deepside.ai-finder.session.v1"); } catch { /* best-effort */ }
              window.location.href = "/ai";
            }}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Reset & reload
          </button>
        </div>
      </div>
    </div>
  );
}
