type StatusVariant = 'active' | 'confirmed' | 'questionable' | 'out' | 'scratched' | 'day-to-day' | 'neutral';

const STATUS_MAP: Record<string, StatusVariant> = {
  Active: 'active',
  Confirmed: 'confirmed',
  Questionable: 'questionable',
  Out: 'out',
  Scratched: 'scratched',
  'Day-to-Day': 'day-to-day',
};

const VARIANT_CLASSES: Record<StatusVariant, string> = {
  active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  questionable: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'day-to-day': 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  out: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  scratched: 'bg-rose-500/15 text-rose-400 border-rose-500/25',
  neutral: 'bg-slate-700/60 text-slate-400 border-slate-600/40',
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const variant = STATUS_MAP[status] ?? 'neutral';
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${VARIANT_CLASSES[variant]} ${className}`}>
      {status}
    </span>
  );
}
