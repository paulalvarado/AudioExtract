# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

App de escritorio con Tauri 2: la interfaz es web (React en WebView2/WKWebView) dentro de una ventana
nativa; no hay lenguaje de diseño nativo por sistema operativo.

## Users

- **Productores y DJs.** Necesitan stems limpios de una canción para remezclas, samples, edits y
  mashups. Después siguen trabajando en un DAW (Ableton, FL Studio, Reaper, Logic…), así que las
  pistas tienen que salir listas para arrastrar: alineadas, del mismo largo y con nombres claros.
- **Músicos que practican.** Aíslan o quitan su instrumento para tocar o cantar encima, transponen
  la canción entera (o una sola pista) para ajustarla a su voz o a su instrumento, y la frenan para
  sacar los pasajes difíciles.

Ambos trabajan en su propio ordenador, con archivos de audio propios, en sesiones de escucha
concentrada.

## Product Purpose

Separar una canción en pistas por instrumento en local, escucharlas en un mezclador sincronizado,
transponerlas por semitonos, cambiar el tempo y exportarlas, conservando cada extracción en una biblioteca para volver
a ella sin procesar otra vez. Éxito: el usuario suelta un archivo y en pocos minutos tiene pistas
que puede llevar a su DAW o usar para practicar.

## Positioning

Todo ocurre en el equipo del usuario: el motor lo instala la propia app y separa sin red, sin cuentas ni
suscripciones, con modelos abiertos de última generación (Demucs v4, BS-RoFormer, UVR) acelerados
por GPU. Separación, mezcla, transposición y exportación viven en la misma app.

## Operating Context

- Flujo principal: arrastrar un archivo de audio → elegir instrumentos → separar (minutos, con progreso) →
  escuchar y mezclar (volumen, mute, solo, semitonos, tempo) → exportar pistas o mezcla → volver a la
  biblioteca más tarde.
- Motor de separación: integrado. La app instala su propio Python con PyTorch para CUDA (GPU NVIDIA),
  Metal (Apple Silicon) o el procesador según el equipo, sin Docker ni pasos manuales. Docker queda
  como alternativa opcional para desarrollo.
- Distribución: proyecto público en GitHub. Instaladores en GitHub Releases; las actualizaciones se
  instalan con el mismo instalador `.exe` (NSIS), también desde la propia app.

## Capabilities and Constraints

- Entrada: MP3, WAV, FLAC, AIFF, OGG y M4A. Cada extracción se guarda en la biblioteca como WAV 16 bits / 44,1 kHz por
  pista, más sus ajustes de mezcla.
- Instrumentos: voces, batería, bajo y otros siempre; guitarra y piano opcionales; viento opcional
  (metales y maderas juntos: trompetas, saxos, flautas… — el modelo no los distingue entre sí).
  Lo que no se pide se suma a «Otros».
- Transposición en tiempo real por pista y global (±12 semitonos), sin cambiar el tempo.
- Tempo global en tiempo real (50–150 %, sin cambiar el tono), solo para toda la canción, con los BPM
  estimados a partir de las pistas (una estimación: puede salir el doble o la mitad).
- Exportación de pistas sueltas o de la mezcla en WAV 16/24 bits o MP3.
- Hardware soportado: Windows con GPU NVIDIA, Windows sin GPU (más lento; la app debe avisarlo) y
  macOS Apple Silicon.
- La primera vez, la app instala el motor con un clic: ≈4,4 GB con GPU NVIDIA, ≈1,8 GB sin ella (PyTorch
  + pesos de los modelos). Después separa sin red y se pone al día solo cuando una versión lo necesita.
- Interfaz y documentación en español.
- Sin decidir: licencia del repositorio y propietario/nombre definitivo del repositorio en GitHub.

## Brand Commitments

- Nombre: **AudioExtract**, escrito «Audio» + «Extract» con la segunda parte en el color de acento.
- Icono existente: `app-icon.svg` (barras redondeadas de colores sobre fondo oscuro, como un
  ecualizador de pistas).
- Voz: español neutro, directo y técnico sin jerga innecesaria. Los errores dicen qué pasó y qué
  hacer a continuación.

## Evidence on Hand

- No hay capturas, testimonios, usuarios ni métricas de uso: no se inventan.
- Las métricas SDR publicadas de los modelos (Demucs, MVSEP) pueden citarse con su fuente.

## Product Principles

1. **Local primero.** El audio nunca sale del equipo; el motor funciona sin red.
2. **Listo para seguir trabajando.** Lo que sale de la app entra en un DAW sin retoques.
3. **Instrumentos, no modelos.** El usuario elige qué quiere separar; la app decide qué modelo usar.
4. **Honesto con los límites.** Avisar de lo que será lento en CPU y de lo que un modelo no separa bien.
5. **No perder trabajo.** Cada extracción y su mezcla quedan guardadas en la biblioteca.

## Accessibility & Inclusion

Todo el mezclador se maneja con teclado (atajos de transporte, faders nativos con `aria-valuetext`),
y la interfaz respeta `prefers-reduced-motion`.
