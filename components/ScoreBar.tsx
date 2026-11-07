type Props = {
  label: string;
  value: number;
  accent?: boolean;
  hint?: string;
};

export default function ScoreBar({ label, value, accent, hint }: Props) {
  const safe = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">
          {label}
          {hint ? <span className="ml-2 text-xs text-muted/60">{hint}</span> : null}
        </span>
        <span className={`font-mono tabular-nums ${accent ? "text-lg text-accent" : "text-white/90"}`}>
          {safe}
        </span>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full ${accent ? "bg-accent" : "bg-white/35"}`}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}
