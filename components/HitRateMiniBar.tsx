interface HitRateMiniBarProps {
  label: string;
  value: number; // 0–100
  className?: string;
}

function barColor(v: number) {
  if (v >= 75) return 'bg-emerald-500';
  if (v >= 60) return 'bg-emerald-600';
  if (v >= 45) return 'bg-amber-500';
  return 'bg-rose-500';
}

export function HitRateMiniBar({ label, value, className = '' }: HitRateMiniBarProps) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span className="w-5 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <div className="flex-1 rounded-full bg-slate-700/60" style={{ height: 4 }}>
        <div
          className={`h-full rounded-full ${barColor(value)}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right text-[10px] font-semibold text-slate-300">{value}%</span>
    </div>
  );
}
