// Deterministic mock provider data for LoterIA. Pure module: no imports, no I/O,
// no randomness. Shared by the backend functions (through providers.ts), the seed script and vitest.
//
// Why it exists: Base44 blocks InvokeLLM and GenerateImage from the local dev runtime
// (`npx base44 dev`), and the free plan ran out of integration credits during the first real
// deck. An offline mock behind the same interface keeps the full flow
// (generate deck, fill assets, play, win) runnable with no key and no network.

/** Twenty-four fixed cards. The verse is the riddle and never says the card's noun. */
export const MOCK_CARDS = [
  { name: "El Founder", verse: "Con la ronda en la mira y el pitch ensayado, promete el futuro aunque no haya facturado.", visual: "Una persona con laptop abierta y una gorra, señalando una gráfica que sube." },
  { name: "La Demo", verse: "Funcionó toda la noche, pero frente al jurado, el botón se congela y el wifi se ha marchado.", visual: "Una pantalla grande con una rueda de carga eterna y un cable suelto." },
  { name: "El Pitch", verse: "Tres minutos de pasión, un reloj que no perdona, y al final la pregunta que a cualquiera desmorona.", visual: "Un micrófono frente a un reloj de arena casi vacío." },
  { name: "La IA", verse: "Responde con confianza aunque invente la cita, y todos en la sala la llaman la favorita.", visual: "Un cerebro de circuitos brillantes con una corona de laurel." },
  { name: "El Inversionista", verse: "Escucha tres minutos con cara de experto, y dice 'interesante' con el cheque bien cubierto.", visual: "Un saco elegante con una pluma fuente y un maletín cerrado con candado." },
  { name: "La Startup", verse: "Nació en un garage con un sueño y un plan, cambia de modelo antes de que la entiendan.", visual: "Un cohete pequeño despegando desde una cochera abierta." },
  { name: "El Networking", verse: "Reparte tarjetas y sonrisas en el coctel, y a todos les promete que les manda un mail.", visual: "Dos manos estrechándose con tarjetas de presentación volando alrededor." },
  { name: "El Café", verse: "Sin él no hay sprint que arranque ni junta que termine, es el combustible oscuro que a la semana define.", visual: "Una taza humeante con un grano enorme flotando encima." },
  { name: "La Laptop", verse: "Llena de calcomanías y con la batería al diez, la carga en cada enchufe que encuentra de una vez.", visual: "Una computadora portátil cubierta de calcomanías con un cargador enredado." },
  { name: "El Hackathon", verse: "Cuarenta y ocho horas de código y pizza fría, al final todos ganan menos el que dormía.", visual: "Un reloj de pared con rebanadas de pizza como manecillas." },
  { name: "La Nube", verse: "No la ves pero la pagas cada fin de mes, y cuando se cae, se cae todo a la vez.", visual: "Una nube blanca con un enchufe y una factura colgando." },
  { name: "El Bug", verse: "Se esconde en producción y aparece en la demo, el viernes por la tarde cuando ya nadie está viendo.", visual: "Un escarabajo verde sentado sobre un teclado." },
  { name: "La Fintech", verse: "Promete que tu dinero llega en un segundo, y tu banco de siempre se queda meditabundo.", visual: "Un teléfono celular del que salen monedas con alas." },
  { name: "El Unicornio", verse: "Vale mil millones aunque no deje ganancia, y en cada conferencia presumen su elegancia.", visual: "Un caballo blanco con cuerno dorado parado sobre una pila de monedas." },
  { name: "El QR", verse: "Cuadrito blanco y negro que te lleva a jugar, apunta la cámara y deja de dudar.", visual: "Un cuadro con patrón de mosaico blanco y negro bajo una lupa." },
  { name: "La Pizza", verse: "Llega fría a la mesa en plena madrugada, y el equipo la celebra como ronda cerrada.", visual: "Una caja de cartón abierta con una rebanada que falta." },
  { name: "El Robot", verse: "Camina por el pasillo saludando a la gente, y alguien lo desconecta porque se puso insistente.", visual: "Un autómata de hojalata con una mano levantada y una antena." },
  { name: "El Mentor", verse: "Habla como quien ya pasó por ahí, y te da tres consejos que no pediste así.", visual: "Una persona con lentes y barba señalando una pizarra con flechas." },
  { name: "La Beca", verse: "Te la dan con aplauso y foto en el escenario, y luego te preguntan por el plan presupuestario.", visual: "Un cheque gigante de cartón con un moño rojo." },
  { name: "El Código", verse: "Compila a la primera cuando nadie lo mira, y frente al jurado hasta el compilador delira.", visual: "Una pantalla con líneas de colores y un cursor parpadeando." },
  { name: "La Blockchain", verse: "Todo lo descentraliza y nada quiere olvidar, cada bloque es un recibo que no puedes borrar.", visual: "Una cadena de bloques dorados unidos por eslabones." },
  { name: "El Wifi", verse: "Clave en la pared y señal que va y viene, justo en la demo nadie sabe si se tiene.", visual: "Un router con antenas y una sola barra de señal." },
  { name: "La Ciudad", verse: "Entre tráfico y tacos alberga a la comunidad, de Roma a Polanco corre la novedad.", visual: "Un horizonte de edificios con un ángel dorado en una columna." },
  { name: "La Batería", verse: "Al cinco por ciento y sin cargador a la mano, el cierre se vuelve corto y el aplauso, vano.", visual: "Una pila casi vacía con un rayo rojo." },
];

