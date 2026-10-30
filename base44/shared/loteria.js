// Pure, environment-agnostic logic shared by backend functions (Deno),
// the frontend (Vite) and the tests (vitest). No imports, no I/O.

export const CARDS_PER_DECK = 16;
export const BOARD_SIZE = 16;

// Rows, columns, diagonals and the four corners of a 4x4 board (row-major).
export const LINES = [
  [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15],
  [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15],
  [0, 5, 10, 15], [3, 6, 9, 12],
  [0, 3, 12, 15],
];

/**
 * A position counts only if the player marked it AND its card was called.
 * Returns the first winning line (array of positions) or null.
 */
export function findWinningLine(board, calledIds) {
  const marked = new Set(board?.marked ?? []);
  const called = new Set(calledIds ?? []);
  const cardIds = board?.card_ids ?? [];
  const ok = (pos) => marked.has(pos) && called.has(cardIds[pos]);
  for (const line of LINES) {
    if (line.every(ok)) return line;
  }
  return null;
}

export function isWinner(board, calledIds) {
  return findWinningLine(board, calledIds) !== null;
}

/** Positions whose card has already been called (for subtle highlighting). */
export function calledPositions(board, calledIds) {
  const called = new Set(calledIds ?? []);
  return (board?.card_ids ?? []).reduce((acc, id, pos) => {
    if (called.has(id)) acc.push(pos);
    return acc;
  }, []);
}

/** Fisher-Yates shuffle. `rand` defaults to Math.random; inject for tests. */
export function shuffle(items, rand = Math.random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pick 16 card ids for a board. Decks with more than 16 cards give differing boards. */
export function dealBoard(cardIds, rand = Math.random) {
  if (!Array.isArray(cardIds) || cardIds.length < BOARD_SIZE) {
    throw new Error(`Need at least ${BOARD_SIZE} cards, got ${cardIds?.length ?? 0}`);
  }
  return shuffle(cardIds, rand).slice(0, BOARD_SIZE);
}

/** Pick a random card that has not been called yet, or null when all were called. */
export function nextCard(cards, calledIds, rand = Math.random) {
  const called = new Set(calledIds ?? []);
  const remaining = (cards ?? []).filter((c) => !called.has(c.id));
  if (remaining.length === 0) return null;
  return remaining[Math.floor(rand() * remaining.length)];
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
/** Short game code like MTW7K2 (prefix + 3 random chars). */
export function makeGameCode(prefix = "MTW", rand = Math.random) {
  let s = "";
  for (let i = 0; i < 3; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return `${prefix}${s}`.toUpperCase();
}

export const CARDS_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      minItems: CARDS_PER_DECK,
      maxItems: CARDS_PER_DECK,
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nombre corto con artículo, p. ej. 'El founder'" },
          verse: { type: "string", description: "Verso de 2 líneas, rima, sin decir el nombre" },
          visual: { type: "string", description: "Descripción visual breve para ilustrar la carta" },
        },
        required: ["name", "verse", "visual"],
      },
    },
  },
  required: ["cards"],
};

export function buildCardsPrompt(theme, context = "", count = CARDS_PER_DECK) {
  const ctx = context?.trim()
    ? `
Usa este contenido como inspiración para los nombres y versos. Toma nombres de
eventos, casas temáticas, tecnologías, roles y lugares que aparezcan:
---
${context.trim()}
---
`
    : "";
  return `Eres el gritón de una lotería mexicana. Genera exactamente ${count} cartas para una
lotería con el tema: "${theme}".
${ctx}
Reglas:
- Cada carta tiene un nombre corto con artículo, al estilo de la lotería
  tradicional: "El founder", "La AI House", "El pitch", "La demo que no cargó".
- Cada verso tiene 2 líneas, rima, tono picaresco y mexicano, máximo 20 palabras.
  No reveles el nombre de la carta en el verso: el verso es la adivinanza y el
  nombre se grita al final.
- Humor de la comunidad tech de CDMX: founders, devs, inversionistas, demos,
  networking, café, bugs, IA.
- Nada ofensivo ni sobre personas reales.
- Sin repetir temas entre cartas.
- "visual" describe en una frase, en español, el sujeto central para ilustrar la
  carta (objeto o personaje, sin texto).

Responde solo con JSON.`;
}

export function imagePrompt(visual) {
  return `Carta de lotería mexicana tradicional. Ilustración plana estilo litografía
antigua, trazos gruesos, colores saturados (rojo, amarillo, azul, verde),
fondo liso, borde decorativo sencillo. Sujeto central: ${String(visual).trim()}.
Sin texto, sin letras, sin números. Composición vertical, un solo elemento.`;
}

/**
 * Text spoken by the caller for one card. Tags like [shouts] are ElevenLabs v3 audio tags.
 * The verse and the name are wrapped in exclamation marks and each gets its own tag, so the
 * model shouts both parts like a fair caller instead of reading the verse as narration.
 * With an empty tag the result is plain text for TTS engines that would read tags aloud.
 */
export function ttsText(card, tag = "[shouts]") {
  const verse = String(card.verse ?? "")
    .replace(/\s*\n\s*/g, ", ")
    .replace(/[¡!.,;:\s]+$/u, "")
    .replace(/^[¡!\s]+/u, "")
    .trim();
  const name = String(card.name ?? "").replace(/[¡!]/g, "").trim();
  const t = tag ? `${tag} ` : "";
  return `${t}¡${verse}! ... ${t}¡${name}!`;
}

/** ElevenLabs v3 only accepts these stability values (Creative, Natural, Robust); v4 is treated the same. */
export const ELEVEN_V3_STABILITIES = [0, 0.5, 1];

/**
 * Voice stability for ElevenLabs. 0.5 ("Natural" in v3) keeps the same accent and timbre from
 * card to card; 0.0 ("Creative") is more theatrical but drifts between generations. Accepts the
 * raw secret value; v3 values snap to the nearest allowed step.
 */
export function elevenStability(raw, modelId, fallback = 0.5) {
  const n = Number(raw);
  const v = raw === undefined || raw === null || String(raw).trim() === "" || !Number.isFinite(n)
    ? fallback
    : Math.min(1, Math.max(0, n));
  if (!/^eleven_v[34]/.test(String(modelId))) return v;
  return ELEVEN_V3_STABILITIES.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best));
}

/** Backoff before retry `attempt` (1-based) after an ElevenLabs 429, in ms, with jitter. */
export function elevenBackoffMs(attempt, random = Math.random) {
  return Math.min(1500 * attempt, 6000) + Math.round(random() * 1000);
}

export const LOTERIA_SHOUT_TEXT = "[laughs] ¡Lotería! ¡Tenemos ganador!";

/** Strip markdown noise from a Firecrawl page so the LLM gets dense text. */
export function cleanContext(markdown, maxChars = 12000) {
  if (!markdown) return "";
  return String(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")      // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")    // links -> text
    .replace(/https?:\/\/\S+/g, "")             // bare urls
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

/** Validate the LLM output shape before trusting it. */
export function normalizeCards(raw, count = CARDS_PER_DECK) {
  const cards = Array.isArray(raw?.cards) ? raw.cards : [];
  const seen = new Set();
  const out = [];
  for (const c of cards) {
    const name = String(c?.name ?? "").trim();
    const verse = String(c?.verse ?? "").trim();
    const visual = String(c?.visual ?? "").trim();
    if (!name || !verse) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, verse, visual: visual || name });
    if (out.length === count) break;
  }
  if (out.length < count) {
    throw new Error(`LLM returned ${out.length} usable cards, expected ${count}`);
  }
  return out;
}
