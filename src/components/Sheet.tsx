import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";

interface SheetProps {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Panel lateral derecho para tareas secundarias (ajustes, exportar). No bloquea
 * la app: el reproductor sigue respondiendo detrás. Esc cierra.
 */
export function Sheet({ title, subtitle, onClose, children, footer }: SheetProps) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-label={title}
      className="sheet-enter fixed top-12 right-0 bottom-0 z-40 flex w-[400px] max-w-full flex-col border-l border-line bg-panel outline-none"
    >
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
          {subtitle && <div className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="-mt-1 -mr-2 flex size-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-raised hover:text-ink"
        >
          <CloseIcon width={16} height={16} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      {footer && <footer className="border-t border-line px-5 py-4">{footer}</footer>}
    </aside>
  );
}

/** Sección con título dentro de un panel lateral. */
export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7 last:mb-0">
      <h3 className="mb-3 text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}
