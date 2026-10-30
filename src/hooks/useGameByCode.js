import { useCallback, useEffect, useRef, useState } from "react";
import { mergeGame } from "@shared/game.js";
import { base44 } from "@/api/base44Client";
import { errorMessage, sortCards } from "@/lib/api";

const { Game, Deck, Card } = base44.entities;

/**
 * Loads a Game by its public code, plus its Deck and Cards.
 * `refresh()` reloads everything; `refreshGame()` only re-reads the Game (cheap, for polling).
 * Reads go through `mergeGame`, so a slow answer never takes the screen backwards (a called card
 * disappearing, the winner vanishing). `setGame` is the raw setter for optimistic updates and reverts.
 */
export function useGameByCode(code) {
  const [state, setState] = useState({
    game: null,
    deck: null,
    cards: [],
    loading: true,
    notFound: false,
    error: null,
  });
  const gameIdRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const normalized = String(code ?? "").trim().toUpperCase();
    if (!normalized) {
      setState((s) => ({ ...s, loading: false, notFound: true }));
      return;
    }
    setState((s) => ({ ...s, loading: !s.game, error: null }));
    try {
      const games = await Game.filter({ code: normalized }, "-created_date", 1);
      const game = games?.[0];
      if (!game) {
        if (aliveRef.current) setState((s) => ({ ...s, loading: false, notFound: true, game: null }));
        return;
      }
      gameIdRef.current = game.id;
      const [deck, cards] = await Promise.all([
        game.deck_id ? Deck.get(game.deck_id).catch(() => null) : null,
        game.deck_id ? Card.filter({ deck_id: game.deck_id }, "number", 100) : [],
      ]);
      if (!aliveRef.current) return;
      setState({
        game,
        deck,
        cards: sortCards(cards),
        loading: false,
        notFound: false,
        error: null,
      });
    } catch (err) {
      if (aliveRef.current) setState((s) => ({ ...s, loading: false, error: errorMessage(err) }));
    }
  }, [code]);

  const refreshGame = useCallback(async () => {
    const id = gameIdRef.current;
    if (!id) return null;
    try {
      const game = await Game.get(id);
      if (aliveRef.current && game) setState((s) => ({ ...s, game: mergeGame(s.game, game), error: null }));
      return game;
    } catch (err) {
      if (aliveRef.current) setState((s) => ({ ...s, error: errorMessage(err) }));
      throw err;
    }
  }, []);

  /** Optimistic local update of the game record. */
  const setGame = useCallback((updater) => {
    setState((s) => ({ ...s, game: typeof updater === "function" ? updater(s.game) : updater }));
  }, []);

  useEffect(() => {
    gameIdRef.current = null;
    refresh();
  }, [refresh]);

  return { ...state, refresh, refreshGame, setGame };
}
