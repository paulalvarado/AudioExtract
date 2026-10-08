import { useCallback, useEffect, useState } from "react";
import {
  libraryChooseDir,
  libraryDelete,
  libraryList,
  libraryRename,
  libraryResetDir,
  toAppError,
} from "../lib/tauri";
import type { AppError, LibraryItem, LibraryListing, MixState } from "../types";

const byNewest = (a: LibraryItem, b: LibraryItem) => b.createdAt - a.createdAt;

/** La biblioteca de extracciones: se recarga al volver a la ventana (por si se movieron carpetas a mano). */
export function useLibrary() {
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const reload = useCallback(async () => {
    try {
      setListing(await libraryList());
      setError(null);
    } catch (raw) {
      setError(toAppError(raw));
    }
  }, []);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const upsert = useCallback((item: LibraryItem) => {
    setListing((current) =>
      current && {
        ...current,
        items: [item, ...current.items.filter((existing) => existing.id !== item.id)].sort(byNewest),
      },
    );
  }, []);

  const rename = useCallback(
    async (id: string, title: string) => {
      const item = await libraryRename(id, title);
      upsert(item);
      return item;
    },
    [upsert],
  );

  const remove = useCallback(async (id: string, permanent = false) => {
    await libraryDelete(id, permanent);
    setListing((current) => current && { ...current, items: current.items.filter((item) => item.id !== id) });
  }, []);

  /** Refleja una mezcla guardada sin recargar la biblioteca. */
  const setMix = useCallback((id: string, mix: MixState) => {
    setListing(
      (current) =>
        current && { ...current, items: current.items.map((item) => (item.id === id ? { ...item, mix } : item)) },
    );
  }, []);

  const chooseDir = useCallback(async () => {
    const next = await libraryChooseDir();
    if (next) setListing(next);
    return next !== null;
  }, []);

  const resetDir = useCallback(async () => {
    setListing(await libraryResetDir());
  }, []);

  return { listing, error, reload, upsert, rename, remove, setMix, chooseDir, resetDir };
}
