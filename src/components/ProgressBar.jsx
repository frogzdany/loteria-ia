/**
 * Segmented progress: one tile per card, filled as each card gets its image and audio.
 * Falls back to a continuous bar when `max` is large.
 */
export default function ProgressBar({ value = 0, max = 16, label, className = "" }) {
  const safeMax = Math.max(1, Number(max) || 1);
  const v = Math.min(safeMax, Math.max(0, Number(value) || 0));
  const segmented = safeMax <= 32;
  const pct = Math.round((v / safeMax) * 100);

  return (
    <div className={className}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={v}
        aria-label={label || "Progreso"}
        className="border-[3px] border-tinta bg-white p-1 shadow-print rounded-[4px]"
      >
        {segmented ? (
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${safeMax}, minmax(0, 1fr))` }}>
            {Array.from({ length: safeMax }, (_, i) => (
              <span
                key={i}
                className={`h-5 transition-colors duration-300 ${
                  i < v ? ["bg-rojo", "bg-azul", "bg-verde", "bg-oro"][i % 4] : "bg-tinta/10"
                }`}
              />
            ))}
          </div>
        ) : (
          <div className="h-5 bg-tinta/10">
            <div className="h-full bg-verde transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {label && (
        <p className="mt-2 flex justify-between font-verse text-sm">
          <span>{label}</span>
          <span className="font-display tabular-nums">
            {v}/{safeMax}
          </span>
        </p>
      )}
    </div>
  );
}
