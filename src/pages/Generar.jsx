import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { RotateCcw, Wand2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import LoteriaCard, { CardBack } from "@/components/LoteriaCard";
import PapelPicado from "@/components/PapelPicado";
import ProgressBar from "@/components/ProgressBar";
import { InlineError, Spinner } from "@/components/StatusScreen";
import { useAudio } from "@/hooks/useAudio";
import { usePolling } from "@/hooks/usePolling";
import {
  cardAudioSrc,
  cardHasAssets,
  errorMessage,
  generateCardAssets,
  generateDeck,
  runPool,
  sortCards,
} from "@/lib/api";
import { createGame, STATUS_LABEL } from "@/lib/games";

const { Deck, Card } = base44.entities;
const DEFAULT_URL = "https://mexicotechweek.mx/es-mx";

export default function Generar() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const deckId = params.get("deck");

  const [theme, setTheme] = useState("");
  const [sourceUrl, setSourceUrl] = useState(DEFAULT_URL);
  const [formError, setFormError] = useState(null);
  const [writing, setWriting] = useState(false);

  const [deck, setDeck] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(Boolean(deckId));
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [poolRunning, setPoolRunning] = useState(false);
  const [busy, setBusy] = useState(() => new Set());
  const [cardErrors, setCardErrors] = useState({});
  const [creating, setCreating] = useState(false);
  const [gameError, setGameError] = useState(null);
  // Set by generate-deck; also inferred from SVG placeholders when a mock deck is reopened.
  const [provider, setProvider] = useState(null);

  const audio = useAudio();
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadDeck = useCallback(async (id, { quiet = false } = {}) => {
    if (!id) return;
    if (!quiet) {
      setLoading(true);
      setNotFound(false);
    }
    try {
      const [d, cs] = await Promise.all([
        Deck.get(id).catch((err) => {
          if (err?.response?.status === 404) return null;
          throw err;
        }),
        Card.filter({ deck_id: id }, "number", 100),
      ]);
      if (!aliveRef.current) return;
      if (!d) {
        setNotFound(true);
        setDeck(null);
        setCards([]);
      } else {
        setDeck(d);
        setCards(sortCards(cs));
      }
      setLoadError(null);
    } catch (err) {
      if (aliveRef.current) setLoadError(errorMessage(err));
    } finally {
      if (aliveRef.current && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (deckId) loadDeck(deckId);
    else {
      setDeck(null);
      setCards([]);
      setLoading(false);
      setNotFound(false);
    }
  }, [deckId, loadDeck]);

  // Poll every 2 s while the deck is generating or our worker pool is running.
  usePolling(() => loadDeck(deckId, { quiet: true }), 2000, {
    enabled: Boolean(deckId) && (deck?.status === "generating" || poolRunning),
  });

  const setCardBusy = (id, on) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const fillAssets = useCallback(async (ids, force = false) => {
    if (!ids.length) return;
    setPoolRunning(true);
    await runPool(
      ids,
      async (id) => {
        setCardBusy(id, true);
        setCardErrors((e) => ({ ...e, [id]: null }));
        try {
          const res = await generateCardAssets(id, force);
          if (!aliveRef.current) return;
          if (res?.card) setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...res.card } : c)));
          if (res && (res.progress != null || res.status)) {
            setDeck((d) =>
              d
                ? {
                    ...d,
                    progress: res.progress ?? d.progress,
                    status: res.status ?? d.status,
                  }
                : d
            );
          }
          if (res?.errors?.length) setCardErrors((e) => ({ ...e, [id]: res.errors.join("; ") }));
        } catch (err) {
          if (aliveRef.current) setCardErrors((e) => ({ ...e, [id]: errorMessage(err) }));
        } finally {
          if (aliveRef.current) setCardBusy(id, false);
        }
      },
      4
    );
    if (aliveRef.current) setPoolRunning(false);
  }, []);

  // After the pool finishes, re-read the deck so status/progress match the server.
  const prevPool = useRef(false);
  useEffect(() => {
    if (prevPool.current && !poolRunning && deckId) loadDeck(deckId, { quiet: true });
    prevPool.current = poolRunning;
  }, [poolRunning, deckId, loadDeck]);

  const onGenerate = async (e) => {
    e.preventDefault();
    setFormError(null);
    const t = theme.trim();
    const u = sourceUrl.trim();
    if (!t && !u) {
      setFormError("Escribe un tema o pega una dirección para inspirar la baraja.");
      return;
    }
    if (u && !/^https?:\/\/\S+\.\S+/.test(u)) {
      setFormError("La dirección debe empezar con https:// (o déjala vacía).");
      return;
    }
    setWriting(true);
    try {
      const res = await generateDeck({ theme: t, sourceUrl: u });
      if (!aliveRef.current) return;
      const newCards = sortCards(res?.cards ?? []);
      setProvider(res?.provider ?? null);
      setDeck({
        id: res.deckId,
        theme: res.theme ?? t,
        status: "generating",
        progress: 0,
        card_count: newCards.length || 16,
      });
      setCards(newCards);
      setParams({ deck: res.deckId });
      setWriting(false);
      fillAssets(newCards.map((c) => c.id));
    } catch (err) {
      if (!aliveRef.current) return;
      setWriting(false);
      setFormError(errorMessage(err));
      if (err.data?.deckId) setParams({ deck: err.data.deckId });
    }
  };

  const missing = cards.filter((c) => !cardHasAssets(c));
  // A game needs the 16 card records, not their assets: a card without image or audio
  // shows a CSS placeholder and the host sings it. This keeps the demo playable when
  // the image/TTS credits run out mid-generation.
  const expected = Number(deck?.card_count) || 16;
  const allCardsExist = cards.length >= expected && cards.length >= 16;
  const ready = deck?.status === "ready" || (allCardsExist && !poolRunning);

  const onCreateGame = async () => {
    setGameError(null);
    setCreating(true);
    try {
      const game = await createGame(deck.id);
      navigate(`/griton/${game.code}`);
    } catch (err) {
      if (aliveRef.current) setGameError(errorMessage(err));
    } finally {
      if (aliveRef.current) setCreating(false);
    }
  };

  const playCard = (card) => {
    const src = cardAudioSrc(card);
    if (src) audio.toggle(src);
  };

  const showForm = !deckId && !writing;
  const providerName =
    deck?.provider || provider || (cards.some((c) => String(c.image_url ?? "").startsWith("data:image/svg")) ? "mock" : null);
  const providerNote = !deckId
    ? null
    : providerName === "mock"
      ? "Baraja de prueba: proveedor mock, sin IA ni créditos. Cartas fijas, dibujos de relleno y un bip por verso. Solo en desarrollo local."
      : providerName === "openai"
        ? "Baraja generada con OpenAI desde tu propia llave: texto, imágenes y voz de respaldo. Las imágenes se guardan con UploadFile."
        : null;

  return (
    <div className="paper-grain min-h-[100dvh] bg-crema">
      <PapelPicado />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-8">
        <nav className="flex items-center justify-between gap-4">
          <Link to="/" className="font-display text-xl text-rojo">
            Lotería Tech Week
          </Link>
          {deckId && (
            <button
              type="button"
              className="btn btn-crema btn-sm"
              onClick={() => {
                audio.stop();
                setParams({});
              }}
            >
              Nueva baraja
            </button>
          )}
        </nav>

        {providerNote && (
          <p className="mt-4 border-2 border-tinta bg-oro/30 px-4 py-2 font-verse text-sm" role="status">
            {providerNote}
          </p>
        )}

        {showForm && (
          <section className="mx-auto mt-10 max-w-2xl">
            <h1 className="text-[clamp(2.25rem,6vw,4rem)] leading-none">Generar baraja</h1>
            <p className="mt-4 max-w-[60ch] font-verse text-lg leading-relaxed">
              La IA escribe 16 cartas con su verso, las ilustra y graba al gritón cantándolas. Tarda un par de minutos.
            </p>
            <form
              onSubmit={onGenerate}
              className="mt-8 space-y-6 border-4 border-tinta bg-white p-5 shadow-print-lg rounded-[6px] sm:p-8"
            >
              <div>
                <label htmlFor="theme" className="font-display text-lg">
                  Tema
                </label>
                <input
                  id="theme"
                  className="field mt-2"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="Mexico Tech Week 2026, la comunidad tech de CDMX"
                  maxLength={160}
                />
              </div>
              <div>
                <label htmlFor="source" className="font-display text-lg">
                  Página para inspirarse <span className="font-verse text-base font-normal">(opcional)</span>
                </label>
                <input
                  id="source"
                  className="field mt-2"
                  type="url"
                  inputMode="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://"
                />
                <p className="mt-2 font-verse text-sm text-tinta/70">
                  Se lee la agenda de esta página para sacar nombres de eventos, casas y temas.
                </p>
              </div>
              <InlineError>{formError}</InlineError>
              <button type="submit" className="btn btn-rojo w-full text-lg sm:w-auto">
                <Wand2 className="h-5 w-5" aria-hidden="true" />
                Generar baraja
              </button>
            </form>
          </section>
        )}

        {writing && (
          <section className="mt-10" aria-live="polite">
            <div className="flex flex-wrap items-center gap-4">
              <Spinner />
              <div>
                <h1 className="text-3xl leading-tight">Escribiendo las cartas…</h1>
                <p className="font-verse text-tinta/70">Leyendo la agenda y rimando los versos. No cierres esta pestaña.</p>
              </div>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {Array.from({ length: 16 }, (_, i) => (
                <CardBack key={i} className="opacity-90" />
              ))}
            </div>
          </section>
        )}

        {deckId && loading && !deck && (
          <div className="grid place-items-center py-24">
            <Spinner />
          </div>
        )}

        {deckId && notFound && (
          <section className="mx-auto mt-16 max-w-lg text-center">
            <h1 className="text-3xl">Baraja no encontrada</h1>
            <p className="mt-3 font-verse">Puede que el enlace esté incompleto.</p>
            <button type="button" className="btn btn-oro mt-6" onClick={() => setParams({})}>
              Generar una nueva
            </button>
          </section>
        )}

        {deckId && loadError && <InlineError className="mt-6" onRetry={() => loadDeck(deckId)}>{loadError}</InlineError>}
        {deckId && formError && !writing && <InlineError className="mt-6">{formError}</InlineError>}

        {deck && (
          <section className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="min-w-0">
                <h1 className="text-[clamp(2rem,5vw,3.5rem)] leading-none break-words">{deck.theme || "Baraja"}</h1>
                <p className="mt-3 font-verse text-tinta/80">
                  {STATUS_LABEL[deck.status] ?? deck.status}
                  {deck.source_url ? `, inspirada en ${deck.source_url.replace(/^https?:\/\//, "")}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {missing.length > 0 && !poolRunning && cards.length > 0 && (
                  <button type="button" className="btn btn-oro" onClick={() => fillAssets(missing.map((c) => c.id))}>
                    <Wand2 className="h-5 w-5" aria-hidden="true" />
                    Completar faltantes ({missing.length})
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-rojo text-lg"
                  disabled={!ready || creating}
                  onClick={onCreateGame}
                  title={ready ? "Crear un juego con esta baraja" : "Disponible cuando existan las 16 cartas"}
                >
                  {creating ? "Creando…" : "Crear juego"}
                </button>
              </div>
            </div>
            {ready && missing.length > 0 && deck.status !== "ready" && (
              <p className="mt-3 font-verse text-sm text-rojo">
                {missing.length === 1
                  ? "1 carta no tiene imagen o audio. Se mostrará con marcador y el gritón la canta en voz alta."
                  : `${missing.length} cartas no tienen imagen o audio. Se mostrarán con marcador y el gritón las canta en voz alta.`}
              </p>
            )}

            <ProgressBar
              className="mt-6 max-w-3xl"
              value={deck.progress ?? 0}
              max={deck.card_count ?? 16}
              label={
                ready
                  ? "Baraja lista para jugar"
                  : poolRunning
                    ? "Ilustrando y grabando cartas…"
                    : deck.status === "error"
                      ? "La generación se detuvo"
                      : "Cartas con imagen y audio"
              }
            />

            {deck.status === "error" && deck.error && <InlineError className="mt-6">{deck.error}</InlineError>}
            <InlineError className="mt-6">{gameError}</InlineError>

            <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4">
              {cards.map((card, i) => {
                const src = cardAudioSrc(card);
                const isBusy = busy.has(card.id);
                const err = cardErrors[card.id] || card.asset_error;
                const incomplete = !cardHasAssets(card);
                return (
                  <article key={card.id} className="card-deal flex flex-col" style={{ animationDelay: `${i * 40}ms` }}>
                    <LoteriaCard
                      card={card}
                      onPlay={src ? playCard : undefined}
                      playing={audio.playing && audio.currentSrc === src && !!src}
                    >
                      {isBusy && (
                        <div className="absolute inset-0 z-30 grid place-items-center bg-crema/70 rounded-[2px]">
                          <Spinner className="scale-75" />
                        </div>
                      )}
                    </LoteriaCard>
                    {card.verse && (
                      <p className="mt-3 whitespace-pre-line font-verse text-sm italic leading-snug text-tinta/85">
                        {card.verse}
                      </p>
                    )}
                    {!isBusy && (err || (incomplete && !poolRunning)) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="flex-1 font-verse text-xs text-rojo">
                          {err || (card.image_url ? "Falta el audio" : "Falta la imagen")}
                        </span>
                        <button
                          type="button"
                          className="btn btn-crema btn-sm"
                          disabled={poolRunning}
                          onClick={() => fillAssets([card.id], true)}
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                          Reintentar
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
