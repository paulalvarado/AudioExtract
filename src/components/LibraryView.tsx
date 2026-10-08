import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import { formatBytes } from "../lib/format";
import type { AppError, LibraryItem, LibraryListing } from "../types";
import { FolderIcon, RefreshIcon } from "./icons";
import { LibraryRow, ROW_GRID } from "./LibraryRow";

interface LibraryViewProps {
  listing: LibraryListing | null;
  error: AppError | null;
  search: string;
  onClearSearch: () => void;
  currentId: string | null;
  playing: boolean;
  loadingCurrent: boolean;
  /** Panel de nueva extracción, encima de la tabla. */
  header: ReactNode;
  /** Separación en curso: primera fila de la tabla. */
  job: ReactNode;
  onPlay: (item: LibraryItem) => void;
  onOpenMixer: (item: LibraryItem) => void;
  onExport: (item: LibraryItem) => void;
  onReveal: (item: LibraryItem) => void;
  onRename: (item: LibraryItem, title: string) => Promise<void>;
  onDelete: (item: LibraryItem, permanent: boolean) => Promise<void>;
  onOpenFolder: () => void;
  onRetry: () => void;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function LibraryView(props: LibraryViewProps) {
  const { listing, error, search, currentId, header, job } = props;
  const items = useMemo(() => {
    const all = listing?.items ?? [];
    const query = normalize(search.trim());
    if (!query) return all;
    return all.filter((item) => normalize(`${item.title} ${item.sourceName}`).includes(query));
  }, [listing, search]);

  const totalBytes = listing?.items.reduce((sum, item) => sum + item.sizeBytes, 0) ?? 0;

  // Flechas arriba/abajo recorren las filas; Intro reproduce.
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const titles = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-row-title]"));
    const index = titles.findIndex((element) => element === document.activeElement);
    const next = titles[index + (event.key === "ArrowDown" ? 1 : -1)] ?? titles[event.key === "ArrowDown" ? 0 : titles.length - 1];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-4 pb-3">
      {header}

      {error && !listing ? (
        <div role="alert" className="rounded-2xl border border-danger/30 bg-panel px-5 py-4">
          <p className="text-sm font-semibold text-ink">No se pudo leer la biblioteca</p>
          <p className="mt-1 text-[13px] text-ink-2 select-text">{error.message}</p>
          <button
            type="button"
            onClick={props.onRetry}
            className="mt-3 flex items-center gap-2 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-line"
          >
            <RefreshIcon width={14} height={14} />
            Reintentar
          </button>
        </div>
      ) : (
        <section aria-label="Biblioteca" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
          {(listing?.items.length !== 0 || job) && (
            <div className={`grid shrink-0 items-center gap-x-3 border-b border-line px-2 py-2 text-[11px] font-medium text-ink-3 ${ROW_GRID}`}>
              <span />
              <span>Título</span>
              <span>Instrumentos</span>
              <span className="text-right">Duración</span>
              <span className="pl-5">Añadida</span>
              <span />
            </div>
          )}

          {listing === null ? (
            <Skeleton />
          ) : items.length === 0 && !job ? (
            <Empty search={search} hasItems={listing.items.length > 0} onClearSearch={props.onClearSearch} dir={listing.dir} />
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line/70 overflow-y-auto" onKeyDown={onKeyDown}>
              {job}
              {items.map((item) => (
                <LibraryRow
                  key={item.id}
                  item={item}
                  current={item.id === currentId}
                  playing={item.id === currentId && props.playing}
                  loading={item.id === currentId && props.loadingCurrent}
                  onPlay={() => props.onPlay(item)}
                  onOpenMixer={() => props.onOpenMixer(item)}
                  onExport={() => props.onExport(item)}
                  onReveal={() => props.onReveal(item)}
                  onRename={(title) => props.onRename(item, title)}
                  onDelete={(permanent) => props.onDelete(item, permanent)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {listing && (
        <footer className="flex shrink-0 items-center gap-2 px-1 text-xs text-ink-3">
          <span>
            {listing.items.length === 1 ? "1 extracción" : `${listing.items.length} extracciones`}
            {listing.items.length > 0 && ` · ${formatBytes(totalBytes)}`}
          </span>
          <button
            type="button"
            onClick={props.onOpenFolder}
            title="Abrir la carpeta de la biblioteca"
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-raised hover:text-ink-2"
          >
            <FolderIcon width={13} height={13} className="shrink-0" />
            <span className="truncate">{listing.dir}</span>
          </button>
        </footer>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex-1" aria-busy aria-label="Cargando la biblioteca">
      {[0.6, 0.45, 0.7].map((width, index) => (
        <div key={index} className={`grid h-14 items-center gap-x-3 border-b border-line/70 px-2 ${ROW_GRID}`}>
          <span />
          <span className="flex flex-col gap-1.5">
            <span className="h-3 animate-pulse rounded bg-raised" style={{ width: `${width * 100}%` }} />
            <span className="h-2.5 w-1/3 animate-pulse rounded bg-raised/70" />
          </span>
          <span className="h-2.5 w-20 animate-pulse rounded bg-raised/70" />
        </div>
      ))}
    </div>
  );
}

function Empty({ search, hasItems, onClearSearch, dir }: { search: string; hasItems: boolean; onClearSearch: () => void; dir: string }) {
  if (hasItems) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-ink-2">Ninguna extracción coincide con «{search.trim()}».</p>
        <button type="button" onClick={onClearSearch} className="rounded-lg px-3 py-1.5 text-[13px] text-accent transition-colors hover:bg-raised">
          Borrar la búsqueda
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-ink">Aquí aparecerán tus canciones separadas</p>
      <p className="max-w-md text-[13px] leading-relaxed text-ink-3">
        Cada extracción se guarda con sus pistas y tu mezcla en <span className="text-ink-2 select-text">{dir}</span>, así
        puedes volver a ella, retocarla o exportarla sin separarla otra vez.
      </p>
    </div>
  );
}
