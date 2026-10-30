import { useEffect, useRef } from "react";

/**
 * Call `fn` every `intervalMs` while `enabled`. Calls never overlap (the next tick is
 * scheduled after the previous one settles), polling pauses while the tab is hidden
 * and resumes with an immediate call when it becomes visible again. Errors from `fn`
 * are swallowed here: `fn` should store them in state if the UI needs them.
 */
export function usePolling(fn, intervalMs, { enabled = true, immediate = false } = {}) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;
    let stopped = false;
    let timer = null;
    let running = false;

    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.hidden) return;
      timer = setTimeout(tick, intervalMs);
    };

    async function tick() {
      if (stopped || running || document.hidden) return;
      running = true;
      try {
        await fnRef.current?.();
      } catch {
        // handled by the caller
      } finally {
        running = false;
        schedule();
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
      } else {
        tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (immediate) tick();
    else schedule();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, immediate]);
}
