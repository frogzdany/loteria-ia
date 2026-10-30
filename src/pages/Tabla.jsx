import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { calledPositions, dealBoard, isWinner } from "@shared/loteria.js";
import { resolveClaim } from "@shared/game.js";
import { base44 } from "@/api/base44Client";
import Bean from "@/components/Bean";
import LoteriaCard, { CardBack } from "@/components/LoteriaCard";
import StatusScreen, { InlineError } from "@/components/StatusScreen";
import WinnerBanner from "@/components/WinnerBanner";
import NotFound from "@/pages/NotFound";
import { useGameByCode } from "@/hooks/useGameByCode";
import { usePolling } from "@/hooks/usePolling";
import { errorMessage, validateBoard } from "@/lib/api";
import { createLatestWriter } from "@/lib/latestWriter";

const { Board } = base44.entities;
const storageKey = (code) => `loteria:board:${code}`;

function readStoredId(code) {
  try {
    return window.localStorage.getItem(storageKey(code));
  } catch {
    return null;
  }
}
function writeStoredId(code, id) {
  try {
    if (id) window.localStorage.setItem(storageKey(code), id);
    else window.localStorage.removeItem(storageKey(code));
  } catch {
    // private mode: the board just won't survive a refresh
  }
}

export default function TablaRoute() {
  const { code } = useParams();
  return <Tabla key={code} code={String(code ?? "").toUpperCase()} />;
}

