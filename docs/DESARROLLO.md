# Desarrollo

## Estructura

```
├── src/                         Interfaz (React 19 + TypeScript + Tailwind 4)
│   ├── App.tsx                  Vistas (biblioteca / mezclador), paneles, atajos, arrastrar y soltar
│   ├── components/              TopBar, NewExtraction, JobRow, LibraryView/Row, Dock, MixerView,
│   │   │                        TrackControls, Stepper (SemitoneControl, TempoControl), ExportPanel, …
│   │   └── practice/            Modo práctica (carga diferida): BassPractice, PracticeFretboard
│   │                            y fretboard-renderer (dibujo del mástil y la tablatura en canvas)
│   ├── hooks/                   useLibrary, usePlayer, useSeparation, useTempoEstimate, useUpdater, …
│   ├── lib/
│   │   ├── tauri.ts             Puente tipado con los comandos de Rust
│   │   ├── audio-engine.ts      Reproductor multipista: rutas, reloj, tono y tempo (Web Audio)
│   │   ├── stretch.ts           Signalsmith Stretch en modo búfer, alimentado a trozos
│   │   ├── pitch.ts             Rangos de semitonos y de tempo
│   │   ├── tempo-estimate.ts    BPM a partir de las pistas (y tempo.worker.ts, que lo ejecuta)
│   │   ├── bass-tab.ts          Notas del motor → 4/5 cuerdas y cuerda/traste de cada nota
│   │   ├── export.ts            Render offline + codificación + escritura
│   │   ├── encoder.worker.ts    WAV / MP3 en un Worker
│   │   └── preferences.ts       Preferencias locales (localStorage)
│   ├── demo/                    Backend simulado para `npm run dev:web` (no llega al build)
│   └── index.css                Tokens de color y estilos base
├── src-tauri/                   Backend (Rust, Tauri 2)
│   ├── src/                     commands, engine, library, export, settings, error
│   ├── tauri.conf.json          Ventana, CSP, instalador, actualizador
│   ├── tauri.release.conf.json  Extra para publicar: artefactos firmados del actualizador
│   ├── windows/installer.nsi    Plantilla NSIS parcheada (generada, no editar a mano)
│   └── capabilities/            Permisos
├── python/                      Motor de separación
│   ├── separate.py              Protocolo, plan, separación, guardado
│   ├── transcribe.py            Notas del bajo para el modo práctica (Basic Pitch)
│   ├── catalog.py               Modelos: disponibilidad y descarga
│   ├── requirements.txt
│   ├── requirements-transcription.txt   Dependencias de transcribe.py (basic-pitch va aparte)
│   └── wheels/                  Ruedas que lleva el instalador (las descarga vendor-wheels.mjs; no se versionan)
├── docker/                      engine.Dockerfile (motor) y app.Dockerfile (instalador y tests)
├── scripts/                     install.ps1, setup-python.*, nsis-template, setup-updater, set-version
├── docs/                        Esta documentación
├── .github/workflows/           CI y publicación de versiones
├── PRODUCT.md                   Contexto de producto (usuarios, propósito, principios)
└── DESIGN.md                    Sistema visual (tokens, componentes, reglas)
```

## Entorno

**Solo Docker** (sin instalar nada más): cada cambio se prueba reconstruyendo con
`npm run docker:app` / `npm run docker:test`. Las cachés de BuildKit hacen que las recompilaciones
tarden poco.

