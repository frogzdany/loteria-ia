import { useState } from "react";
import { Play, Square } from "lucide-react";
import { nameFontSize } from "@/lib/fitText";

// Sunburst pairs for placeholders, cycled by card number.
const PALETTES = [
  { a: "#D7263D", b: "#E8475B", core: "#F4C20D" },
  { a: "#1B4F9C", b: "#2A63B8", core: "#FFF4D6" },
  { a: "#2E8B57", b: "#3BA36A", core: "#F4C20D" },
  { a: "#F4C20D", b: "#F8D44A", core: "#D7263D" },
];

export function CardPlaceholder({ number, label }) {
  const p = PALETTES[((number ?? 1) - 1 + PALETTES.length) % PALETTES.length];
  return (
    <div
      className="sunburst absolute inset-0 grid place-items-center"
      style={{ "--sb-a": p.a, "--sb-b": p.b, "--sb-core": p.core }}
      aria-hidden={label ? undefined : true}
    >
      <span
        className="font-display text-tinta leading-none"
        style={{ fontSize: "30cqw", marginTop: "-10cqw" }}
      >
        {number ?? "?"}
      </span>
    </div>
  );
}

/**
 * A lotería card drawn with CSS in the traditional style: white stock, thin ink frame, plain
 * number on the art and the name in capitals on a white band under the illustration (never
 * baked into the image). Long names shrink to stay on whole words instead of breaking.
 *
 * Props: card, compact (tighter type for small grids), onPlay / playing (shows ▶),
 * className, children (overlays like the bean), imgLoading.
 */
export default function LoteriaCard({
  card,
  compact = false,
  onPlay,
  playing = false,
  playDisabled = false,
  className = "",
  children,
  imgLoading = "lazy",
}) {
  const [failedSrc, setFailedSrc] = useState(null);
  const src = card?.image_url && card.image_url !== failedSrc ? card.image_url : null;

  return (
    <div className={`lcard ${compact ? "lcard-compact" : ""} ${className}`}>
      <div className="lcard-frame">
        <div className="lcard-art">
        {/* Placeholder always underneath: covers slow/lazy/failed images. */}
        <CardPlaceholder number={card?.number} />
        {src && (
          <img
            className="lcard-img"
            src={src}
            alt=""
            loading={imgLoading}
            decoding="async"
            draggable={false}
            onError={() => setFailedSrc(src)}
          />
        )}
        {card?.number != null && <span className="lcard-num">{card.number}</span>}
        {onPlay && (
          <button
            type="button"
            className="lcard-play"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(card);
            }}
            disabled={playDisabled}
            aria-label={playing ? `Detener audio de ${card?.name}` : `Escuchar ${card?.name}`}
            title={playDisabled ? "Sin audio todavía" : playing ? "Detener" : "Escuchar"}
          >
            {playing ? (
              <Square className="h-1/2 w-1/2" fill="currentColor" />
            ) : (
              <Play className="h-1/2 w-1/2 translate-x-[8%]" fill="currentColor" />
            )}
          </button>
        )}
        </div>
        {card?.name && (
          <span className="lcard-band" style={{ fontSize: `${nameFontSize(card.name, compact ? 12 : 10)}cqw` }}>
            {card.name}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Face-down card used while the deck is still being written. */
export function CardBack({ className = "" }) {
  return (
    <div className={`lcard ${className}`} aria-hidden="true">
      <div className="lcard-frame card-back grid place-items-center">
        <span
          className="font-display text-oro leading-none text-center border-oro bg-azul"
          style={{ fontSize: "11cqw", padding: "4cqw 5cqw", borderWidth: "max(2px,1.2cqw)" }}
        >
          LTW
        </span>
      </div>
    </div>
  );
}
