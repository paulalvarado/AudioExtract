---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components"]
---

# Superficie: ventana principal de AudioExtract (biblioteca + dock + mezclador)

Modo: Operate. Público: productores/DJs y músicos que practican (ver PRODUCT.md).
Tarea: volver a una extracción ya hecha (lo más frecuente), escucharla, mezclarla,
transponerla y exportarla; separar una canción nueva es la acción secundaria siempre visible.
Restricciones: ventana mínima 920×620; mundo visual existente (se extiende, no se sustituye);
español; todo local.

## Direction contract

THESIS: La biblioteca es el rack de la sesión: cada canción separada es una fila densa que
muestra sus instrumentos en sus colores, y elegir una fila la hace sonar al momento en un dock
de transporte fijo abajo, sin cambiar de pantalla. Rechaza la plantilla de la categoría: zona
de soltar a pantalla completa como portada y rejilla de tarjetas de archivos recientes.

OWN-WORLD: El mundo incumbente de AudioExtract: superficies casi negras y frías (oklch 0.17 /
0.205 / 0.25, tono 260), un único acento turquesa para acciones primarias y estado, y una paleta
fija de siete instrumentos (voces rosa, batería ámbar, bajo violeta, guitarra coral, piano
celeste, viento lima, otros verde) que es el único croma del contenido. Segoe UI Variable/Inter
para la interfaz, mono tabular solo para tiempos, dB y semitonos. Paneles de 12–16 px sin
sombras, divisores finos, faders como control firma.

STORY: Al abrir, el usuario ve sus extracciones (título, instrumentos, duración, fecha). Pulsa
una: suena en el dock, donde puede silenciar instrumentos o subir/bajar semitonos a todo. Expande
el dock al mezclador completo para ajustar volumen y semitonos por pista y exporta pistas o la
mezcla. Una canción nueva se suelta en cualquier parte o con «Nueva extracción», eligiendo
instrumentos en línea; su progreso aparece como una fila más de la biblioteca.

FIRST VIEWPORT: Barra superior de 48 px: marca a la izquierda, buscador, estado del motor,
ajustes y «Nueva extracción» (primaria, turquesa) a la derecha. Debajo, la tabla de la biblioteca
ocupa todo el alto: título con archivo y calidad, franja de instrumentos en color, duración,
fecha y acciones al pasar el ratón. Abajo, dock de ~96 px: fila de controles (reproducir,
detener, tiempo, título, chips de instrumento que silencian, tono global −/+, volumen, exportar,
expandir) y una franja de forma de onda para desplazarse. Firma: la fila que suena muestra un
ecualizador de barras como el icono de la app.

FORM: «Biblioteca con dock de escucha», posición 3 de mi lista ordenada, repartida como THE ROLL
por concept-seed de superficie, clave 576b34e4.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
