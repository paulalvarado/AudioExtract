export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export function formatDb(db: number): string {
  if (!Number.isFinite(db)) return "−∞";
  const rounded = Math.round(db * 10) / 10;
  if (rounded === 0) return "0.0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)}`;
}

/** «+2», «−5», «0» con el signo menos tipográfico. */
export function formatSemitones(semitones: number): string {
  if (semitones === 0) return "0";
  return `${semitones > 0 ? "+" : "−"}${Math.abs(semitones)}`;
}

export function describeSemitones(semitones: number): string {
  if (semitones === 0) return "tono original";
  const amount = Math.abs(semitones);
  return `${semitones > 0 ? "sube" : "baja"} ${amount} ${amount === 1 ? "semitono" : "semitonos"}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
}

const dayFormat = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });
const yearFormat = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
const fullFormat = new Intl.DateTimeFormat("es", { dateStyle: "full", timeStyle: "short" });

/** «hoy, 18:30», «ayer, 09:05», «12 sept.», «3 mar. 2025». */
export function formatDate(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (timestamp >= startOfToday) return `hoy, ${timeFormat.format(date)}`;
  if (timestamp >= startOfToday - 86_400_000) return `ayer, ${timeFormat.format(date)}`;
  return date.getFullYear() === today.getFullYear() ? dayFormat.format(date) : yearFormat.format(date);
}

export function formatFullDate(timestamp: number): string {
  return fullFormat.format(new Date(timestamp));
}

const DEVICE_LABELS: Record<string, string> = {
  cuda: "CUDA",
  mps: "Metal",
  cpu: "CPU",
};

export function deviceLabel(device: string | null): string {
  if (!device) return "Detectando…";
  const kind = device.split(":")[0];
  return DEVICE_LABELS[kind] ?? device.toUpperCase();
}

export function isGpu(device: string | null): boolean {
  return device !== null && !device.startsWith("cpu");
}

/** «80 %», «100 %»: tempo en porcentaje de la velocidad original. */
export function formatTempo(percent: number): string {
  return `${percent} %`;
}

export function describeTempo(percent: number): string {
  if (percent === 100) return "velocidad original";
  return `${percent} % de la velocidad original`;
}
