# Novedades

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con
[SemVer](https://semver.org/lang/es/). Indica siempre si una versión requiere reconstruir el motor.

## [0.4.0] — 2026-10-04

**No requiere reconstruir el motor**: basta con instalar este `.exe` encima.

### Añadido

- **Tempo global**: acelera o frena toda la canción del 50 al 150 % (de 5 en 5) sin cambiar el tono,
  en tiempo real y con todas las pistas sincronizadas. Está en el dock, debajo del tono, y con el foco
  en el valor responde a flechas (±5 %), RePág/AvPág (±25 %) y 0 o doble clic (velocidad original).
  Se guarda con la mezcla de cada canción y «Restablecer» lo devuelve al 100 %.
- **BPM estimados**: al abrir una canción, la app estima su tempo a partir de todas las pistas (en un
  segundo plano, ~1 s) y muestra los BPM que suenan junto al control de tempo, y los de la canción en
  la cabecera del mezclador. Es una estimación: puede salir el doble o la mitad del pulso que sientes.
- **Exportar con tempo**: la mezcla y las pistas (con «Aplicar el volumen, el tono y el tempo del
  mezclador») salen al tempo elegido, con el cambio en el nombre: `… - mezcla (tono +2, tempo 80 %).wav`.
  El panel indica cuánto dura el archivo resultante.
- El modo práctica (mástil y tablatura) sigue la canción al tempo que suene.

### Cambiado

- **Nuevo motor de reproducción**: el tono y el tempo se procesan juntos con Signalsmith Stretch en
  modo búfer, que recibe cada pista a trozos alrededor del cabezal (unos 8 MB por pista en lugar de
  duplicar la canción en memoria). Al 100 % y con 0 semitonos la pista sigue sonando idéntica al archivo.
- Signalsmith Stretch fijado en la versión 1.3.2, con un arreglo propio al compilar: con más de un
  trozo de audio cargado se quedaba mudo.
- Dock: el tono y el tempo van apilados en un bloque de dos filas, y las etiquetas aparecen a anchos
  calculados para que todo quepa también con siete instrumentos en la ventana mínima.
- La construcción del instalador guarda en caché las utilidades de NSIS que Tauri descarga de GitHub
  (esa descarga no tiene tiempo de espera y podía dejar la construcción colgada).

## [0.3.2] — 2026-10-04

**No requiere reconstruir el motor**: basta con instalar este `.exe` encima.

### Corregido

- La 0.3.1 no podía usar el motor: Docker rechazaba la carpeta de la app instalada
  (`docker: invalid spec: \\?\C:\…: too many colons`). En Windows, la carpeta de recursos llega con el
  prefijo `\\?\` y ahora se convierte a la forma normal antes de montarla. Fallaban la comprobación del
  motor al arrancar, la separación y la transcripción del modo práctica.
- Test de punta a punta (`--ignored e2e`) que comprueba el motor y transcribe con Docker real y la app
  instalada, para que un fallo así no vuelva a salir en un instalador.

## [0.3.1] — 2026-10-04

**No requiere reconstruir el motor**: basta con instalar este `.exe` encima.

### Corregido

- El modo práctica de la 0.3.0 pedía reconstruir la imagen del motor («El motor instalado es de una
  versión anterior…»). Ahora funciona con el motor que ya tengas instalado.

### Cambiado

- **El motor se actualiza con la app.** El instalador lleva los scripts del motor (`separate.py`,
  `transcribe.py`, `catalog.py`) y las librerías de Python puro que necesitan (Basic Pitch y sus
  dependencias, ~6,5 MB). La app los monta en el contenedor (en solo lectura y sin red) y los ejecuta
  en lugar de los de la imagen; la imagen aporta PyTorch y los modelos. Con el motor Python local
  pasa lo mismo: lo que falte en el entorno lo completan esas librerías.
- La construcción del instalador falla si no lleva el motor de la app, y solo exporta el instalador de
  la versión que se construye (antes copiaba también los de versiones anteriores guardados en caché).

## [0.3.0] — 2026-10-04

Con esta versión, el modo práctica pedía reconstruir el motor (`npm run docker:engine`); la 0.3.1 lo
corrige y ya no hace falta.

### Añadido

- **Modo práctica para el bajo**: botón «Practicar» en la pista de bajo del mezclador. Transcribe el
  bajo a notas en tu equipo (Basic Pitch, en CPU, unos segundos por canción) y muestra un mástil con
  las notas que suenan, la posición de la mano y lo que viene, más una tablatura que avanza con la
  canción (clic en ella para saltar). Bajo de 5 cuerdas si alguna nota baja de E1, de 4 si no. Sigue
  la transposición de la pista. La transcripción se guarda en `bass.notes.json` junto a la pista.
- Motor 2.1: `transcribe.py` y la capacidad `transcription` en `--check` (visible en Ajustes).

## [0.2.0] — 2026-09-28

**Requiere reconstruir el motor**: `npm run docker:engine` (o `scripts\install.ps1`). Con el motor
anterior la app sigue funcionando, solo con voces, batería, bajo y otros.

### Añadido

- **Más instrumentos**: guitarra, piano y viento (trompetas, saxos, flautas…), a elección en cada
  extracción. Lo que no se pide queda en «Otros».
- **Calidad máxima** con BS-RoFormer SW (6 pistas, mucho más limpia en piano y guitarra) además de la
  rápida con Demucs v4. Por defecto, máxima con GPU y rápida sin ella.
- **Biblioteca** de extracciones en `Música\AudioExtract` (carpeta configurable): buscar, renombrar,
  mostrar en la carpeta y enviar a la papelera. Cada extracción guarda su mezcla.
- **Transposición** por semitonos en tiempo real, por pista y global (±12), sin cambiar el tempo
  (Signalsmith Stretch). Con 0 semitonos la pista suena idéntica al archivo.
- **Exportación** de pistas sueltas o de la mezcla en WAV 24/16 bits o MP3 320 kbps, aplicando o no
  el volumen y el tono del mezclador, con nombres descriptivos («… - sin voces (tono −2).mp3»).
- **Dock de escucha** siempre visible y mezclador expandible; la separación en curso aparece como una
  fila de la biblioteca y se puede seguir escuchando mientras tanto.
- **Actualizaciones con el mismo instalador**: un instalador más nuevo se instala encima sin preguntar
  ni desinstalar. Actualizador integrado con GitHub Releases y paquetes firmados.
- Formatos de entrada FLAC, AIFF, OGG y M4A.
- Estado del motor al arrancar: acelerador, modelos disponibles y, si falla, qué hacer. Si Docker no
  puede usar la GPU, la app separa con la CPU sin configurar nada.
- Motor Python como opción en Windows y por defecto en macOS (Metal).
- Modo demo en el navegador (`npm run dev:web`), CI y publicación con GitHub Actions, documentación
  completa en `docs/`.

### Cambiado

- Las pistas se guardan en la biblioteca en lugar de la carpeta temporal del sistema.
- El motor pasa a la versión 2 del protocolo (compatible con la app 0.1).

## [0.1.0]

- Separación en 4 pistas (voces, bajo, batería, otros) con Demucs v4, mezclador con mute, solo y
  volumen, y motor en Docker con GPU NVIDIA.
