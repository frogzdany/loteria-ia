import { Link } from "react-router-dom";

/** Centered full-screen state: loading, error or empty. Never a blank page. */
export default function StatusScreen({ title, message, dark = false, loading = false, children, homeLink = true }) {
  return (
    <main
      className={`grid min-h-[100dvh] place-items-center px-6 py-12 ${dark ? "bg-tinta text-crema" : "bg-crema text-tinta"}`}
    >
      <div className="flex max-w-md flex-col items-center text-center">
        {loading && <Spinner />}
        {title && <h1 className="mt-6 text-3xl leading-tight sm:text-4xl">{title}</h1>}
        {message && <p className="mt-3 font-verse text-lg opacity-80">{message}</p>}
        {children && <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div>}
        {homeLink && !loading && (
          <Link to="/" className={`mt-6 font-verse underline underline-offset-4 ${dark ? "text-oro" : "text-azul"}`}>
            Ir al inicio
          </Link>
        )}
      </div>
    </main>
  );
}

/** Four colored tiles turning over, like cards being dealt. */
export function Spinner({ className = "" }) {
  return (
    <div className={`flex gap-2 ${className}`} role="status" aria-label="Cargando">
      {["bg-rojo", "bg-oro", "bg-azul", "bg-verde"].map((c, i) => (
        <span
          key={c}
          className={`h-10 w-7 border-[3px] border-tinta ${c} animate-bounce rounded-[3px]`}
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}

export function InlineError({ children, onRetry, className = "" }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center gap-3 border-[3px] border-tinta bg-rojo px-4 py-3 font-verse text-crema rounded-[4px] ${className}`}
    >
      <span className="flex-1">{children}</span>
      {onRetry && (
        <button type="button" className="btn btn-crema btn-sm" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}
