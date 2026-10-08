# Novedades

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con
[SemVer](https://semver.org/lang/es/) según la
[política de versiones](docs/ACTUALIZACIONES.md#política-de-versiones). Cada cambio se anota en
«Sin publicar» al hacerlo; `npm run version:set` lo pasa a la versión nueva. Indica siempre si una
versión requiere reconstruir el motor.

## [Sin publicar]

## [1.1.0] — 2026-10-07

**Ya no hace falta Docker.** Al abrir esta versión, pulsa «Instalar el motor» una vez y la app instala
su propio motor según tu equipo (≈4,4 GB con GPU NVIDIA, ≈1,8 GB sin ella). Tu biblioteca y tus mezclas
se conservan. La imagen Docker anterior deja de usarse: puedes borrarla con `docker rmi
audioextract-engine` (libera ~14 GB), o seguir usándola con `AUDIOEXTRACT_ENGINE=docker`.

### Añadido

- **Motor integrado**: la app instala por sí misma el motor de separación, sin Docker ni Python. Detecta
  la GPU NVIDIA (modelo, memoria, driver y generación), la memoria y el procesador, y elige qué instalar:
  PyTorch con CUDA 12.8, con CUDA 12.6 para GPU anteriores (GTX 900/1000), para el procesador o con Metal
  en Apple Silicon. Antes de empezar muestra lo detectado, lo que descargará y ocupará, y si hay espacio.
  Después enseña el avance paso a paso (Python, PyTorch, ffmpeg, modelos y comprobación) en el panel y
  en la barra superior. Se puede detener y continuar sin repetir lo descargado.
- El motor se **pone al día solo** cuando una versión nueva de la app necesita otros paquetes o modelos:
  solo descarga lo que cambió.
- Ajustes → Motor de separación: **Reinstalar el motor**, la carpeta donde está instalado y un aviso si
  el equipo admite ahora una variante mejor (por ejemplo, tras instalar una GPU).

### Cambiado

- El motor predeterminado es el integrado en Windows y macOS. Docker y un Python propio siguen
  disponibles con `AUDIOEXTRACT_ENGINE=docker` y `AUDIOEXTRACT_PYTHON`.
- `scripts\install.ps1` solo compila la app; la imagen Docker del motor se construye aparte con
  `-DockerEngine`.
- Los mensajes de error del motor dicen cómo arreglarlo según dónde corre (Ajustes, Docker o pip), sin
  pedir comandos con el motor integrado.
- Las versiones de Windows se publican solo con el instalador `.exe`: el `.msi` (solo en inglés y sin la
  actualización encima sin preguntar) ya no se genera.
- macOS 14 o posterior (onnxruntime ya no publica ruedas para macOS 13).

### Corregido

- Los M4A/AAC se leen con ffmpeg directamente: el lector anterior necesitaba `ffprobe`, que no todos los
  entornos traen.

## [1.0.0] — 2026-10-07

**No requiere reconstruir el motor**: si ya tenías instalada una versión de desarrollo (0.x), instala
este `.exe` encima y conserva tu biblioteca y tus mezclas. En una instalación nueva, el motor se
construye una vez con `scripts\install.ps1` (o `npm run docker:engine`).

Primera versión pública, como software libre bajo la licencia GPL 3.0 o posterior.

### Añadido

- **Separación en pistas** en tu equipo: voces, batería, bajo y otros, más guitarra, piano y viento a
  elección en cada extracción (lo que no se pide queda en «Otros»). Calidad máxima con BS-RoFormer SW
  (6 pistas) o rápida con Demucs v4; por defecto, máxima con GPU y rápida sin ella. Entrada en MP3, WAV,
  FLAC, AIFF, OGG y M4A.
- **Motor** en Docker con GPU NVIDIA (o CPU si Docker no puede usar la GPU, sin configurar nada) o en
  Python local, por defecto en macOS (Metal). Al arrancar muestra su estado: acelerador, modelos y, si
  falla, qué hacer.
- **El motor se actualiza con la app**: el instalador lleva los scripts del motor y las librerías de
  Python puro que necesitan, y la app los monta en la imagen instalada; la imagen aporta PyTorch y los
  modelos.
- **Biblioteca** de extracciones en `Música\AudioExtract` (carpeta configurable): buscar, renombrar,
  mostrar en la carpeta y enviar a la papelera. Cada extracción guarda su mezcla, y la separación en
  curso aparece como una fila más mientras sigues escuchando.
- **Mezclador** con mute, solo y volumen por pista, y dock de escucha siempre visible.
- **Tono y tempo en tiempo real**: transposición de ±12 semitonos por pista y global, y tempo del 50 al
  150 % sin cambiar el tono, con Signalsmith Stretch. Al 100 % y con 0 semitonos la pista suena idéntica
  al archivo.
- **BPM estimados** de cada canción, en la cabecera del mezclador y junto al control de tempo.
- **Exportación** de pistas sueltas o de la mezcla en WAV 24/16 bits o MP3 320 kbps, aplicando o no el
  volumen, el tono y el tempo del mezclador, con nombres descriptivos
  (`… - mezcla (tono +2, tempo 80 %).wav`).
- **Modo práctica para el bajo**: transcribe el bajo a notas en tu equipo (Basic Pitch, en CPU) y muestra
  un mástil con las notas que suenan, la posición de la mano y lo que viene, más una tablatura que avanza
  con la canción. Bajo de 4 o 5 cuerdas según la tesitura; sigue el tono y el tempo de la pista.
- **Actualizaciones con el mismo instalador**: una versión más nueva se instala encima sin preguntar ni
  desinstalar. Actualizador integrado con GitHub Releases y paquetes firmados.
- Modo demo en el navegador (`npm run dev:web`), CI y publicación con GitHub Actions, y documentación en
  `docs/`.

[Sin publicar]: https://github.com/paulalvarado/AudioExtract/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/paulalvarado/AudioExtract/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/paulalvarado/AudioExtract/releases/tag/v1.0.0
