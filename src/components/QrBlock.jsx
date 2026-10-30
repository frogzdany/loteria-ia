import { useState } from "react";

/** QR code (api.qrserver.com) framed like a card, with the URL printed underneath. */
export default function QrBlock({ url, size = 300, className = "", caption, dark = false }) {
  const [failed, setFailed] = useState(false);
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(url)}`;
  const pretty = url.replace(/^https?:\/\//, "");

  return (
    <figure className={`flex flex-col items-center ${className}`}>
      <div className="w-full border-4 border-tinta bg-white p-[6%] shadow-print-lg rounded-[6px]">
        {failed ? (
          <div className="grid aspect-square w-full place-items-center bg-crema p-4 text-center font-verse text-tinta">
            No se pudo cargar el QR. Usa la dirección de abajo.
          </div>
        ) : (
          <img
            src={src}
            alt={`Código QR para abrir ${pretty}`}
            className="block aspect-square w-full [image-rendering:pixelated]"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      {caption && (
        <figcaption className={`mt-4 text-center font-display leading-tight ${dark ? "text-oro" : "text-tinta"}`}>
          {caption}
        </figcaption>
      )}
      <p
        className={`mt-2 max-w-full break-all text-center font-verse font-semibold ${
          dark ? "text-crema" : "text-tinta"
        }`}
      >
        {pretty}
      </p>
    </figure>
  );
}
