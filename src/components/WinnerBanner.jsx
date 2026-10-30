import { useEffect, useMemo } from "react";

const CONFETTI_COLORS = ["#F4C20D", "#FFF4D6", "#1B4F9C", "#2E8B57", "#1A1A1A"];

function Confetti({ count = 60 }) {
  // Deterministic pseudo-random layout so renders are stable.
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const r = (n) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
        return {
          left: `${r(1) * 100}%`,
          w: 8 + r(2) * 10,
          h: 12 + r(3) * 14,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          delay: `${-r(4) * 4}s`,
          dur: `${2.6 + r(5) * 2.4}s`,
          drift: `${(r(6) - 0.5) * 220}px`,
          spin: `${(r(7) > 0.5 ? 1 : -1) * (360 + r(8) * 540)}deg`,
          round: r(9) > 0.7,
        };
      }),
    [count]
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece border border-tinta/40"
          style={{
            left: p.left,
            width: p.w,
            height: p.round ? p.w : p.h,
            background: p.color,
            borderRadius: p.round ? "50%" : 2,
            "--delay": p.delay,
            "--dur": p.dur,
            "--drift": p.drift,
            "--spin": p.spin,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Full-screen "¡LOTERÍA!" overlay.
 * `title` defaults to ¡LOTERÍA!, `name` is the winner, `subtitle` optional line,
 * `actions` are rendered under the name, `onClose` adds a close button (and Escape).
 */
export default function WinnerBanner({
  name,
  title = "¡LOTERÍA!",
  subtitle,
  actions,
  onClose,
  confetti = true,
  size = "xl",
}) {
  useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const big = size === "xl";

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={`${title} ${name ?? ""}`}
      className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-rojo p-4"
    >
      <div
        className="sunburst sunburst-spin absolute left-1/2 top-1/2 aspect-square w-[220vmax] -translate-x-1/2 -translate-y-1/2 opacity-60"
        style={{ "--sb-a": "#D7263D", "--sb-b": "#C21F35", "--sb-core": "#D7263D" }}
        aria-hidden="true"
      />
      {confetti && <Confetti count={big ? 90 : 50} />}
      <div className="banner-in relative z-10 flex max-w-[92vw] flex-col items-center text-center">
        <p
          className={`font-display leading-none text-oro text-shadow-ink-lg ${
            big ? "text-[clamp(4rem,14vw,16rem)]" : "text-[clamp(3rem,16vw,6rem)]"
          }`}
        >
          {title}
        </p>
        {name && (
          <p
            className={`mt-4 border-4 border-tinta bg-crema px-6 py-3 font-display leading-tight text-tinta shadow-print-lg rounded-[6px] break-words max-w-full ${
              big ? "text-[clamp(2rem,6vw,6rem)]" : "text-[clamp(1.5rem,8vw,2.5rem)]"
            }`}
          >
            {name}
          </p>
        )}
        {subtitle && (
          <p className={`mt-5 font-verse italic text-crema ${big ? "text-[clamp(1.25rem,2.5vw,2.5rem)]" : "text-lg"}`}>
            {subtitle}
          </p>
        )}
        {(actions || onClose) && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {actions}
            {onClose && (
              <button type="button" className="btn btn-crema" onClick={onClose}>
                Cerrar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