export const PROVIDERS = ["base44", "mock", "openai"];

/** Same shape InvokeLLM returns for CARDS_SCHEMA, so normalizeCards() applies unchanged. */
export function mockCardsResponse(count = 16) {
  const n = Math.max(1, Math.min(MOCK_CARDS.length, Math.round(Number(count) || 16)));
  return { cards: MOCK_CARDS.slice(0, n).map((c) => ({ ...c })) };
}

export const MOCK_PALETTE = ["#c8102e", "#f2a900", "#0057b8", "#008a3e", "#6b2d90", "#e4007c"];

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/** Small flat SVG placeholder in the lotería palette. The UI draws name and number over it. */
export function mockImageSvg(card = {}) {
  const n = Math.abs(Math.round(Number(card.number) || 0));
  const bg = MOCK_PALETTE[n % MOCK_PALETTE.length];
  const fg = MOCK_PALETTE[(n + 3) % MOCK_PALETTE.length];
  const label = escapeXml(String(card.name ?? "").slice(0, 24));
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600">' +
    `<rect width="400" height="600" fill="${bg}"/>` +
    '<rect x="16" y="16" width="368" height="568" fill="none" stroke="#fff6dc" stroke-width="6"/>' +
    '<circle cx="200" cy="250" r="120" fill="#fff6dc" stroke="#1b1b1b" stroke-width="8"/>' +
    `<circle cx="200" cy="250" r="78" fill="${fg}" stroke="#1b1b1b" stroke-width="6"/>` +
    `<path d="M40 470 Q120 420 200 470 T360 470 V560 H40 Z" fill="${fg}" stroke="#1b1b1b" stroke-width="6"/>` +
    `<text x="200" y="582" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#fff6dc">mock #${n} ${label}</text>` +
    "</svg>"
  );
}

export function mockImageDataUrl(card = {}) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(mockImageSvg(card));
}

/** djb2, unsigned 32-bit. Used to pick a beep pitch from a text. */
export function hashText(text) {
  let h = 5381;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

export function beepFrequency(seed = 0) {
  return 330 + (Math.abs(Math.round(Number(seed) || 0)) % 8) * 55; // 330..715 Hz
}

/**
 * Two short tones (a "ta-dá") as an 8 kHz, 8-bit, mono PCM WAV. About 4 KB for 0.5 s.
 * Deterministic for a given seed. Plays in every browser through <audio>.
 */
export function mockWavBytes({ seed = 0, seconds = 0.5, sampleRate = 8000 } = {}) {
  const n = Math.max(1, Math.round(seconds * sampleRate));
  const base = beepFrequency(seed);
  const fade = Math.max(1, Math.round(sampleRate * 0.02));
  const half = Math.floor(n / 2);
  const samples = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const f = i < half ? base : base * 1.25;
    let env = 1;
    if (i < fade) env = i / fade;
    else if (i > n - fade) env = (n - i) / fade;
    const d = Math.abs(i - half);
    if (d < fade) env *= d / fade;
    const v = Math.sin((2 * Math.PI * f * i) / sampleRate) * 0.6 * env;
    samples[i] = Math.round(128 + v * 127);
  }
  const out = new Uint8Array(44 + n);
  const view = new DataView(out.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + n, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate: 1 channel x 1 byte
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, n, true);
  out.set(samples, 44);
  return out;
}

export function wavFilename(filename) {
  const base = String(filename ?? "audio").replace(/\.mp3$/i, "");
  return `${base}.wav`;
}

export function isLoopbackUrl(url) {
  try {
    const h = new URL(String(url)).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  } catch {
    return false;
  }
}

/**
 * Explicit LOTERIA_PROVIDER wins. Otherwise, on a loopback host (`npx base44 dev`): "openai"
 * when an OpenAI key is configured, else "mock". Anywhere else: "base44". An unknown explicit
 * value is ignored, so production cannot switch provider by a typo.
 */
export function resolveProviderName(explicit, { requestUrl, openaiKey } = {}) {
  const e = String(explicit ?? "").trim().toLowerCase();
  if (PROVIDERS.includes(e)) return e;
  if (isLoopbackUrl(requestUrl)) return openaiKey ? "openai" : "mock";
  return "base44";
}
