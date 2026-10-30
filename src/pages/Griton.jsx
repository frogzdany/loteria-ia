import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Users, Volume2 } from "lucide-react";
import { mergeGame, planNextCall } from "@shared/game.js";
import { base44 } from "@/api/base44Client";
import LoteriaCard, { CardBack } from "@/components/LoteriaCard";
import QrBlock from "@/components/QrBlock";
import StatusScreen, { InlineError } from "@/components/StatusScreen";
import WinnerBanner from "@/components/WinnerBanner";
import NotFound from "@/pages/NotFound";
import { useAudio } from "@/hooks/useAudio";
import { useGameByCode } from "@/hooks/useGameByCode";
import { usePolling } from "@/hooks/usePolling";
import { cardAudioSrc, errorMessage, speakCard, tablaUrl } from "@/lib/api";
import { createGame } from "@/lib/games";
import { nameFontSize } from "@/lib/fitText";

const { Game, Board } = base44.entities;

export default function GritonRoute() {
  const { code } = useParams();
  return <Griton key={code} code={String(code ?? "").toUpperCase()} />;
}

function Griton({ code }) {
  const navigate = useNavigate();
  const { game, deck, cards, loading, notFound, error, refresh, refreshGame, setGame } = useGameByCode(code);
  const { play: playAudio, stop: stopAudio } = useAudio();

  const [players, setPlayers] = useState(null);
  const [nextBusy, setNextBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [audioNote, setAudioNote] = useState(null);
  const [bannerFor, setBannerFor] = useState(null);
  const [creating, setCreating] = useState(false);

  const updatingRef = useRef(false);
  const shoutedRef = useRef(null);

  const called = game?.called_card_ids ?? [];
  const byId = new Map(cards.map((c) => [c.id, c]));
  const current = called.length ? byId.get(called[called.length - 1]) : null;
  const exhausted = cards.length > 0 && called.length >= cards.length;
  const finished = Boolean(game?.winner_board_id) || game?.status === "finished";
  const url = tablaUrl(code);

  // ---- polling: game (winner, calls from another tab) + player count ----
  const poll = useCallback(async () => {
    const tasks = [];
    if (!updatingRef.current) tasks.push(refreshGame().catch(() => null));
    if (game?.id) {
      tasks.push(
        Board.filter({ game_id: game.id }, null, 1000, 0, ["id"])
          .then((b) => setPlayers(b?.length ?? 0))
          .catch(() => null)
      );
    }
    await Promise.all(tasks);
  }, [refreshGame, game?.id]);

  usePolling(poll, 2000, { enabled: Boolean(game?.id), immediate: true });

  // ---- winner banner + shout, once per winner ----
  useEffect(() => {
    const winner = game?.winner_board_id;
    if (!winner || shoutedRef.current === winner) return;
    shoutedRef.current = winner;
    setBannerFor(winner);
    if (deck?.shout_audio_url) playAudio(deck.shout_audio_url);
  }, [game?.winner_board_id, deck?.shout_audio_url, playAudio]);

  // ---- speak a card: audio_url → audio_b64 → speak-card (live TTS) ----
  const announce = useCallback(
    async (card) => {
      setAudioNote(null);
      if (!card) return;
      const sources = [card.audio_url, card.audio_b64 ? cardAudioSrc({ audio_b64: card.audio_b64 }) : null];
      for (const src of sources) {
        if (src && (await playAudio(src))) return;
      }
      try {
        const res = await speakCard({ cardId: card.id });
        const src = res?.audio_url || (res?.audio_b64 ? cardAudioSrc({ audio_b64: res.audio_b64 }) : null);
        if (src && (await playAudio(src))) return;
      } catch {
        // falls through to the note below
      }
      setAudioNote("Sin audio para esta carta: cántala en voz alta.");
    },
    [playAudio]
  );

  // Next card. Reads the Game first so the call is based on the server state (a winner that just
  // arrived, a card called from another tab), then writes only the called list (and the lobby to
  // playing switch). It never writes the winner fields or the "finished" status.
  const onNext = useCallback(async () => {
    if (!game || updatingRef.current) return;
    updatingRef.current = true;
    setNextBusy(true);
    setActionError(null);
    try {
      const fresh = mergeGame(game, await Game.get(game.id).catch(() => null));
      const plan = planNextCall(fresh, cards);
      if (!plan.card) {
        setGame(fresh);
        return;
      }
      const prev = fresh;
      setGame({ ...fresh, ...plan.patch });
      announce(plan.card);
      try {
        const updated = await Game.update(game.id, plan.patch);
        if (updated?.id) setGame((g) => mergeGame(g, updated));
      } catch (err) {
        stopAudio();
        setGame(prev);
        setActionError(`No se pudo guardar la carta: ${errorMessage(err)}`);
      }
    } finally {
      updatingRef.current = false;
      setNextBusy(false);
    }
  }, [game, cards, setGame, announce, stopAudio]);

  // Space / ArrowRight = next card.
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === " " || e.code === "Space") {
        if ((e.key === " " || e.code === "Space") && (tag === "BUTTON" || tag === "A")) return;
        e.preventDefault();
        if (!bannerFor && !finished) onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, bannerFor, finished]);

  const onNewGame = async () => {
    if (!game?.deck_id) return;
    setCreating(true);
    setActionError(null);
    try {
      const g = await createGame(game.deck_id);
      // Phones still on this game see the new code and offer to join it without scanning again.
      await Game.update(game.id, { next_game_code: g.code }).catch(() => null);
      navigate(`/griton/${g.code}`);
    } catch (err) {
      setActionError(errorMessage(err));
      setCreating(false);
    }
  };

  if (loading) return <StatusScreen dark loading title="Barajando…" homeLink={false} />;
  if (notFound) return <NotFound dark title="Juego no encontrado" message={`No existe un juego con el código ${code}.`} />;
  if (!game)
    return (
      <StatusScreen dark title="No se pudo abrir el juego" message={error}>
        <button type="button" className="btn btn-oro" onClick={refresh}>
          Reintentar
        </button>
      </StatusScreen>
    );

  const recent = [...called].reverse().map((id) => byId.get(id)).filter(Boolean);
  const playerLabel = players == null ? "…" : `${players} ${players === 1 ? "jugador" : "jugadores"}`;

  return (
    <div className="relative flex h-[100dvh] min-h-[640px] flex-col overflow-hidden bg-tinta text-crema">
      <div className="flex h-2 shrink-0" aria-hidden="true">
        <span className="flex-1 bg-rojo" />
        <span className="flex-1 bg-oro" />
        <span className="flex-1 bg-azul" />
        <span className="flex-1 bg-verde" />
      </div>

      {/* Header */}
      <header className="flex shrink-0 items-center gap-6 px-[2.5vw] pt-[2vh]">
        <div className="min-w-0 flex-1">
          <p className="font-display text-[clamp(1.5rem,2.4vw,3rem)] leading-none text-oro">Lotería Tech Week</p>
          <p className="mt-1 truncate font-verse text-[clamp(1rem,1.2vw,1.5rem)] text-crema/70">
            {deck?.theme ? `${deck.theme}, juego ${game.code}` : `Juego ${game.code}`}
          </p>
        </div>
        <div className="flex items-center gap-3 border-[3px] border-crema/80 px-4 py-2 rounded-[6px]" aria-live="polite">
          <Users className="h-[clamp(1.5rem,2vw,2.5rem)] w-auto text-oro" aria-hidden="true" />
          <span className="font-display text-[clamp(1.5rem,2.2vw,2.75rem)] leading-none tabular-nums">{playerLabel}</span>
        </div>
        <div className="font-display text-[clamp(1.5rem,2.2vw,2.75rem)] leading-none tabular-nums text-crema/80">
          {called.length}/{cards.length}
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={nextBusy || exhausted || finished || cards.length === 0}
          className="btn btn-rojo px-[1.6vw] py-[1.4vh] text-[clamp(1.25rem,1.9vw,2.5rem)] shadow-[6px_6px_0_0_#F4C20D]"
          title="También con Espacio o flecha derecha"
        >
          {finished ? "Juego terminado" : exhausted ? "Se acabaron las cartas" : "Siguiente carta"}
          {!exhausted && !finished && <ChevronRight className="h-[1.2em] w-[1.2em]" aria-hidden="true" />}
        </button>
      </header>

      {(actionError || error) && (
        <div className="px-[2.5vw] pt-3">
          <InlineError onRetry={actionError ? undefined : refresh}>{actionError || `Conexión inestable: ${error}`}</InlineError>
        </div>
      )}

      {/* Stage */}
      <main className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[3vw] px-[3vw] py-[2.5vh]">
        <div className="relative grid place-items-center">
          <div
            className="sunburst sunburst-spin pointer-events-none absolute aspect-square w-[150%] rounded-full opacity-40"
            style={{ "--sb-a": "#1A1A1A", "--sb-b": "#2A2622", "--sb-core": "#1A1A1A" }}
            aria-hidden="true"
          />
          <div className="relative" style={{ width: "min(38vh, 28vw)" }}>
            {current ? (
              <div key={current.id} className="card-deal shadow-[10px_10px_0_0_#F4C20D]">
                <LoteriaCard card={current} imgLoading="eager" />
              </div>
            ) : (
              <CardBack className="shadow-[10px_10px_0_0_#F4C20D]" />
            )}
          </div>
        </div>

        <div className="relative z-10 min-w-0" aria-live="polite">
          {current ? (
            <>
              <p className="font-display text-[clamp(2rem,3.4vw,4.5rem)] leading-none text-oro">Nº {current.number}</p>
              <h1
                className="mt-[1vh] leading-[0.95] text-crema text-shadow-ink-lg [hyphens:none] [word-break:keep-all]"
                style={{ fontSize: `clamp(2.25rem, ${nameFontSize(current.name, 6.6, { width: 40, charEm: 0.62 })}vw, 9rem)` }}
              >
                {current.name}
              </h1>
              {current.verse && (
                <p className="mt-[3vh] max-w-[26ch] whitespace-pre-line font-verse text-[clamp(1.5rem,2.5vw,3.25rem)] italic leading-[1.3] text-crema/90">
                  {current.verse}
                </p>
              )}
              <div className="mt-[3vh] flex flex-wrap items-center gap-4">
                <button type="button" className="btn btn-crema btn-sm text-base" onClick={() => announce(current)}>
                  <Volume2 className="h-5 w-5" aria-hidden="true" />
                  Repetir
                </button>
                {audioNote && <span className="font-verse text-lg text-crema/60">{audioNote}</span>}
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[clamp(3rem,5.5vw,7.5rem)] leading-[0.95] text-crema text-shadow-ink-lg">
                Escanea y recibe tu tabla
              </h1>
              <p className="mt-[3vh] max-w-[30ch] font-verse text-[clamp(1.4rem,2.2vw,3rem)] italic leading-snug text-crema/85">
                Cuando estén listos, presiona Siguiente carta y el gritón empieza a cantar.
              </p>
            </>
          )}
          {exhausted && (
            <p className="mt-[3vh] inline-block border-4 border-oro px-5 py-2 font-display text-[clamp(1.5rem,2.4vw,3rem)] text-oro rounded-[6px]">
              Se acabaron las cartas
            </p>
          )}
        </div>

        <aside className="relative z-10" style={{ width: "min(22vw, 40vh)" }}>
          <QrBlock url={url} size={400} dark caption="Escanea y juega" className="[&_figcaption]:text-[clamp(1.25rem,1.8vw,2.25rem)] [&_p]:text-[clamp(0.9rem,1.1vw,1.4rem)]" />
        </aside>
      </main>

      {/* Called strip */}
      <footer className="shrink-0 border-t-4 border-crema/15 bg-black/30 px-[2.5vw] py-[1.6vh]">
        {recent.length === 0 ? (
          <p className="py-[2vh] font-verse text-[clamp(1rem,1.3vw,1.6rem)] italic text-crema/50">
            Aquí van apareciendo las cartas que ya se cantaron.
          </p>
        ) : (
          <ol className="flex gap-[0.8vw] overflow-hidden" aria-label="Cartas cantadas, la más reciente primero">
            {recent.map((c, i) => (
              <li
                key={c.id}
                className={`shrink-0 transition-opacity ${i === 0 ? "" : "opacity-80"}`}
                style={{ width: "min(6.2vw, 11vh)" }}
              >
                <LoteriaCard card={c} compact />
              </li>
            ))}
          </ol>
        )}
      </footer>

      {bannerFor && (
        <WinnerBanner
          name={game.winner_name || "¡Tenemos ganador!"}
          subtitle="Que pase a revisar su tabla"
          onClose={() => setBannerFor(null)}
          actions={
            <button type="button" className="btn btn-oro text-xl" onClick={onNewGame} disabled={creating}>
              {creating ? "Creando…" : "Nuevo juego con esta baraja"}
            </button>
          }
        />
      )}

      {!bannerFor && (game.winner_board_id || exhausted) && (
        <div className="absolute bottom-[calc(11vh+3vh)] right-[2.5vw] flex items-center gap-3">
          {game.winner_name && <span className="font-display text-xl text-oro">Ganó {game.winner_name}</span>}
          <button type="button" className="btn btn-oro btn-sm" onClick={onNewGame} disabled={creating}>
            Nuevo juego con esta baraja
          </button>
        </div>
      )}
    </div>
  );
}
