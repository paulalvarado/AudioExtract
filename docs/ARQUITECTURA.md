# Arquitectura

```
┌──────────────────────── Ventana (WebView2 / WKWebView) ────────────────────────┐
│  React 19 + TypeScript + Tailwind 4                                            │
│  biblioteca · dock · mezclador · exportación · ajustes                         │
│  MultitrackEngine (Web Audio) ── Signalsmith Stretch (WASM en AudioWorklet)    │
│  exportación: OfflineAudioContext → Worker (WAV / LAME en WASM)                │
└───────────┬───────────────────────────────────────▲────────────────────────────┘
            │ invoke / Channel (progreso)           │ asset: (pistas WAV de la biblioteca)
┌───────────▼───────────────────────────────────────┴────────────────────────────┐
│  Backend Rust (Tauri 2)                                                        │
│  engine.rs    lanza y vigila el motor, traduce su protocolo, detecta problemas │
│  library.rs   biblioteca en disco (una carpeta por extracción + entry.json)    │
│  export.rs    escribe exportaciones solo en destinos elegidos por el usuario   │
│  settings.rs  carpeta de la biblioteca                                         │
│  plugins: dialog, opener, updater, process                                     │
└───────────┬────────────────────────────────────────────────────────────────────┘
            │ docker run --rm --init --pull never --network none [--gpus all]
            │   -v canción:/input:ro -v <biblioteca>/.staging/job-…:/output
            │   -v <app>/python:/opt/audioextract/python:ro   (scripts y ruedas de la app)
┌───────────▼────────────────────────────────────────────────────────────────────┐
│  Motor Python (imagen Docker o entorno local)                                  │
│  separate.py  plan → Demucs / BS-RoFormer → viento (UVR) → guardar pistas      │
│  transcribe.py bass.wav → Basic Pitch (ONNX, CPU) → notas del modo práctica    │
│  catalog.py   modelos disponibles, descarga (--prefetch), disponibilidad       │
│  stdout: una línea JSON por mensaje · stderr: todo lo demás                    │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Scripts del motor: llegan con la app

La imagen del motor aporta el **entorno pesado** (Python, PyTorch con CUDA, Demucs, audio-separator y
los pesos de los modelos) y la app aporta la **lógica**: el instalador lleva `python/separate.py`,
`transcribe.py`, `catalog.py` y `python/wheels/`, las ruedas de Python puro que esos scripts necesitan y
que una imagen anterior puede no tener (hoy, Basic Pitch y sus dependencias, ~6,5 MB).

- Con Docker, la app monta esa carpeta en `/opt/audioextract/python` (solo lectura) y ejecuta
  `--entrypoint python … -u /opt/audioextract/python/<script>` con `AUDIOEXTRACT_WHEELS` apuntando a las
  ruedas. Los scripts que trae la imagen en `/app` solo se usan si la app no encuentra los suyos.
- `catalog.use_bundled_wheels()` descomprime cada rueda una vez en la carpeta temporal y la añade al
  **final** de `sys.path`: lo que ya tiene el entorno siempre gana; las ruedas solo rellenan huecos. Sin
  red y sin escribir en la imagen.
- Con el motor Python local, la app pasa la misma variable `AUDIOEXTRACT_WHEELS`.
- `scripts/vendor-wheels.mjs` descarga las ruedas (versiones y SHA-256 fijos) a `python/wheels/` antes de
  `npm run build`, `npm run dev`, `docker:app` y `docker:test`; Tauri las incluye como recursos.
  `docker:app` falla si el instalador no lleva los scripts y las ruedas.

Consecuencia: **una versión nueva de la app actualiza el motor con solo instalar el `.exe`**, mientras
lo nuevo sea Python (o ruedas de Python puro). Solo un cambio del entorno pesado (otra versión de
PyTorch, modelos nuevos) obliga a reconstruir la imagen, y entonces la app debe encargarse de ello.

## Flujo de una separación

1. La interfaz llama a `separate(inputPath, { instruments, quality }, canal)`.
2. Rust crea una carpeta temporal en `<biblioteca>/.staging/` (mismo disco que la biblioteca) y lanza
   el motor con Docker (o Python), montando la canción en solo lectura y esa carpeta como salida.
3. El motor escribe mensajes en stdout; Rust los reenvía por un `Channel` a la interfaz.
4. Al terminar, Rust comprueba las pistas, lee la duración de la cabecera WAV, escribe `entry.json` y
   **renombra** la carpeta temporal a la biblioteca con un nombre legible y único
   (`Mi canción`, `Mi canción (2)`…). Si algo falla o se cancela, la carpeta temporal se borra.
5. Al arrancar, la app vacía `.staging` (restos de separaciones interrumpidas).

Cancelar hace `docker kill` del contenedor (matar solo el cliente `docker run` lo dejaría corriendo).
Solo hay una separación a la vez.

## Protocolo del motor (versión 2)

Una línea JSON por mensaje en stdout:

```json
{"type": "device", "device": "cuda", "name": "NVIDIA GeForce RTX 3060"}
{"type": "capabilities", "protocol": 2, "engine": "2.1.0",
 "qualities": {"fast": ["guitar", "piano"], "best": ["guitar", "piano"]}, "wind": true, "transcription": true}
{"type": "progress", "percent": 42.0, "stage": "separating"}
{"type": "log", "message": "…"}
{"type": "done", "stems": ["vocals", "drums", "bass", "piano", "wind", "other"],
 "sampleRate": 44100, "frames": 9261000, "models": ["bs_roformer_sw", "uvr_wind"]}
{"type": "error", "message": "…"}
```

- `capabilities` solo con `--check`. La app lo ejecuta al arrancar (en segundo plano) y guarda el
  resultado: sabe qué calidades e instrumentos ofrecer y si Docker puede usar la GPU. Si el contenedor
  no arranca con `--gpus all` porque no hay GPU NVIDIA, repite la comprobación sin GPU y separa con CPU.
- Etapas de `progress`: `loading_audio`, `loading_model`, `separating`, `wind`, `saving`. El reparto de
  la barra se calcula con el coste medido de cada paso en GPU y en CPU.
- **Compatibilidad**: un motor de la versión 1 (sin `capabilities`, `done` sin `stems`) sigue
  funcionando con 4 pistas; la app no le pasa `--instruments` ni `--quality` y avisa de que conviene
  reconstruirlo. Una imagen nueva también funciona con versiones anteriores de la app.

## Modo práctica: transcripción del bajo

1. La interfaz llama a `generate_bass_tab(id)`. Rust valida el `id`, comprueba que la extracción tiene
   `bass.wav` y, si `bass.notes.json` existe, es de la versión actual y es más reciente que la pista,
   devuelve esas notas sin lanzar nada.
2. Si no, lanza `transcribe.py` **solo sobre `bass.wav`**: en Docker, la pista es el único archivo de la
   biblioteca montado (en solo lectura, junto a los scripts de la app), sin carpeta de salida, sin red y
   sin `--gpus`.
3. El script responde con una línea JSON y Rust la devuelve como respuesta del `invoke`:

   ```json
   {"type": "done", "model": "basic_pitch",
    "notes": [{"note": "C#2", "frequency": 69.3, "startTimeMs": 1200, "endTimeMs": 1500}, …]}
   {"type": "error", "message": "…"}
   ```

   Todo lo demás (el `print` interno de Basic Pitch, avisos de librerías) va a stderr. Rust descarta
   notas sin duración o con frecuencias imposibles, las ordena y las guarda en `bass.notes.json`
   (escritura atómica; si falla, solo se pierde la caché).
4. Separación y transcripción tienen cada una su hueco de proceso: pueden correr a la vez, pero solo hay
   una de cada tipo. Al cerrar la app se detienen las dos. `--check` declara `"transcription": true`
   cuando Basic Pitch está disponible (en la imagen o en las ruedas de la app).

En la interfaz, todo el modo práctica (`src/components/practice/` y `src/lib/bass-tab.ts`) es un
fragmento aparte que se carga con `React.lazy` al abrirlo:

- **Instrumento**: si alguna nota (con la transposición de la pista aplicada) está por debajo de E1
  (41,2 Hz, con medio semitono de margen) el mástil es de 5 cuerdas; si no, de 4.
- **Mapeo a cuerda y traste**: algoritmo de Viterbi sobre estados «cuerda, traste y caja de la mano»
  (cuatro trastes). Cuesta mover la caja (más con saltos largos y menos tras un silencio), algo cruzar
  cuerdas y un poco tocar alto; dos notas solapadas no pueden ir en la misma cuerda; una cuerda al aire
  hereda la caja. Se elige el recorrido más barato de toda la canción (≈5 ms para 600 notas).
- **Dibujo**: un `<canvas>` con dos capas estáticas cacheadas (diapasón; trastes y cuerdas) y lo
  dinámico encima. Mientras suena, un `requestAnimationFrame` lee `audiblePosition` del
  `MultitrackEngine`: la posición que está saliendo por el dispositivo (`getOutputTimestamp`, o la
  latencia de salida declarada), no la que se está procesando. En pausa no hay bucle: se repinta cuando
  el motor avisa por `subscribe` (reproducir, pausar, saltar). Mientras está abierto, el mezclador solo
  mide el vúmetro del bajo.

## Biblioteca (`entry.json`)

```json
{
  "version": 1,
  "title": "Mi canción",
  "sourceName": "Mi canción.mp3",
  "createdAt": 1759080000000,
  "durationSec": 213.4,
  "stems": ["vocals", "drums", "bass", "piano", "other"],
  "quality": "best",
  "models": ["bs_roformer_sw"],
  "device": "cuda",
  "deviceName": "NVIDIA GeForce RTX 3060",
  "elapsedMs": 71000,
  "mix": {
    "version": 1,
    "masterFader": 0.75,
    "masterSemitones": -2,
    "tracks": { "vocals": { "fader": 0.75, "muted": true, "solo": false, "semitones": 0 } }
  }
}
```

- El `id` de cada extracción es el nombre de su carpeta. Rust rechaza cualquier `id` que no sea un
  nombre simple (sin `..`, separadores ni punto inicial).
- `bass.notes.json` (opcional) guarda las notas del bajo ya transcritas: `{"version": 1, "notes": […]}`.
  Viaja con la carpeta; si se borra, se vuelve a transcribir.
- `entry.json` se escribe de forma atómica (archivo temporal + renombrado).
- La interfaz guarda la mezcla 600 ms después del último cambio.
- El webview lee las pistas con el protocolo `asset:`, autorizado solo para la carpeta de la biblioteca.

## Reproducción, transposición y tempo

`src/lib/audio-engine.ts` reproduce todas las pistas en el mismo reloj de `AudioContext` (a 44,1 kHz,
la frecuencia de las pistas), así que nunca se desfasan. Cada pista suena por una de dos rutas:

```
BufferSource ─────────→ directa ───┬→ ganancia (fader·mute/solo) → vúmetro → máster → transporte
Signalsmith Stretch ──→ procesada ─┘
```

- **Ruta directa**: la fuente tal cual, idéntica al archivo. Se usa al 100 % de tempo y con 0
  semitonos. Signalsmith no es transparente ni así (reconstruye fases), por eso solo procesa cuando hace
  falta.
- **Ruta procesada**: **Signalsmith Stretch** (MIT, WASM en un AudioWorklet) en **modo búfer**, que
  cambia tono y velocidad a la vez con calidad pensada para música polifónica. Con el tempo cambiado
  todas las pistas van por aquí y no hay fuentes directas. Hay como mucho un procesador por pista; se
  crea la primera vez que la pista lo necesita.
- **Un instante para todo**: cada cambio (arrancar, tempo, tono, pasar de una ruta a otra) se programa
  para `ahora + 40 ms + latencia del procesador` (≈160 ms). En ese instante las rutas se funden
  (constante de 12 ms) y cada procesador arranca en la posición exacta de la canción, porque
  Signalsmith compensa su latencia si se programa con esa antelación. Si llega otro cambio antes, espera
  a que pase el anterior: nunca hay dos pendientes, así que todas las pistas cambian a la vez.
- **Reloj**: una lista de tramos (instante, posición, velocidad) da la posición de la canción que suena
  en cada momento. Las ondas, el tiempo del dock y el modo práctica cuentan en tiempo de la canción.
- **Audio a trozos**: el procesador no recibe la pista entera (duplicaría en memoria cada canción
  abierta) sino trozos de 4 s alrededor del cabezal (`StretchLane` en `src/lib/stretch.ts`): cada
  250 ms se carga lo que viene (12 s por delante) y se libera lo que ya sonó. Unos 8 MB por pista.
- **Arreglo de Signalsmith 1.3.2**: con más de un trozo cargado, el procesador copiaba la ventana de
  entrada con índices erróneos, lanzaba una excepción en el AudioWorklet y se quedaba mudo.
  `vite.config.ts` lo corrige al compilar (plugin `signalsmith-buffers-fix`; la versión está fijada) y
  hace fallar la construcción si el paquete cambia.
- **Medido** en Chrome: los golpes de la ruta procesada quedan entre −1,5 y +4,5 ms de la directa
  (sin «flam» en los fundidos); un cambio de velocidad no salta (error de posición ≤3 ms, también al
  cruzar trozos); 7 procesadores cuestan ~13 % de un núcleo. En pausa, el `AudioContext` se suspende
  para no gastar CPU.
- El transporte silencia hasta que llega el audio nuevo al reproducir o saltar, para que no se oiga la
  cola de la posición anterior. El cabezal se queda quieto hasta entonces.

### Tempo estimado

`src/lib/tempo-estimate.ts` estima los BPM en un Worker al abrir la canción (~1 s con siete pistas;
`useTempoEstimate` guarda el resultado mientras la app está abierta). De cada pista toma los 90 s
centrales a ~11 kHz:

1. Envolvente de ataques por flujo espectral (FFT de 512, ~86 ventanas por segundo).
2. Autocorrelación de cada envolvente, normalizada, y media de todas las pistas con sonido. Usar todas,
   y no solo la batería, resuelve muchos casos de doble o mitad: en un reggae los charles marcan igual
   70 que 140 BPM, pero bajo, guitarra y piano solo se repiten a 70.
3. El tempo es el periodo con más autocorrelación entre 60 y 180 BPM, con una preferencia suave por
   los 120 que solo decide cuando el doble y la mitad empatan. Después se afina con los múltiplos del
   periodo. Con poca confianza (sin pulso claro) no se da cifra.

## Exportación

`src/lib/export.ts` renderiza con `OfflineAudioContext` y la misma cadena (ganancia + Signalsmith en
modo búfer), así se exporta exactamente lo que se oye:

- Las fuentes que cambian pasan por el procesador y las demás arrancan con su misma antelación; al
  final se recorta. El render se pausa cada 4 s de salida para cargar el siguiente trozo de cada pista.
  Con otro tempo, el archivo dura `duración / velocidad`. Si la mezcla supera 0 dBFS, se baja lo justo.
- La codificación va en un Worker: WAV 16/24 bits (propio) o MP3 CBR 320 kbps (LAME compilado a WASM,
  `wasm-media-encoders`; el `.wasm` es un archivo aparte).
- WAV 16 bits sin cambios = **copia byte a byte** del archivo de la biblioteca.
- Rust (`export.rs`) solo escribe dentro de una carpeta o archivo elegidos en un diálogo **abierto por
  el propio Rust** en esa sesión, solo `.wav`/`.mp3`, sin `..`, y a través de un archivo temporal. Los
  bytes viajan como cuerpo binario del IPC, sin pasar por JSON.

## Seguridad

- El contenedor del motor corre **sin red** (`--network none`) y sin descargar imágenes
  (`--pull never`); solo ve la canción (solo lectura) y su carpeta de salida.
- CSP estricta: solo recursos propios; `wasm-unsafe-eval` y `blob:` en `script-src` para el worklet de
  Signalsmith; `asset:` limitado a la biblioteca.
- Permisos de Tauri mínimos: `dialog:allow-open`, `opener:default`, `updater:default`,
  `process:allow-restart`.
- Las actualizaciones van firmadas: la app solo instala paquetes firmados con la clave cuya parte
  pública está en `tauri.conf.json` (ver [ACTUALIZACIONES.md](ACTUALIZACIONES.md)).

## Instalador y actualizaciones

El instalador NSIS usa la plantilla oficial de Tauri con un parche
([`scripts/nsis-template.mjs`](../scripts/nsis-template.mjs)): si detecta una versión anterior
instalada, entra en el mismo modo que usa el actualizador integrado (`/UPDATE`): no muestra la página
de «desinstalar antes de instalar», no ejecuta el desinstalador anterior, reutiliza la carpeta y
conserva accesos directos y datos. Detalles en [ACTUALIZACIONES.md](ACTUALIZACIONES.md).
