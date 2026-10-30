import { Link } from "react-router-dom";
import LoteriaCard from "@/components/LoteriaCard";

/**
 * Friendly dead end. Used for unknown routes and for unknown game codes
 * (`title="Juego no encontrado"`).
 */
export default function NotFound({
  title = "Esta página no existe",
  message = "Revisa la dirección o vuelve al inicio para abrir una baraja o un juego.",
  dark = false,
}) {
  return (
    <main
      className={`grid min-h-[100dvh] place-items-center px-6 py-12 ${
        dark ? "bg-tinta text-crema" : "paper-grain bg-crema text-tinta"
      }`}
    >
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="w-36 -rotate-6">
          <LoteriaCard card={{ number: 0, name: "El perdido" }} compact />
        </div>
        <h1 className="mt-8 text-4xl leading-tight">{title}</h1>
        <p className="mt-3 font-verse text-lg opacity-80">{message}</p>
        <Link to="/" className="btn btn-oro mt-8">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
