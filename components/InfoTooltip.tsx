'use client';

import { useEffect, useRef, useState } from 'react';

interface InfoTooltipProps {
  text: string;
  className?: string;
}

export function InfoTooltip({ text, className = '' }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-600 text-[9px] text-slate-500 transition hover:border-slate-400 hover:text-slate-300"
        aria-label="More information"
      >
        ?
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-50 mb-1.5 w-52 -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-[11px] leading-relaxed text-slate-300 shadow-2xl">
          {text}
          <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-slate-700" />
        </div>
      )}
    </div>
  );
}
