import { useCallback, useEffect, useRef, useState } from "react";
import { MultitrackEngine } from "../lib/audio-engine";
import { STEM_SAMPLE_RATE } from "../lib/export";
import { librarySaveMix, toAppError } from "../lib/tauri";
import type { LibraryItem, MixState } from "../types";

export type PlayerState =
  | { status: "empty" }
  | { status: "loading"; itemId: string }
  | { status: "ready"; itemId: string; engine: MultitrackEngine }
  | { status: "error"; itemId: string; message: string };

const SAVE_DELAY_MS = 600;

/**
 * Carga una extracción en el motor de audio, restaura su mezcla y guarda los
 * cambios de la mezcla en la biblioteca (con un pequeño retardo, no en cada
 * movimiento de fader).
 */
export function usePlayer(onMixSaved: (id: string, mix: MixState) => void) {
  const [state, setState] = useState<PlayerState>({ status: "empty" });
  const engineRef = useRef<MultitrackEngine | null>(null);
  const loadAbort = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const onMixSavedRef = useRef(onMixSaved);
  useEffect(() => {
    onMixSavedRef.current = onMixSaved;
  });

  const release = useCallback(() => {
    loadAbort.current?.abort();
    loadAbort.current = null;
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  const load = useCallback(
    async (item: LibraryItem, autoplay: boolean) => {
      const id = ++runId.current;
      release();
      setState({ status: "loading", itemId: item.id });

      const files = item.files.filter((file) => !item.missing.includes(file.id));
      if (files.length === 0) {
        setState({ status: "error", itemId: item.id, message: "No queda ninguna pista de esta extracción en el disco." });
        return;
      }

      const abort = new AbortController();
      loadAbort.current = abort;
      try {
        const engine = await MultitrackEngine.load(files, STEM_SAMPLE_RATE, abort.signal);
        if (runId.current !== id) {
          engine.dispose();
          return;
        }
        engine.applyMix(item.mix);
        engineRef.current = engine;
        setState({ status: "ready", itemId: item.id, engine });
        if (autoplay) engine.play();
      } catch (raw) {
        if (runId.current !== id || abort.signal.aborted) return;
        setState({ status: "error", itemId: item.id, message: toAppError(raw).message });
      }
    },
    [release],
  );

  const unload = useCallback(() => {
    runId.current++;
    release();
    setState({ status: "empty" });
  }, [release]);

  // Guarda la mezcla cuando cambia (el transporte también notifica, pero no altera el JSON).
  useEffect(() => {
    if (state.status !== "ready") return;
    const { engine, itemId } = state;
    let saved = JSON.stringify(engine.mixState());
    let timer: number | undefined;
    const persist = () => {
      const mix = engine.mixState();
      const json = JSON.stringify(mix);
      if (json === saved) return;
      saved = json;
      onMixSavedRef.current(itemId, mix);
      librarySaveMix(itemId, mix).catch((error: unknown) => console.warn("No se pudo guardar la mezcla:", error));
    };
    const unsubscribe = engine.subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(persist, SAVE_DELAY_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      persist();
    };
  }, [state]);

  useEffect(() => release, [release]);

  return { player: state, load, unload };
}