function Tabla({ code }) {
  const { game, deck, cards, loading, notFound, error, refresh, refreshGame } = useGameByCode(code);

  const [board, setBoard] = useState(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState(null);

  // Restore the board saved for this game code.
  const loadBoard = useCallback(async () => {
    if (!game?.id) return;
    const id = readStoredId(code);
    if (!id) {
      setBoardLoading(false);
      return;
    }
    setBoardLoading(true);
    setBoardError(null);
    try {
      const b = await Board.get(id);
      if (b && b.game_id === game.id) setBoard(b);
      else writeStoredId(code, null);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404 || status === 400) writeStoredId(code, null);
      else setBoardError(errorMessage(err));
    } finally {
      setBoardLoading(false);
    }
  }, [code, game?.id]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  usePolling(refreshGame, 3000, { enabled: Boolean(game?.id) });

  if (loading) return <StatusScreen loading title="Repartiendo tablas…" homeLink={false} />;
  if (notFound)
    return <NotFound title="Juego no encontrado" message={`No existe un juego con el código ${code}. Revisa el QR de la pantalla.`} />;
  if (!game)
    return (
      <StatusScreen title="No se pudo abrir el juego" message={error}>
        <button type="button" className="btn btn-oro" onClick={refresh}>
          Reintentar
        </button>
      </StatusScreen>
    );
  if (boardLoading) return <StatusScreen loading title="Buscando tu tabla…" homeLink={false} />;
  if (boardError)
    return (
      <StatusScreen title="No se pudo cargar tu tabla" message={boardError}>
        <button type="button" className="btn btn-oro" onClick={loadBoard}>
          Reintentar
        </button>
      </StatusScreen>
    );

  if (!board) {
    return (
      <JoinForm
        game={game}
        deck={deck}
        cards={cards}
        onJoined={(b) => {
          writeStoredId(code, b.id);
          setBoard(b);
        }}
      />
    );
  }

  return <PlayBoard game={game} cards={cards} board={board} setBoard={setBoard} refreshGame={refreshGame} pollError={error} />;
}

function JoinForm({ game, deck, cards, onJoined }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    const playerName = name.trim().replace(/\s+/g, " ");
    if (!playerName) {
      setErr("Escribe tu nombre para recibir tu tabla.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const card_ids = dealBoard(cards.map((c) => c.id));
      const b = await Board.create({ game_id: game.id, player_name: playerName, card_ids, marked: [] });
      onJoined(b);
    } catch (e2) {
      setErr(
        /Need at least/.test(e2?.message ?? "")
          ? "Esta baraja todavía no tiene 16 cartas. Avísale al gritón."
          : errorMessage(e2)
      );
      setBusy(false);
    }
  };

  return (
    <main className="paper-grain flex min-h-[100dvh] flex-col bg-crema px-5 pb-8 pt-8">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
        <p className="font-display text-lg text-rojo">Lotería Tech Week</p>
        <h1 className="mt-2 text-[2.6rem] leading-[0.95]">Recibe tu tabla</h1>
        <p className="mt-3 font-verse text-lg">
          {deck?.theme ? `Baraja: ${deck.theme}. ` : ""}Juego <span className="font-display tracking-wider">{game.code}</span>
        </p>

        <div className="relative mx-auto my-8 h-40 w-56" aria-hidden="true">
          {[-12, 0, 12].map((r, i) => (
            <div
              key={r}
              className="absolute left-1/2 top-0 w-24 -translate-x-1/2 shadow-print"
              style={{ transform: `translateX(${(i - 1) * 52 - 50}%) rotate(${r}deg)` }}
            >
              <CardBack />
            </div>
          ))}
        </div>

        {game.status === "finished" && (
          <p className="mb-4 border-[3px] border-tinta bg-oro px-4 py-3 font-verse rounded-[4px]">
            Este juego ya terminó{game.winner_name ? `: ganó ${game.winner_name}` : ""}. Puedes entrar a ver tu tabla.
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-auto space-y-4">
          <label htmlFor="player" className="block font-display text-xl">
            Tu nombre
          </label>
          <input
            id="player"
            className="field text-xl"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como te conocen en el evento"
            autoComplete="nickname"
            enterKeyHint="go"
            maxLength={30}
          />
          <InlineError>{err}</InlineError>
          <button type="submit" disabled={busy} className="btn btn-rojo w-full py-4 text-xl">
            {busy ? "Repartiendo…" : "Recibir mi tabla"}
          </button>
        </form>
      </div>
    </main>
  );
}

function PlayBoard({ game, cards, board, setBoard, refreshGame, pollError }) {
  const [message, setMessage] = useState(null); // { tone, text }
  const [checking, setChecking] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [banner, setBanner] = useState(null); // "mine" | "other" | null
  const [winningLine, setWinningLine] = useState(board.winning_line?.length ? board.winning_line : null);
  const boardRef = useRef(board);
  boardRef.current = board;
  const msgTimer = useRef(null);
  const seenWinner = useRef(null);

  const called = game.called_card_ids ?? [];
  const byId = new Map(cards.map((c) => [c.id, c]));
  const last = called.length ? byId.get(called[called.length - 1]) : null;
  const calledSet = new Set(calledPositions(board, called));
  const marked = new Set(board.marked ?? []);
  const lineSet = new Set(winningLine ?? []);
  const finished = game.status === "finished" || Boolean(game.winner_board_id);
  const iWon = game.winner_board_id === board.id;

  const flash = (tone, text, ms = 3500) => {
    clearTimeout(msgTimer.current);
    setMessage({ tone, text });
    if (ms) msgTimer.current = setTimeout(() => setMessage(null), ms);
  };
  useEffect(() => () => clearTimeout(msgTimer.current), []);

  // Banner when the game gets a winner (once per winner).
  useEffect(() => {
    const w = game.winner_board_id;
    if (!w || seenWinner.current === w) return;
    seenWinner.current = w;
    setBanner(w === board.id ? "mine" : "other");
  }, [game.winner_board_id, board.id]);

  // Beans are saved one write at a time, newest value last (quick taps cannot land out of order).
  // A claim does not depend on these writes: it sends the beans on screen with the request.
  const writerRef = useRef(null);
  if (!writerRef.current || writerRef.current.boardId !== board.id) {
    writerRef.current = { boardId: board.id, writer: createLatestWriter((marked) => Board.update(board.id, { marked })) };
  }
  const persistMarked = useCallback((next) => {
    writerRef.current.writer.push(next).then(
      () => setSaveError(null),
      (err) => setSaveError(`No se guardó tu frijol: ${errorMessage(err)}`)
    );
  }, []);

  const applyMarks = (next) => {
    boardRef.current = { ...boardRef.current, marked: next };
    setBoard((b) => ({ ...b, marked: next }));
    if (navigator.vibrate) navigator.vibrate(12);
    persistMarked(next);
  };

  // A bean goes only on a card that was already called. The phone can be up to 3 s behind the
  // projector, so before refusing it re-reads the game once. Removing a bean is always allowed.
  const toggle = async (pos) => {
    if (finished) return;
    const current = new Set(boardRef.current.marked ?? []);
    if (current.has(pos)) {
      current.delete(pos);
      applyMarks([...current].sort((a, b) => a - b));
      return;
    }
    let isCalled = calledSet.has(pos);
    if (!isCalled) {
      const fresh = await refreshGame().catch(() => null);
      isCalled = calledPositions(boardRef.current, fresh?.called_card_ids ?? []).includes(pos);
    }
    if (!isCalled) {
      flash("no", "Esa carta todavía no sale", 2000);
      return;
    }
    current.add(pos);
    applyMarks([...current].sort((a, b) => a - b));
  };

  const showClaim = (res, viaPhone) => {
    if (res?.valid && res.isFirstWinner) {
      clearTimeout(msgTimer.current);
      setMessage(null);
      setWinningLine(res.winningLine ?? null);
      seenWinner.current = boardRef.current.id;
      setBanner("mine");
      if (viaPhone) flash("late", "Validado en tu celular: el servidor no respondió. Enséñale tu tabla al gritón.", 8000);
    } else if (res?.valid) {
      setWinningLine(res.winningLine ?? null);
      flash("late", `Línea válida, pero ya ganó ${res.winnerName ?? "alguien más"}`, 6000);
    } else {
      flash("no", "Aún no, sigue jugando");
    }
  };

  const onLoteria = async () => {
    if (finished || checking) return;
    const current = boardRef.current;
    setChecking(true);
    // The phone may not have polled the card that was just called (up to 3 s behind the projector).
    // Re-read the game before saying "not yet", so a real line is never rejected for being early.
    if (!isWinner(current, called)) {
      const fresh = await refreshGame().catch(() => null);
      const freshCalled = fresh?.called_card_ids ?? [];
      if (!isWinner(current, freshCalled.length > called.length ? freshCalled : called)) {
        flash("no", "Aún no, sigue jugando");
        setChecking(false);
        return;
      }
    }
    const marked = current.marked ?? [];
    try {
      showClaim(await validateBoard(current.id, marked, game.id), false);
    } catch (err) {
      // Backend unavailable (no credits, functions offline): run the same claim rules from the
      // phone against the entities. The projector polls Game and shows the banner either way.
      try {
        showClaim(await resolveClaim(base44.entities, { boardId: current.id, marked, gameId: game.id }), true);
      } catch (err2) {
        console.error("Validación local fallida", err2);
        flash("error", `No se pudo revisar tu tabla: ${errorMessage(err)}`, 6000);
      }
    } finally {
      refreshGame().catch(() => null);
      setChecking(false);
    }
  };

  const toneClass = {
    no: "bg-oro text-tinta",
    late: "bg-azul text-crema",
    error: "bg-rojo text-crema",
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-crema">
      {/* Last called card */}
      <header className="sticky top-0 z-20 border-b-4 border-tinta bg-tinta px-3 pb-2 pt-2 text-crema">
        <div className="flex items-baseline justify-between gap-2 font-verse text-sm text-crema/70">
          <span className="truncate">
            {board.player_name}, juego {game.code}
          </span>
          <span className="shrink-0 tabular-nums">
            {called.length}/{cards.length} cantadas
          </span>
        </div>
        <div className="mt-1 flex min-h-[2.75rem] items-center gap-3" aria-live="polite">
          {last ? (
            <>
              <span className="grid h-10 min-w-10 place-items-center border-[3px] border-oro px-1 font-display text-xl text-oro rounded-[4px]">
                {last.number}
              </span>
              <span className="min-w-0 flex-1 truncate font-display text-[1.6rem] leading-tight">{last.name}</span>
            </>
          ) : (
            <span className="font-verse text-lg italic text-crema/80">Esperando la primera carta…</span>
          )}
        </div>
      </header>

      {(saveError || pollError) && (
        <div className="px-3 pt-2">
          <InlineError>{saveError || "Conexión inestable, reintentando…"}</InlineError>
        </div>
      )}

      {/* Board */}
      <main className="flex-1 px-2.5 pb-32 pt-3">
        <div className="tabla-sheet grid grid-cols-4 gap-1.5" role="grid" aria-label="Tu tabla">
          {(board.card_ids ?? []).map((id, pos) => {
            const card = byId.get(id) ?? { number: "?", name: "Carta" };
            const isCalled = calledSet.has(pos);
            const isMarked = marked.has(pos);
            const inLine = lineSet.has(pos);
            return (
              <button
                key={`${id}-${pos}`}
                type="button"
                role="gridcell"
                aria-pressed={isMarked}
                aria-label={`${card.name}${isCalled ? ", ya cantada" : ""}${isMarked ? ", marcada" : ""}`}
                onClick={() => toggle(pos)}
                className={`relative block touch-manipulation rounded-[5px] text-left outline-offset-2 transition-transform active:scale-[0.97] ${
                  inLine ? "ring-4 ring-verde" : isCalled && !isMarked ? "cell-called ring-4 ring-rojo" : ""
                }`}
              >
                <LoteriaCard card={card} compact imgLoading="eager" className={isCalled || isMarked ? "" : "cell-pending"}>
                  {isMarked && <Bean seed={pos + 1} size="64%" />}
                </LoteriaCard>
              </button>
            );
          })}
        </div>
        {!finished && called.length === 0 && (
          <p className="mx-auto mt-4 max-w-md text-center font-verse text-tinta/70">
            Toca una carta para ponerle frijol cuando la canten.
          </p>
        )}
      </main>

      {/* Shout */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-4 border-tinta bg-crema px-3 pt-3">
        <div className="mx-auto max-w-md">
          {message && (
            <p
              role="status"
              className={`card-deal mb-3 border-[3px] border-tinta px-4 py-2 text-center font-display text-lg rounded-[4px] ${
                toneClass[message.tone] ?? "bg-white"
              }`}
            >
              {message.text}
            </p>
          )}
          {finished && !message && (
            <p className="mb-3 text-center font-display text-lg">
              {iWon ? "¡Ganaste esta partida!" : game.winner_name ? `Ganó ${game.winner_name}` : "El juego terminó"}
            </p>
          )}
          {finished && <NextGame code={game.next_game_code} />}
          <button
            type="button"
            onClick={onLoteria}
            disabled={finished || checking}
            className="btn btn-rojo w-full py-4 text-[1.75rem]"
          >
            {checking ? "Revisando tu tabla…" : "¡Lotería!"}
          </button>
        </div>
      </div>

      {banner === "mine" && (
        <WinnerBanner
          size="sm"
          title="¡Ganaste!"
          name={board.player_name}
          subtitle="Enséñale tu tabla al gritón"
          onClose={() => setBanner(null)}
          actions={<NextGame code={game.next_game_code} onBanner />}
        />
      )}
      {banner === "other" && (
        <WinnerBanner
          size="sm"
          title="¡Lotería!"
          name={`Ganó ${game.winner_name ?? "alguien más"}`}
          subtitle="Suerte para la próxima"
          confetti={false}
          onClose={() => setBanner(null)}
          actions={<NextGame code={game.next_game_code} onBanner />}
        />
      )}
    </div>
  );
}

/**
 * After a winner: join the next game the caller opened with the same deck (no new QR scan),
 * or go home. The caller's "Nuevo juego con esta baraja" writes next_game_code on this game.
 */
function NextGame({ code, onBanner = false }) {
  const navigate = useNavigate();
  return (
    <div className={`flex flex-col items-center gap-2 ${onBanner ? "mt-4" : "mb-3"}`}>
      {code ? (
        <button type="button" className="btn btn-oro w-full max-w-xs" onClick={() => navigate(`/tabla/${code}`)}>
          Jugar el siguiente juego
        </button>
      ) : (
        <p className={`font-verse text-sm ${onBanner ? "text-crema/80" : "text-tinta/70"}`}>
          Si el gritón abre otro juego, aquí aparece el botón para unirte.
        </p>
      )}
      <Link to="/" className={`font-verse text-sm underline ${onBanner ? "text-crema" : "text-tinta"}`}>
        Ir al inicio
      </Link>
    </div>
  );
}