**Nativo** (recarga en caliente): Node 20.19+, [Rust](https://rustup.rs) y los
[prerrequisitos de Tauri](https://tauri.app/start/prerequisites/) (en Windows, las *Build Tools* de
Visual Studio con C++ y WebView2).

```bash
npm install
npm run tauri dev        # app con recarga en caliente; motor: la imagen de Docker
```

Para desarrollar con el motor Python del repositorio:

```bash
bash scripts/setup-python.sh --dev            # macOS / Linux  →  python/.venv
scripts\setup-python.ps1 -Dev -Cuda           # Windows
AUDIOEXTRACT_ENGINE=python npm run tauri dev  # PowerShell: $env:AUDIOEXTRACT_ENGINE="python"; npm run tauri dev
```

## Modo demo en el navegador

```bash
npm run dev:web     # http://localhost:1420
```

La interfaz completa sin Rust ni motor: `src/demo/mock.ts` simula el backend en memoria (biblioteca de
ejemplo, separación con progreso, exportación) y `src/demo/synth.ts` sintetiza pistas musicales por
instrumento, así se puede escuchar la transposición y exportar de verdad. Parámetros de la URL:

| URL | Estado |
| --- | --- |
| `/?empty` | Biblioteca vacía (primer arranque) |
| `/?engine=down` | Motor no disponible |
| `/?engine=old` | Motor de la versión 1 |
| `/?engine=cpu` | Sin GPU |
| `/?update` | Hay una actualización |
| `/?tab=error` | La transcripción del bajo (modo práctica) falla |

En el modo demo, el bajo sintético toca fundamental, quinta y octava de cada acorde (con un C1, así que
el mástil es de 5 cuerdas) y la transcripción simulada devuelve exactamente esas notas: sirve para
comprobar a oído la sincronía del mástil y la tablatura.

Vite sustituye `import.meta.env.MODE` al compilar, así que el modo demo no llega al build de la app.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` / `dev:web` | Servidor de Vite (para Tauri) / modo demo en el navegador |
| `npm run build` | Comprobación de tipos + build de la interfaz (antes prepara `python/wheels/`) |
| `npm run vendor:wheels` | Descarga las ruedas de Python puro que lleva el instalador (versiones y SHA-256 fijos) |
| `npm run tauri dev` · `tauri build` | App nativa (requiere Rust) |
| `npm run docker:engine` | Imagen del motor |
| `npm run docker:check` | `--check` del motor con GPU y sin red |
| `npm run docker:app` | Instalador de Windows en `release/` |
| `npm run docker:test` | Compila los tests de Rust para Windows y los ejecuta |
| `npm run nsis:template` | Regenera la plantilla NSIS parcheada (tras actualizar Tauri) |
| `npm run updater:setup -- --repo u/r` | Claves de firma y URL del actualizador |
| `npm run version:set -- 0.3.0` | Cambia la versión en package.json, package-lock y Cargo.toml |

## Tests y comprobaciones

```bash
npm run build                                   # TypeScript estricto + Vite
npm run docker:test                             # tests de Rust (Windows)
cargo test --manifest-path src-tauri/Cargo.toml --lib            # nativo
cargo clippy --manifest-path src-tauri/Cargo.toml --lib --tests -- -D warnings
docker run --rm --gpus all --network none audioextract-engine --check
```

La CI (`.github/workflows/ci.yml`) ejecuta el build de la interfaz, clippy y los tests de Rust en
Windows, y compila los scripts de Python.

Antes de publicar un instalador que cambie algo del motor, prueba con la **app instalada** (en Windows,
Tauri da su carpeta de recursos con el prefijo `\\?\`, distinta de las rutas del repositorio). Este test
comprueba el motor y transcribe un bajo con Docker real, igual que la app:

```powershell
$env:AUDIOEXTRACT_E2E_RESOURCES = "\\?\$env:LOCALAPPDATA\AudioExtract"
$env:AUDIOEXTRACT_E2E_BASS = "$env:USERPROFILE\Music\AudioExtract\<canción>\bass.wav"
release\tests\audioextract-tests.exe --ignored e2e
```

Para probar el motor a mano:

```bash
docker run --rm --gpus all --network none \
  -v "C:\ruta\cancion.mp3:/input/source.mp3:ro" -v "C:\ruta\salida:/output" \
  audioextract-engine --input /input/source.mp3 --output /output --instruments piano,wind --quality best
```

## Convenciones

- Interfaz, mensajes, comentarios y documentación en **español**.
- Colores solo desde los tokens de `src/index.css` (ver [DESIGN.md](../DESIGN.md)); un color fijo por
  instrumento.
- Los errores de Rust llegan al frontend como `{ kind, message }`: el mensaje explica qué pasó y qué
  hacer.
- La versión de los crates de Tauri y de los paquetes `@tauri-apps/*` debe coincidir en la versión
  menor: el CLI se niega a compilar si no.
- Tras actualizar `@tauri-apps/cli`, ejecuta `npm run nsis:template` y revisa el diff de
  `src-tauri/windows/installer.nsi`.
