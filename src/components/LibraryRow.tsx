import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { deviceLabel, formatBytes, formatDate, formatFullDate, formatTime } from "../lib/format";
import { STEM_LABELS, STEM_ORDER, type LibraryItem } from "../types";
import { EqualizerBars } from "./EqualizerBars";
import { ExportIcon, FolderIcon, PauseIcon, PencilIcon, PlayIcon, TrashIcon } from "./icons";
import { stemStyle } from "./NewExtraction";

export const ROW_GRID = "grid-cols-[40px_minmax(0,1fr)_112px_60px_108px_132px]";

interface LibraryRowProps {
  item: LibraryItem;
  current: boolean;
  playing: boolean;
  loading: boolean;
  onPlay: () => void;
  onOpenMixer: () => void;
  onExport: () => void;
  onReveal: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: (permanent: boolean) => Promise<void>;
}

export function LibraryRow({
  item,
  current,
  playing,
  loading,
  onPlay,
  onOpenMixer,
  onExport,
  onReveal,
  onRename,
  onDelete,
}: LibraryRowProps) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const quality = item.quality === "best" ? "Máxima" : "Rápida";

  return (
    <li
      className={`group grid h-14 items-center gap-x-3 px-2 transition-colors duration-100 ${ROW_GRID} ${
        current ? "bg-raised/70" : "hover:bg-raised/35"
      }`}
      onDoubleClick={mode === "view" ? onOpenMixer : undefined}
    >
      <button
        type="button"
        onClick={onPlay}
        tabIndex={-1}
        aria-hidden
        className="flex size-8 items-center justify-center justify-self-center rounded-full text-ink-2 transition-colors hover:bg-line hover:text-ink"
      >
        {current && loading ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-ink-4 border-t-accent" />
        ) : current ? (
          <>
            <EqualizerBars playing={playing} className="group-hover:hidden" />
            {playing ? (
              <PauseIcon width={14} height={14} className="hidden group-hover:block" />
            ) : (
              <PlayIcon width={14} height={14} className="hidden translate-x-px group-hover:block" />
            )}
          </>
        ) : (
          <PlayIcon width={14} height={14} className="translate-x-px opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </button>

      <div className="min-w-0">
        {mode === "rename" ? (
          <RenameField
            initial={item.title}
            onCancel={() => setMode("view")}
            onSubmit={async (title) => {
              await onRename(title);
              setMode("view");
            }}
          />
        ) : (
          <button
            type="button"
            data-row-title
            onClick={onPlay}
            aria-label={`${current && playing ? "Pausar" : "Escuchar"} ${item.title}`}
            className="block max-w-full truncate rounded text-left text-[13.5px] font-medium text-ink"
            title={item.title}
          >
            {item.title}
          </button>
        )}
        <p className="mt-0.5 truncate text-xs text-ink-3" title={`${item.sourceName} · ${formatBytes(item.sizeBytes)}`}>
          {item.missing.length > 0 ? (
            <span className="text-warning">
              Faltan en el disco: {item.missing.map((id) => STEM_LABELS[id]).join(", ")}
            </span>
          ) : (
            <>
              {quality} · {deviceLabel(item.device)} · {item.sourceName}
            </>
          )}
        </p>
      </div>

      {mode === "delete" ? (
        <DeleteConfirm
          error={deleteError}
          onCancel={() => {
            setMode("view");
            setDeleteError(null);
          }}
          onConfirm={async (permanent) => {
            try {
              await onDelete(permanent);
            } catch (error) {
              setDeleteError(error && typeof error === "object" && "message" in error ? String(error.message) : String(error));
            }
          }}
        />
      ) : (
        <>
          <StemStrip item={item} />
          <span className="text-right text-[13px] text-ink-2 tabular-nums">{formatTime(item.durationSec)}</span>
          <span className="truncate pl-5 text-xs text-ink-3" title={formatFullDate(item.createdAt)}>
            {formatDate(item.createdAt)}
          </span>
          <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <RowAction label="Exportar" onClick={onExport}>
              <ExportIcon width={15} height={15} />
            </RowAction>
            <RowAction label="Mostrar en la carpeta" onClick={onReveal}>
              <FolderIcon width={15} height={15} />
            </RowAction>
            <RowAction label="Renombrar" onClick={() => setMode("rename")}>
              <PencilIcon width={15} height={15} />
            </RowAction>
            <RowAction label="Eliminar" onClick={() => setMode("delete")} danger>
              <TrashIcon width={15} height={15} />
            </RowAction>
          </div>
        </>
      )}
    </li>
  );
}

/** Siete ranuras fijas, una por instrumento: se ve de un vistazo qué canciones tienen piano o viento. */
function StemStrip({ item }: { item: LibraryItem }) {
  const present = new Set(item.stems);
  return (
    <span
      className="flex items-center gap-1.5"
      role="img"
      aria-label={`Instrumentos: ${item.stems.map((id) => STEM_LABELS[id]).join(", ")}`}
    >
      {STEM_ORDER.map((id) =>
        present.has(id) ? (
          <span
            key={id}
            title={STEM_LABELS[id]}
            style={stemStyle(id)}
            className={`size-2.5 rounded-full bg-(--stem) ${item.missing.includes(id) ? "opacity-30" : ""}`}
          />
        ) : (
          <span key={id} title={`${STEM_LABELS[id]}: no separado`} className="size-2.5 rounded-full border border-ink-4/60" />
        ),
      )}
    </span>
  );
}

function RowAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={`flex size-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-line ${
        danger ? "hover:text-danger" : "hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function RenameField({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (title: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Intro envía y desmonta el campo, y ese desmontaje dispara `blur`: solo cuenta el primero.
  const settled = useRef(false);
  useEffect(() => input.current?.select(), []);

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (settled.current) return;
    settled.current = true;
    const title = value.trim();
    if (!title || title === initial) return onCancel();
    setSaving(true);
    try {
      await onSubmit(title);
    } catch {
      settled.current = false;
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        ref={input}
        value={value}
        disabled={saving}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          settled.current = true;
          onCancel();
        }}
        onBlur={(event) => void submit(event)}
        aria-label="Nuevo título"
        maxLength={200}
        className="h-7 w-full min-w-0 rounded-md border border-accent/60 bg-surface px-2 text-[13.5px] text-ink outline-none select-text"
      />
    </form>
  );
}

function DeleteConfirm({
  error,
  onConfirm,
  onCancel,
}: {
  error: string | null;
  onConfirm: (permanent: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (permanent: boolean) => {
    setBusy(true);
    await onConfirm(permanent);
    setBusy(false);
  };
  return (
    <div className="col-span-4 flex min-w-0 items-center justify-end gap-2" role="alertdialog" aria-label="Confirmar eliminación">
      <p className={`min-w-0 truncate text-xs ${error ? "text-danger" : "text-ink-2"}`} title={error ?? undefined}>
        {error ? `No se pudo mover a la papelera: ${error}` : "¿Eliminar con todas sus pistas?"}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(error !== null)}
        className="shrink-0 rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-surface transition-[filter] hover:brightness-110 disabled:opacity-60"
      >
        {error ? "Eliminar definitivamente" : "Mover a la papelera"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        className="shrink-0 rounded-lg px-3 py-1.5 text-xs text-ink-2 transition-colors hover:bg-line hover:text-ink"
      >
        Cancelar
      </button>
    </div>
  );
}
