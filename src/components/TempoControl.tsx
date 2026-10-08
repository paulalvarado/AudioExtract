import { describeTempo, formatTempo } from "../lib/format";
import { MAX_TEMPO, MIN_TEMPO, ORIGINAL_TEMPO, TEMPO_STEP } from "../lib/pitch";
import { Stepper } from "./Stepper";

interface TempoControlProps {
  /** Porcentaje de la velocidad original. */
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  disabledReason?: string;
  size?: "sm" | "md";
}

/** Tempo global (50–150 %): flechas ±5 %, RePág/AvPág ±25 % y doble clic (o 0) para la velocidad original. */
export function TempoControl({ value, onChange, disabled, disabledReason, size }: TempoControlProps) {
  return (
    <Stepper
      value={value}
      onChange={onChange}
      min={MIN_TEMPO}
      max={MAX_TEMPO}
      step={TEMPO_STEP}
      pageStep={TEMPO_STEP * 5}
      neutral={ORIGINAL_TEMPO}
      format={formatTempo}
      describe={describeTempo}
      name="Tempo de toda la canción"
      decreaseLabel={`Más lento (−${TEMPO_STEP} %)`}
      increaseLabel={`Más rápido (+${TEMPO_STEP} %)`}
      hint={`Tempo: ${describeTempo(value)}, sin cambiar el tono. Doble clic: velocidad original`}
      disabled={disabled}
      disabledReason={disabledReason}
      size={size}
      valueWidth="min-w-[5.5ch]"
    />
  );
}
