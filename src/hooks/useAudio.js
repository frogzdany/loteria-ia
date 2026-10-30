import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One shared <audio> element per component. `play(src)` accepts a URL or a
 * `data:audio/mpeg;base64,...` string and resolves to true when playback started,
 * false when it could not (autoplay policy, 404, unsupported source). Never throws.
 */
export function useAudio() {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(null);

  const getAudio = useCallback(() => {
    if (!audioRef.current && typeof Audio !== "undefined") {
      const a = new Audio();
      a.preload = "auto";
      a.addEventListener("ended", () => setPlaying(false));
      a.addEventListener("pause", () => setPlaying(false));
      a.addEventListener("error", () => setPlaying(false));
      a.addEventListener("playing", () => setPlaying(true));
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      try {
        a.currentTime = 0;
      } catch {
        // some sources are not seekable
      }
    }
    setPlaying(false);
  }, []);

  const play = useCallback(
    async (src) => {
      if (!src) return false;
      const a = getAudio();
      if (!a) return false;
      try {
        a.pause();
        a.src = src;
        setCurrentSrc(src);
        await a.play();
        setPlaying(true);
        return true;
      } catch (err) {
        // AbortError happens when a newer play() interrupts this one: not a failure of the source.
        if (err?.name !== "AbortError") console.warn("[audio] no se pudo reproducir", err?.message);
        setPlaying(false);
        return false;
      }
    },
    [getAudio]
  );

  /** Toggle: stop if this src is playing, otherwise play it. */
  const toggle = useCallback(
    (src) => {
      if (playing && currentSrc === src) {
        stop();
        return Promise.resolve(false);
      }
      return play(src);
    },
    [playing, currentSrc, play, stop]
  );

  useEffect(
    () => () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.removeAttribute("src");
        a.load();
      }
      audioRef.current = null;
    },
    []
  );

  return { play, stop, toggle, playing, currentSrc };
}
