import type { KeyboardEvent } from "react";
import { MinusIcon, PlusIcon } from "./icons";

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  /** Paso de los botones y de las flechas. */
  step: number;
  /** Paso de RePág/AvPág. */
  pageStep: number;
  /** Valor original: 0, Supr, Retroceso o doble clic vuelven a él. */
  neutral: number;
  format: (value: number) => string;
  /** Texto para lectores de pantalla («sube 2 semitonos», «80 % de la velocidad original»). */
  describe: (value: number) => string;
  /** Nombre del valor para lectores de pantalla: «Semitonos de Voces». */
  name: string;
  decreaseLabel: string;
  increaseLabel: string;
  /** Ayuda al pasar el puntero. */
  hint: string;
  disabled?: boolean;
  disabledReason?: string;
  size?: "sm" | "md";
  /** Ancho mínimo del valor, para que los botones no se muevan al cambiar de cifra. */
  valueWidth?: string;
}

/**
 * −/valor/+ para subir o bajar un valor por pasos. El valor es un `spinbutton`:
 * flechas para un paso, RePág/AvPág para un salto, Inicio/Fin para los extremos y
 * doble clic (o 0) para el valor original. En acento cuando no es el original.
 */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  pageStep,
  neutral,
  format,
  describe,
  name,
  decreaseLabel,
  increaseLabel,
  hint,
  disabled,
  disabledReason,
  size = "md",
  valueWidth = "min-w-7",
}: StepperProps) {
  const set = (next: number) => {
    const clamped = Math.min(Math.max(next, min), max);
    if (clamped !== value) onChange(clamped);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    const actions: Record<string, () => void> = {
      ArrowUp: () => set(value + step),
      ArrowRight: () => set(value + step),
      ArrowDown: () => set(value - step),
      ArrowLeft: () => set(value - step),
      PageUp: () => set(value + pageStep),
      PageDown: () => set(value - pageStep),
      Home: () => set(min),
      End: () => set(max),
      "0": () => set(neutral),
      Delete: () => set(neutral),
      Backspace: () => set(neutral),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  const changed = value !== neutral;
  const button =
    size === "sm"
      ? "flex size-6 items-center justify-center rounded-md"
      : "flex size-7 items-center justify-center rounded-md";
  const icon = size === "sm" ? 12 : 14;

  return (
    <div
      className={`flex items-center rounded-lg bg-surface/70 ${disabled ? "opacity-45" : ""}`}
      title={disabled ? disabledReason : hint}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => set(value - step)}
        aria-label={decreaseLabel}
        className={`${button} text-ink-3 transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:text-ink-4`}
      >
        <MinusIcon width={icon} height={icon} />
      </button>
      <span
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={name}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={describe(value)}
        aria-disabled={disabled}
        onKeyDown={disabled ? undefined : onKeyDown}
        onDoubleClick={disabled ? undefined : () => set(neutral)}
        className={`${valueWidth} rounded-md px-0.5 text-center font-mono whitespace-nowrap tabular-nums ${
          size === "sm" ? "text-[11px]" : "text-xs"
        } ${changed ? "font-semibold text-accent" : "text-ink-2"}`}
      >
        {format(value)}
      </span>
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => set(value + step)}
        aria-label={increaseLabel}
        className={`${button} text-ink-3 transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:text-ink-4`}
      >
        <PlusIcon width={icon} height={icon} />
      </button>
    </div>
  );
}
