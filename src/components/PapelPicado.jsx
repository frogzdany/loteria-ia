const COLORS = ["#D7263D", "#F4C20D", "#1B4F9C", "#2E8B57"];

/** A string of papel picado flags across the top of a page. */
export default function PapelPicado({ count = 24, className = "" }) {
  return (
    <div className={`papel ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ background: COLORS[i % COLORS.length] }} />
      ))}
    </div>
  );
}
