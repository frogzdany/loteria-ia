import { makeGameCode } from "@shared/loteria.js";
import { base44 } from "@/api/base44Client";

const { Game } = base44.entities;

/** Create a Game in lobby with a code nobody else uses (retries on collision). */
export async function createGame(deckId, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const code = makeGameCode();
    const taken = await Game.filter({ code });
    if (taken?.length) continue;
    return Game.create({ deck_id: deckId, code, status: "lobby", called_card_ids: [] });
  }
  throw new Error("No se pudo generar un código de juego libre. Intenta de nuevo.");
}

export const STATUS_LABEL = {
  lobby: "En espera",
  playing: "Jugando",
  finished: "Terminado",
  generating: "Generando",
  ready: "Lista",
  error: "Con error",
};
