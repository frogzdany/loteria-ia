import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Github } from "lucide-react";
import { base44 } from "@/api/base44Client";
import LoteriaCard from "@/components/LoteriaCard";
import PapelPicado from "@/components/PapelPicado";
import { InlineError, Spinner } from "@/components/StatusScreen";
import { errorMessage } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/games";

const { Deck, Game } = base44.entities;

const HERO_CARDS = [
  { number: 1, name: "El gritón", rot: "-rotate-[9deg]", pos: "left-0 top-6" },
  { number: 2, name: "La tabla", rot: "rotate-[2deg]", pos: "left-[28%] top-0 z-10" },
  { number: 3, name: "El frijol", rot: "rotate-[11deg]", pos: "left-[56%] top-8" },
];

const STATUS_TONE = {
  ready: "bg-verde text-crema",
  generating: "bg-oro text-tinta",
  error: "bg-rojo text-crema",
  lobby: "bg-azul text-crema",
  playing: "bg-oro text-tinta",
  finished: "bg-tinta text-crema",
};

function StatusChip({ status }) {
  return (
    <span
      className={`inline-block border-2 border-tinta px-2 py-0.5 font-verse text-xs font-semibold rounded-[3px] ${
        STATUS_TONE[status] ?? "bg-white"
      }`}
    >
      {STATUS_LABEL[status] ?? status ?? "Sin estado"}
    </span>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [decks, setDecks] = useState(null);
  const [games, setGames] = useState(null);
  const [error, setError] = useState(null);
  const [code, setCode] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, g] = await Promise.all([Deck.list("-created_date", 12), Game.list("-created_date", 12)]);
      setDecks(d ?? []);
      setGames(g ?? []);
    } catch (err) {
      setError(errorMessage(err));
      setDecks((x) => x ?? []);
      setGames((x) => x ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const join = (e) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) navigate(`/tabla/${encodeURIComponent(c)}`);
  };

  return (
    <div className="paper-grain min-h-[100dvh] bg-crema">
      <PapelPicado />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-8">
        <section className="grid items-center gap-10 md:grid-cols-[1.25fr_1fr]">
          <div>
            <h1 className="text-[clamp(3rem,9vw,6.5rem)] leading-[0.9] text-rojo text-shadow-ink">
              Lotería
              <br />
              <span className="text-azul">Tech Week</span>
            </h1>
            <p className="mt-6 max-w-[52ch] font-verse text-lg leading-relaxed sm:text-xl">
              Una lotería mexicana escrita e ilustrada con IA a partir de la agenda de Mexico Tech Week. El gritón
              canta las cartas desde la pantalla y el público juega desde su celular.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link to="/generar" className="btn btn-rojo text-lg">
                Generar baraja
              </Link>
              <form onSubmit={join} className="flex items-stretch gap-2">
                <label htmlFor="join-code" className="sr-only">
                  Código del juego
                </label>
                <input
                  id="join-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="Código"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={10}
                  className="field w-36 py-2 font-display uppercase tracking-wider"
                />
                <button type="submit" className="btn btn-oro" disabled={!code.trim()}>
                  Jugar
                </button>
              </form>
            </div>
          </div>
          <div className="relative mx-auto hidden h-80 w-full max-w-md sm:block" aria-hidden="true">
            {HERO_CARDS.map((c) => (
              <div key={c.number} className={`absolute w-[44%] ${c.pos} ${c.rot} shadow-print-lg`}>
                <LoteriaCard card={c} />
              </div>
            ))}
          </div>
        </section>

        {error && <InlineError className="mt-10" onRetry={load}>{`No se pudo cargar la lista: ${error}`}</InlineError>}

        <section className="mt-16 grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl">Barajas recientes</h2>
            <div className="mt-4 border-4 border-tinta bg-white rounded-[6px] shadow-print">
              {decks === null ? (
                <div className="grid place-items-center py-10">
                  <Spinner />
                </div>
              ) : decks.length === 0 ? (
                <p className="px-5 py-8 font-verse">
                  Todavía no hay barajas.{" "}
                  <Link to="/generar" className="text-azul underline underline-offset-4">
                    Genera la primera
                  </Link>
                  .
                </p>
              ) : (
                <ul className="divide-y-2 divide-tinta/15">
                  {decks.map((d) => (
                    <li key={d.id} className="flex items-center gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-lg leading-tight">{d.theme || "Sin tema"}</p>
                        <div className="mt-1 flex items-center gap-3">
                          <StatusChip status={d.status} />
                          <span className="font-verse text-sm text-tinta/70 tabular-nums">
                            {d.progress ?? 0}/{d.card_count ?? 16} cartas listas
                          </span>
                        </div>
                      </div>
                      <Link to={`/generar?deck=${d.id}`} className="btn btn-crema btn-sm">
                        Abrir
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <h2 className="text-2xl">Juegos recientes</h2>
            <div className="mt-4 border-4 border-tinta bg-white rounded-[6px] shadow-print">
              {games === null ? (
                <div className="grid place-items-center py-10">
                  <Spinner />
                </div>
              ) : games.length === 0 ? (
                <p className="px-5 py-8 font-verse">
                  Aún no hay juegos. Abre una baraja lista y crea uno desde ahí.
                </p>
              ) : (
                <ul className="divide-y-2 divide-tinta/15">
                  {games.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-xl tracking-wider">{g.code}</p>
                        <div className="mt-1 flex items-center gap-3">
                          <StatusChip status={g.status} />
                          <span className="font-verse text-sm text-tinta/70">
                            {g.winner_name
                              ? `Ganó ${g.winner_name}`
                              : `${g.called_card_ids?.length ?? 0} cartas cantadas`}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Link to={`/griton/${g.code}`} className="btn btn-azul btn-sm">
                          Gritón
                        </Link>
                        <Link to={`/tabla/${g.code}`} className="btn btn-oro btn-sm">
                          Tabla
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <footer className="mt-16 flex flex-col items-center gap-3 text-center font-verse text-tinta/80">
          <p>Hecha con Base44, Firecrawl y ElevenLabs.</p>
          <a
            href="https://github.com/frogzdany/loteria-ia"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-crema btn-sm inline-flex items-center gap-2"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            Ver el código en GitHub
          </a>
        </footer>
      </main>
    </div>
  );
}
