/** Cuatro barras como las del icono de la app; se mueven solo mientras suena. */
export function EqualizerBars({ playing, className = "" }: { playing: boolean; className?: string }) {
  const heights = [0.6, 1, 0.8, 0.45];
  return (
    <span className={`flex h-3.5 items-end gap-[2px] ${className}`} aria-hidden>
      {heights.map((height, index) => (
        <span
          key={index}
          className={`w-[3px] rounded-full bg-accent ${playing ? "eq-bar" : ""}`}
          style={{ height: `${height * 100}%` }}
        />
      ))}
    </span>
  );
}
