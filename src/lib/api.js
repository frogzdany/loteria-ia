import { base44 } from "@/api/base44Client";

/** Human-readable message for anything thrown by the SDK, axios or our own code. */
export function errorMessage(err, fallback = "Algo salió mal. Intenta de nuevo.") {
  if (!err) return fallback;
  const body = err.response?.data ?? err.data;
  if (body && typeof body === "object" && body.error) return String(body.error);
  // Platform-level errors (e.g. 402 when the Base44 integration credits run out) use message/detail.
  if (body && typeof body === "object" && (body.message || body.detail)) {
    const text = String(body.message || body.detail);
    return /limit of integrations|credits/i.test(text)
      ? "Base44 sin créditos de integraciones este mes. Hay que subir el plan o esperar al corte."
      : text.slice(0, 300);
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  if (err.message === "Network Error" || err.code === "ERR_NETWORK") {
    return "Sin conexión con el servidor. Revisa tu internet.";
  }
  return err.message || fallback;
}

/** Invoke a backend function and return its JSON body; rethrow with a readable message. */
async function invoke(name, body) {
  try {
    const res = await base44.functions.invoke(name, body);
    return res.data;
  } catch (err) {
    const e = new Error(errorMessage(err, `Falló la función ${name}`));
    e.status = err.response?.status;
    e.data = err.response?.data;
    e.cause = err;
    throw e;
  }
}

function compact(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

/** → { deckId, theme, provider: "base44" | "mock", cards: [{ id, number, name, verse }] } (500 → { error, deckId }) */
export function generateDeck({ theme, sourceUrl } = {}) {
  return invoke("generate-deck", compact({ theme: theme?.trim(), sourceUrl: sourceUrl?.trim() }));
}

/** → { card, progress, status, errors: string[], provider } */
export function generateCardAssets(cardId, force = false) {
  return invoke("generate-card-assets", force ? { cardId, force: true } : { cardId });
}

/**
 * → { valid, winningLine, isFirstWinner, winnerName, calledCount }. `marked` are the beans on the
 * phone right now; the server validates those (only called cards count) and stores them.
 * Takes 1 to 2 s on purpose: the server waits for simultaneous claims before naming the winner.
 */
export function validateBoard(boardId, marked, gameId) {
  return invoke("validate-board", compact({ boardId, marked: Array.isArray(marked) ? marked : undefined, gameId }));
}

/** → { audio_url?, audio_b64? } */
export function speakCard({ cardId, text } = {}) {
  return invoke("speak-card", compact({ cardId, text }));
}

/**
 * Run `worker(item, index)` over `items` with at most `concurrency` in flight.
 * Never rejects: resolves to Promise.allSettled-style results in input order.
 */
export async function runPool(items, worker, concurrency = 4) {
  const list = Array.from(items ?? []);
  const results = new Array(list.length);
  let cursor = 0;
  async function lane() {
    while (cursor < list.length) {
      const i = cursor++;
      try {
        results[i] = { status: "fulfilled", value: await worker(list[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, lane);
  await Promise.all(lanes);
  return results;
}

/** Playable source for a card: uploaded MP3 first, then the base64 plan B. */
export function cardAudioSrc(card) {
  if (!card) return null;
  if (card.audio_url) return card.audio_url;
  if (card.audio_b64) {
    return card.audio_b64.startsWith("data:") ? card.audio_b64 : `data:audio/mpeg;base64,${card.audio_b64}`;
  }
  return null;
}

export function cardHasAssets(card) {
  return Boolean(card?.image_url && (card.audio_url || card.audio_b64));
}

export function sortCards(cards) {
  return [...(cards ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

export function tablaUrl(code) {
  return `${window.location.origin}/tabla/${code}`;
}
