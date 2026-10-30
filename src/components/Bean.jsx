/**
 * The frijol marker placed on a board cell. Rotation is derived from `seed`
 * so every bean on a board sits a little differently, like real ones.
 */
export default function Bean({ seed = 0, size = "48%", className = "" }) {
  const rot = ((seed * 47) % 70) - 35;
  return (
    <span
      className={`bean-drop pointer-events-none absolute left-1/2 top-[44%] z-30 ${className}`}
      style={{ width: size, "--bean-rot": `${rot}deg`, transform: `translate(-50%, -50%) rotate(${rot}deg)` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 70" className="block h-auto w-full drop-shadow-[2px_3px_0_rgba(26,26,26,0.55)]">
        <path
          d="M14 38C8 20 22 5 42 7c11 1 16 9 25 9 13 0 25 6 26 21 1 17-15 28-37 28C34 65 19 54 14 38Z"
          fill="#5B2A1B"
          stroke="#1A1A1A"
          strokeWidth="4"
        />
        <path d="M50 18c-4 5-4 10 1 14" fill="none" stroke="#2B130C" strokeWidth="3.5" strokeLinecap="round" />
        <ellipse cx="34" cy="24" rx="11" ry="5" fill="#C98B6B" opacity="0.75" transform="rotate(-18 34 24)" />
        <ellipse cx="72" cy="30" rx="5" ry="2.6" fill="#E3B597" opacity="0.6" />
      </svg>
    </span>
  );
}
