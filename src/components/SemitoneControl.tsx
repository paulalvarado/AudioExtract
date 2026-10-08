import { describeSemitones, formatSemitones } from "../lib/format";
import { MAX_SEMITONES } from "../lib/pitch";
import { Stepper } from "./Stepper";

interface SemitoneControlProps {
  value: number;
  onChange: (value: number) => void;
  /** Nombre de lo que se transpone, para lectores de pantalla: «Voces», «toda la canción». */
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  size?: "sm" | "md";
  /** Ancho mínimo del valor, para alinear con otros controles. */
  valueWidth?: string;
}

/** Semitonos (−12…+12): flechas ±1, RePág/AvPág ±12 y doble clic (o 0) para el tono original. */
export function SemitoneControl({ value, onChange, label, disabled, disabledReason, size, valueWidth }: SemitoneControlProps) {
  return (
    <Stepper
      value={value}
      onChange={onChange}
      min={-MAX_SEMITONES}
      max={MAX_SEMITONES}
      step={1}
      pageStep={12}
      neutral={0}
      format={formatSemitones}
      describe={describeSemitones}
      name={`Semitonos de ${label}`}
      decreaseLabel={`Bajar un semitono (${label})`}
      increaseLabel={`Subir un semitono (${label})`}
      hint={`Tono de ${label}: ${describeSemitones(value)}. Doble clic: tono original`}
      disabled={disabled}
      disabledReason={disabledReason}
      size={size}
      valueWidth={valueWidth}
    />
  );
}
