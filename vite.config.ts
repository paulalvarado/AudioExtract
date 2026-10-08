import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri espera un puerto fijo y fallaría si Vite eligiera otro.
const host = process.env.TAURI_DEV_HOST;

/**
 * Corrige signalsmith-stretch 1.3.2. Con más de un búfer cargado, el procesador
 * copia la ventana de entrada con índices erróneos: lanza una excepción dentro del
 * AudioWorklet y se queda mudo. La app le envía cada pista a trozos para no
 * duplicarla en memoria (`StretchLane` en src/lib/stretch.ts), así que lo necesita.
 * Si el paquete cambia, la construcción falla para comprobar si el arreglo sigue
 * haciendo falta.
 */
function signalsmithBuffersFix(): Plugin {
  const bug = [
    "\t\t\t\t\t\taudioSamples += count;",
    "\t\t\t\t\t\tblockSamples += count;",
    "\t\t\t\t\t} else { // we're already past this buffer - skip it",
    "\t\t\t\t\t\taudioSamples += audioBuffer[0].length;",
    "\t\t\t\t\t}",
  ].join("\n");
  const fix = [
    "\t\t\t\t\t\tinputSamples += count;",
    "\t\t\t\t\t\tblockSamples += count;",
    "\t\t\t\t\t}",
    "\t\t\t\t\taudioSamples = bufferEnd;",
  ].join("\n");
  return {
    name: "signalsmith-buffers-fix",
    enforce: "pre",
    transform(code, id) {
      if (!/signalsmith-stretch[\\/]SignalsmithStretch\.m?js(\?|$)/.test(id)) return null;
      const source = code.replace(/\r\n/g, "\n");
      if (source.split(bug).length !== 2) {
        this.error(
          "signalsmith-stretch ha cambiado: comprueba si ya lee bien con varios búferes y quita signalsmithBuffersFix de vite.config.ts.",
        );
      }
      return { code: source.replace(bug, fix), map: null };
    },
  };
}

export default defineConfig({
  plugins: [signalsmithBuffersFix(), react(), tailwindcss()],
  // Sin preempaquetar en desarrollo, para que el arreglo de arriba también se aplique ahí.
  optimizeDeps: { exclude: ["signalsmith-stretch"] },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Evita que Vite recargue al recompilar Rust o al cambiar el script de Python.
      ignored: ["**/src-tauri/**", "**/python/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
