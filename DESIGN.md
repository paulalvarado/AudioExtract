---
name: AudioExtract
description: Separador de pistas en local con biblioteca, dock de escucha y mezclador; superficies oscuras y frías, un acento turquesa y un color fijo por instrumento.
colors:
  accent: "oklch(0.78 0.14 190)"
  stem-vocals: "oklch(0.74 0.17 355)"
  stem-drums: "oklch(0.82 0.15 78)"
  stem-bass: "oklch(0.7 0.16 290)"
  stem-guitar: "oklch(0.74 0.15 42)"
  stem-piano: "oklch(0.76 0.12 240)"
  stem-wind: "oklch(0.84 0.16 122)"
  stem-other: "oklch(0.77 0.13 170)"
  danger: "oklch(0.7 0.18 25)"
  warning: "oklch(0.84 0.13 85)"
  surface: "oklch(0.17 0.006 260)"
  panel: "oklch(0.205 0.007 260)"
  raised: "oklch(0.25 0.008 260)"
  line: "oklch(0.3 0.008 260)"
  ink: "oklch(0.96 0.003 260)"
  ink-2: "oklch(0.82 0.008 260)"
  ink-3: "oklch(0.67 0.01 260)"
  ink-4: "oklch(0.47 0.01 260)"
typography:
  headline:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Inter", system-ui, -apple-system, sans-serif'
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Inter", system-ui, -apple-system, sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "1.5rem"
  title-sm:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Inter", system-ui, -apple-system, sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "1.25rem"
  item-title:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Inter", system-ui, -apple-system, sans-serif'
    fontSize: "13.5px"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Inter", system-ui, -apple-system, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  body-strong:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Inter", system-ui, -apple-system, sans-serif'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Inter", system-ui, -apple-system, sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "1rem"
  label-sm:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Inter", system-ui, -apple-system, sans-serif'
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.5
  numeric:
    fontFamily: '"Cascadia Mono", "JetBrains Mono", "SF Mono", ui-monospace, monospace'
    fontSize: "13px"
    fontWeight: 400
    fontFeature: '"tnum"'
  numeric-sm:
    fontFamily: '"Cascadia Mono", "JetBrains Mono", "SF Mono", ui-monospace, monospace'
    fontSize: "12px"
    fontWeight: 400
    fontFeature: '"tnum"'
  numeric-xs:
    fontFamily: '"Cascadia Mono", "JetBrains Mono", "SF Mono", ui-monospace, monospace'
    fontSize: "11px"
    fontWeight: 400
    fontFeature: '"tnum"'
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  full: "999px"
spacing:
  "0.5": "2px"
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "2.5": "10px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.line}"
  button-ghost:
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
  button-icon:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.lg}"
    size: "32px"
  button-icon-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
  button-transport:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.full}"
    size: "40px"
  toggle-track:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.md}"
    size: "24px"
  toggle-track-mute:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
  toggle-track-solo:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.surface}"
  button-track-action:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "24px"
  button-track-action-hover:
    backgroundColor: "{colors.line}"
    textColor: "{colors.ink}"
  input-search:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 48px 0 32px"
    height: "32px"
  segmented:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "4px"
  segmented-item:
    textColor: "{colors.ink-3}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "32px"
  segmented-item-selected:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
  option-card:
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "10px 12px"
  stem-chip:
    backgroundColor: "color-mix(in oklab, var(--color-raised) 70%, transparent)"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "28px"
  engine-pill:
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "28px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.2xl}"
    padding: "20px"
  library-row:
    typography: "{typography.item-title}"
    padding: "0 8px"
    height: "56px"
  library-row-current:
    backgroundColor: "color-mix(in oklab, var(--color-raised) 70%, transparent)"
  top-bar:
    backgroundColor: "{colors.surface}"
    padding: "0 16px"
    height: "48px"
  dock:
    backgroundColor: "{colors.panel}"
    padding: "0 16px"
    height: "84px"
  sheet:
    backgroundColor: "{colors.panel}"
    padding: "20px"
    width: "400px"
  toast:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
  practice-strip:
    backgroundColor: "{colors.panel}"
    height: "60px"
  fretboard:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  fretboard-note:
    backgroundColor: "{colors.stem-bass}"
    textColor: "{colors.surface}"
    typography: "{typography.numeric-xs}"
    rounded: "{rounded.full}"
  tab-fret-current:
    backgroundColor: "{colors.stem-bass}"
    textColor: "{colors.surface}"
    typography: "{typography.numeric-sm}"
    rounded: "{rounded.md}"
    height: "18px"
  stepper:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    typography: "{typography.numeric-xs}"
    rounded: "{rounded.lg}"
    height: "24px"
  stepper-changed:
    textColor: "{colors.accent}"
  tone-tempo-stack:
    textColor: "{colors.ink-3}"
    height: "50px"
---

<!--
Los encabezados de sección (## Overview, ## Colors…) se dejan en inglés a propósito: las herramientas que leen
DESIGN.md los buscan por su nombre exacto. Todo lo demás está en español.
-->

# Design System: AudioExtract

Este documento describe el sistema visual tal como está construido en `src/` (React 19 + Tailwind 4). La fuente de
verdad de los tokens es el bloque `@theme static` de `src/index.css`: cada `--color-*` se usa en los componentes como
utilidad de Tailwind (`bg-panel`, `text-ink-3`, `border-line`, `bg-accent/10`…). El frontmatter de arriba copia esos
valores sin cambios y es normativo; el texto explica dónde y por qué se usa cada uno. El complemento para herramientas
(rampas tonales, sombras, movimiento, puntos de corte y fragmentos de componentes) está en `.impeccable/design.json`.

## Overview

**Creative North Star: "El rack de la sesión"**

AudioExtract es una herramienta de escritorio para sesiones de escucha concentrada: se vuelve a una extracción, se
escucha, se mezcla, se transpone y se exporta. La interfaz se comporta como un rack de estudio. Tiene superficies casi
negras y frías, todas del mismo tono, apiladas en tres escalones de luminosidad, con divisores de 1 px y filas densas
de 56 px. El transporte es un dock fijo abajo que no cambia de sitio en ninguna vista. La biblioteca es una tabla y el
mezclador es una tabla de pistas alineada con sus ondas; en el modo práctica, las ondas dejan sitio a un mástil de bajo
y una tablatura dibujados en canvas con los mismos tokens. No hay pantalla de bienvenida ni rejilla de tarjetas.

El color está racionado. La interfaz es neutra, y un único turquesa marca la acción primaria, el foco, el progreso y
lo que está sonando o alterado: el cabezal del dock, el ecualizador de la fila que suena, un tono transpuesto, un tempo
cambiado. El resto
del color pertenece al contenido. Son siete matices fijos, uno por instrumento, que se repiten idénticos en la franja
de la biblioteca, los chips del dock, las pistas del mezclador, las casillas de exportación y el icono de la app. Un
instrumento se reconoce por su color en cualquier pantalla.

El control firma es el fader horizontal redondeado: un carril fino teñido con el color de la pista hasta el valor, un
pulgar blanco con halo del color del panel y una marca de 0 dB. Las cifras que cambian (tiempo, dB, semitonos, tempo) van en
mono tabular para que no bailen. La densidad es alta pero legible: se trabaja a 13 px, los metadatos van a 12 px y
nada baja de 11 px.

**Key Characteristics:**
- Oscuro y frío: tres superficies del mismo tono (`surface` → `panel` → `raised`) más el divisor `line`, sin sombras de elevación.
- Un solo acento, turquesa, para acción, foco, progreso y «suena o está alterado».
- Siete colores de instrumento fijos, que son el único croma del contenido.
- Listas como filas densas con columnas fijas; paneles grandes con 16 px de radio y borde de 1 px.
- El fader horizontal redondeado como control firma; cifras en mono tabular.
- Lo que se dibuja en canvas (ondas, mástil, tablatura) lee los mismos tokens que el resto: no hay una paleta aparte.
- Acciones de fila ocultas hasta el hover, pero siempre alcanzables con el teclado.
- Movimiento corto y funcional, anulado por completo con `prefers-reduced-motion`.

## Colors

Una rampa neutra fría de un solo tono, un acento turquesa, dos colores de estado y una paleta categórica de siete
instrumentos con luminosidad pareja. Todo está en OKLCH en `src/index.css`. El color de un instrumento se inyecta como
variable local `--stem` con `stemStyle(id)` (exportada desde `NewExtraction.tsx`) y se consume con `bg-(--stem)`,
`border-(--stem)` o `text-(--stem)`.

### Primary
- **Turquesa de señal** (`accent`): botón primario («Nueva extracción», «Exportar N pistas», «Instalar y reiniciar»),
  anillo de foco global (2 px, desplazado 2 px), cabezal del dock, barras de progreso de separación, exportación y
  descarga, ecualizador de la fila que suena, punto del motor con GPU, semitonos distintos de 0 (también «tablatura
  transpuesta» en el modo práctica), enlaces de texto («elige un archivo», «Todas»), la mitad «Extract» del
  logotipo, `accent-color` de los controles nativos y selección de texto (al 35 %). El texto sobre el acento es
  siempre `surface`.

### Instrumentos (paleta categórica)
Siete matices repartidos por el círculo cromático con luminosidad y croma parejos para que ninguno domine. El orden es
fijo (`STEM_ORDER` en `src/types.ts`) y se respeta en cada franja y lista.
- **Rosa voz** (`stem-vocals`): Voces.
- **Ámbar batería** (`stem-drums`): Batería.
- **Violeta bajo** (`stem-bass`): Bajo.
- **Coral guitarra** (`stem-guitar`): Guitarra.
- **Celeste piano** (`stem-piano`): Piano.
- **Lima viento** (`stem-wind`): Viento.
- **Verde otros** (`stem-other`): Otros.

El color de instrumento tiene pocas formas, siempre las mismas:
- **Punto sólido:** el instrumento está presente y suena.
- **Anillo de 2 px en su color:** está pedido, pendiente o silenciado.
- **Anillo de 1 px en `ink-4` al 60 %:** no se separó.
- **Punto al 30 %:** falta en el disco.
- **Relleno al 10 % con borde al 60 %:** es la opción elegida.
- **Onda al 35 % con la parte reproducida al 100 %:** su pista en el mezclador.
- **Carril del fader teñido hasta el valor:** su volumen.

En el modo práctica, el violeta del bajo tiene además estas formas, siempre del mismo color:
- **Punto sólido con el nombre de la nota en `surface`:** la nota que suena, en su cuerda y traste.
- **Cuerda en su color desde el traste pisado hasta el cuerpo:** la parte de la cuerda que vibra.
- **Anillo de 2 px, más opaco cuanto más cerca (25–85 %):** las notas del próximo segundo y medio.
- **Franja al 10 % con borde al 40 %:** la posición de la mano (cuatro trastes).
- **Barra de 3 px tras el número de traste:** la duración en la tablatura (85 % si suena, 45 % por tocar, 22 % tocada).
- **Píldora sólida con el número en `surface`:** el número de la tablatura que suena ahora.

### Estado
- **Rojo de alarma** (`danger`): errores (texto, borde al 30–40 %, fondo al 5 %), botón «Mover a la papelera», M
  (silencio) activo, vúmetro que satura, motor no disponible, acción de eliminar al pasar el ratón.
- **Ámbar de aviso** (`warning`): motor sin GPU («CPU»), S (solo) activo, pistas que faltan en el disco, avisos de
  lentitud y de atenuación en la exportación.

### Neutral
La neutra es una sola rampa de ocho escalones del mismo tono, de oscuro a claro, y cada escalón tiene su función.
- **Grafito** (`surface`): fondo de la ventana y de la barra superior. También los «pozos» hundidos: fondo de
  segmentados, campo de renombrar, bloques de error, fondo del vúmetro, grupo de semitonos y diapasón del mástil. Es
  el texto sobre `accent`, `danger`, `warning` y los colores de instrumento.
- **Panel** (`panel`): contenedores (tabla de biblioteca, mezclador, panel de nueva extracción, dock, paneles laterales,
  avisos flotantes, aviso de actualización) y fondo del campo de búsqueda.
- **Relieve** (`raised`): hover (al 35–60 %), fila actual (al 70 %), botón secundario, opción elegida de un segmentado,
  chips del dock, M/S y «Practicar» en reposo, barras del esqueleto, marcas de posición del mástil.
- **Divisor** (`line`): bordes y divisores de 1 px, carril vacío del fader, pulgar de la barra de desplazamiento, hover
  de lo que ya está en `raised`, trastes del mástil (2 px) y líneas de la tablatura.
- **Tinta** (`ink`): texto principal y títulos, botón de reproducir, pulgar del fader, cabezal del mezclador, línea
  «ahora» de la tablatura, números de traste por tocar y nombre de la cuerda que suena.
- **Tinta 2** (`ink-2`): texto secundario, valores, botones fantasma, volumen de escucha del dock.
- **Tinta 3** (`ink-3`): metadatos, cabeceras de columna, placeholders, iconos en reposo, nombres de cuerda, regla de
  trastes y números de la tablatura ya tocados. Es la última tinta apta para texto: según el propio `index.css`,
  `ink-2` e `ink-3` superan 4.5:1 sobre `surface`, `panel` y `raised`.
- **Tinta 4** (`ink-4`): solo para lo decorativo o deshabilitado: marca de 0 dB, ranura de instrumento no separado,
  pista del spinner, onda de fondo del dock, cuerdas y cejuela del mástil, y texto deshabilitado.

### Named Rules
**Regla de la señal única.** El turquesa significa «acción, foco, progreso o algo que suena o está alterado». No se usa
como decoración, ni en fondos grandes, ni para clasificar. Si algo es turquesa, se puede pulsar o está vivo.

**Regla de la identidad del instrumento.** Cada instrumento tiene un único color (`stem-*`) y ese color no se usa para
nada más. Todo lo nuevo que represente una pista toma su color de `stemStyle(id)`.

**Regla del estado con palabra.** El rojo y el ámbar de estado caen cerca de guitarra y batería en el círculo
cromático. Por eso un estado siempre lleva letra, texto o icono (M/S, «Faltan en el disco», «CPU», icono de alerta) y
nunca es solo un punto de color.

## Typography

**Display Font:** ninguna; la app no usa tipografía de exhibición.
**Body Font:** Segoe UI Variable Text (con Segoe UI Variable, Segoe UI, Inter, system-ui, -apple-system, sans-serif)
**Label/Mono Font:** Cascadia Mono (con JetBrains Mono, SF Mono, ui-monospace, monospace), solo para cifras

**Character:** la sans de interfaz de Windows (Inter en otros equipos) da una interfaz compacta y nativa dentro de la
ventana de Tauri. La mono tabular convierte tiempos, dB y semitonos en lecturas de instrumento que no cambian de ancho.

Los tamaños se escriben en los componentes como valores de Tailwind (`text-[13px]`, `text-xs`…); no hay tokens de
tamaño en el `@theme`. Esta jerarquía es la que está en uso y los nombres son los del frontmatter.

### Hierarchy
- **Headline** (`headline`): título de la extracción en la cabecera del mezclador. Es el único h1.
- **Title** (`title`): título de los paneles laterales («Ajustes», «Exportar») y titular del área de soltar (este,
  con tracking −0.025em).
- **Title small** (`title-sm`): logotipo (con tracking −0.025em), títulos de error y de estado vacío. 14 px es también
  el tamaño raíz del `body`.
- **Item title** (`item-title`): título de cada fila de la biblioteca y de la separación en curso.
- **Body** (`body`): el tamaño de trabajo. Botones, campos, textos de panel, avisos y nombres de pista.
- **Body strong** (`body-strong`): leyendas de grupo («Instrumentos», «Calidad»), títulos de sección en paneles
  laterales y etiqueta del botón primario.
- **Label** (`label`): línea de metadatos bajo cada título, fechas, ayudas, contenido de los paneles laterales,
  píldora del motor.
- **Label small** (`label-sm`): cabeceras de columna (500). En 400, ayudas de las tarjetas de opción; en 600, el botón
  «Practicar»; en 700, las letras M y S; en las teclas `kbd` de los atajos.
- **Numeric** (`numeric`): tiempo del dock («0:04 / 0:52»).
- **Numeric small** (`numeric-sm`): semitonos en tamaño normal, tiempo transcurrido de una separación y, en
  seminegrita, los números de traste de la tablatura y los nombres de cuerda.
- **Numeric xs** (`numeric-xs`): lectura de dB junto a cada fader, valores de los steppers pequeños (semitonos de cada
  pista, tono y tempo del dock), BPM del dock, insignia de semitonos sobre la onda, regla de trastes, afinación del
  resumen («B E A D G») y, en seminegrita, la nota dentro de cada punto del mástil.

### Named Rules
**Regla de las cifras tabulares.** Toda cifra que cambia mientras se mira (tiempo, dB, semitonos, tempo, BPM,
porcentaje, duración) usa `tabular-nums`. Si además es una lectura de instrumento (tiempo del dock, dB, semitonos,
tempo, BPM) va en `font-mono`. Las duraciones y porcentajes de la tabla van en sans tabular.

**Regla del menos tipográfico.** Los valores negativos usan el signo menos (−), no el guion: «−2», «−3.5 dB», «−∞»
(`formatSemitones` y `formatDb` en `src/lib/format.ts`). Los porcentajes llevan espacio antes del signo: «80 %»
(`formatTempo`).

**Regla del suelo de 11 px.** Ningún texto baja de 11 px. La jerarquía se hace con peso y tinta (`ink` → `ink-2` →
`ink-3`), no encogiendo la letra.

## Layout

- **Ventana:** 1180×780 por defecto y mínimo de 920×620 (`src-tauri/tauri.conf.json`). No hay diseño para móvil. La
  interfaz se adapta al ancho de la ventana y, en el dock, con container queries.
- **Estructura vertical fija:** barra superior de 48 px, aviso de actualización opcional de 36 px, área de trabajo
  flexible (biblioteca o mezclador) y dock. Los paneles laterales de 400 px se superponen a la derecha desde debajo de la
  barra superior y no bloquean el resto de la app.
- **Márgenes:** el área de trabajo tiene 20 px laterales; la barra superior y la fila de controles del dock, 16 px; los
  paneles laterales, 20 px.
- **Ritmo:** base de 4 px de Tailwind. Hay 12 px entre bloques, 20 px dentro de los paneles (padding y hueco entre
  columnas), 6–8 px entre controles de un grupo y 2 px entre las acciones de una fila.
- **Biblioteca:** una tabla dentro de un único panel con columnas fijas
  `40px | minmax(0,1fr) | 112px | 60px | 108px | 132px` (`ROW_GRID` en `LibraryRow.tsx`). Las comparten la cabecera,
  las filas, el esqueleto y la fila de la separación en curso. Las filas miden 56 px, separadas por `line` al 70 %. El
  panel de nueva extracción aparece encima, con una rejilla de dos columnas (1 : 1.15): zona de soltar a la izquierda y
  opciones a la derecha.
- **Mezclador:** un único contenedor con desplazamiento, con una columna de controles de 312 px y otra de ondas
  flexible. Cada pista mide al menos 52 px y todas se reparten el alto disponible. Controles y ondas se desplazan juntos.
- **Modo práctica:** ocupa el mismo panel del mezclador, que deja de desplazarse. Arriba, una franja de 60 px con tres
  columnas: la de 312 px con los controles de la pista de bajo (la misma `TrackControls`, alineada con la columna del
  mezclador), el resumen (13 px medio y una línea de 12 px `ink-3` que se recorta con elipsis) y «Todas las pistas»
  como botón fantasma. Debajo, el canvas a todo lo ancho, con 20 px de margen lateral y al menos 256 px de alto:
  - el mástil se lleva el 60 % del alto disponible (entre 112 y 236 px), siempre que la tablatura conserve 20 px
    entre líneas;
  - una columna de 26 px para los nombres de cuerda y otra de 34 px para las notas al aire, antes de la cejuela;
  - trastes con el espaciado real de un bajo suavizado al 55 % (se estrechan hacia el cuerpo) y entre 12 y 24
    trastes visibles según la canción;
  - la tablatura, con líneas separadas entre 20 y 36 px y centrada en su espacio; la línea «ahora» al 16 % del ancho
    y unos 5 s de canción por delante (la escala va de 0,14 a 0,24 px por ms según el ancho).
- **Dock:** una franja de onda de 28 px para desplazarse por la canción y una fila de controles de 56 px (84 px en
  total). Sin nada cargado mide 48 px y muestra una frase guía. Tono y tempo van apilados en un bloque de dos filas de
  24 px (50 px con el hueco de 2 px) dentro de la fila de 56 px. El título se estira pero nunca baja de 7rem, y las
  etiquetas aparecen por container query según el ancho del dock. Los umbrales están calculados para el peor caso,
  siete instrumentos, de modo que el título nunca baja de su mínimo:
  - desde 1000 px, los BPM junto al tempo;
  - desde 1100 px, «Tono», «Tempo» y «Mezclador/Biblioteca»;
  - desde 1160 px, «Exportar»;
  - desde 1240 px, el fader de volumen pasa de 96 a 144 px;
  - desde 1480 px, los nombres dentro de los chips de instrumento.

  Con la ventana mínima todo queda en iconos, sin perder ninguna función.
- **Escalera de alturas de control:** 24 px (M/S, «Practicar», ± de los steppers pequeños: semitonos de pista, tono y
  tempo del dock, cerrar aviso), 28 px (chips, píldora del motor, ± del stepper normal, cerrar panel), 32 px (botones,
  búsqueda, botones de icono, segmentados), 36 px (botón final de
  exportación, filas de la lista de pistas al exportar, aviso de actualización), 40 px (reproducir).

### Named Rules
**Regla del dock fijo.** El transporte vive en el dock en todas las vistas: la vista cambia por encima y el dock no.
Ninguna vista duplica los controles de reproducción, tampoco el modo práctica (en él solo se salta con un clic en la
tablatura, igual que con un clic en las ondas).

**Regla de las mismas columnas.** Todo lo que entra en la tabla de la biblioteca usa `ROW_GRID`. Una fila nueva no
inventa columnas.

## Elevation & Depth

El sistema es plano. La profundidad se consigue con escalones tonales (`surface` → `panel` → `raised`) y bordes de 1 px
en `line`. No hay sombras de elevación: los paneles laterales, los avisos flotantes y los contenedores se separan por
color y borde. `box-shadow` solo aparece como anillo sólido sin difuminado, para separar o señalar.

### Shadow Vocabulary
- **Halo del pulgar** (`box-shadow: 0 0 0 3px var(--color-panel)`): recorta el pulgar blanco del fader sobre su carril.
- **Foco del pulgar** (`box-shadow: 0 0 0 3px var(--color-panel), 0 0 0 5px var(--color-accent)`): foco de teclado del
  fader, en lugar del contorno global.
- **Contorno del cabezal** (`box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35)`): hace legible la línea blanca del cabezal del
  mezclador sobre las ondas de color. La línea «ahora» de la tablatura repite el mismo contorno en canvas (un trazo de
  3 px en `rgb(0 0 0 / 0.35)` bajo el de 1 px en `ink`).
- **Anillo del indicador** (`box-shadow: 0 0 0 2px var(--color-surface)`, `ring-2 ring-surface`): separa el punto de
  «hay una actualización» del icono de ajustes.

La única capa translúcida es la superposición de arrastrar y soltar (`surface` al 85 % con `backdrop-blur-sm` y borde
discontinuo de 2 px en `accent`). Solo aparece mientras se arrastra un archivo sobre la ventana.

### Named Rules
**Regla del difuminado cero.** En AudioExtract una sombra tiene difuminado 0: es un anillo, nunca una nube. La elevación
se expresa subiendo un escalón tonal.

## Shapes

Las esquinas son redondeadas en toda la interfaz y el radio se escalona según el tamaño del objeto:

| Radio | Dónde se usa |
| --- | --- |
| 16 px (`2xl`) | Paneles grandes: biblioteca, mezclador, nueva extracción, superposición de soltar. |
| 12 px (`xl`) | Tarjetas de opción, pozos de los segmentados, zona de soltar, avisos flotantes. |
| 8 px (`lg`) | Botones, campos, botones de icono, grupo de semitonos, pozos de texto, diapasón del mástil. |
| 6 px (`md`) | Chips del dock, M/S, «Practicar», botones ±, campo de renombrar, caja de la mano, número de la tablatura que suena. |
| 4 px (`sm`) | Teclas `kbd` y barras del esqueleto. |
| Redondo (`full`) | Reproducir y detener, puntos de instrumento, carril y pulgar del fader, barras del ecualizador, píldora del motor, barras de progreso, pulgar de la barra de desplazamiento, notas y marcas de posición del mástil, barras de duración de la tablatura. |

- **Bordes:** 1 px en `line` para los contenedores; 2 px discontinuo solo en las zonas de soltar; 2 px sólido en los
  anillos de instrumento.
- **Iconos:** lineales y propios (`icons.tsx`): caja de 24, trazo de 1.8, extremos y uniones redondeados y
  `currentColor`. Solo van rellenos reproducir, pausa y detener.
- **Forma de onda:** barras simétricas de 2 px con 1 px de separación, dibujadas en canvas con el `color` CSS del
  propio elemento.
- **Mástil:** geometría pura en canvas, sin imagen ni textura de madera. Cuerdas de grosor decreciente (2,8 → 1,3 px,
  la más grave abajo y la más aguda arriba, como en una tablatura), trastes de 2 px, cejuela de 4 px y marcas de
  posición en los trastes 3, 5, 7, 9, 15, 17, 19 y 21 (dobles en el 12 y el 24).
- **Firma:** el ecualizador de la fila que suena repite las barras redondeadas del icono de la app (`app-icon.svg`).

### Named Rules
**Regla del radio anidado.** Lo que va dentro tiene menos radio que lo que lo contiene: panel 16 → tarjeta o
segmentado 12 → botón 8 → chip 6.

## Components

### Botones
- **Forma:** rectángulo con 8 px de radio. Mide 32 px de alto en las barras y 36 px como botón final de un panel lateral.
- **Primario:** `accent` con texto `surface` en 13 px seminegrita. Hover con brillo al 110 % y pulsado al 95 %
  (transición de `filter`). Hay uno por contexto: «Nueva extracción» en la barra, «Exportar…» al pie del panel de
  exportación, «Instalar y reiniciar» en el aviso de actualización (ahí en versión compacta, con 6 px de radio, porque
  la barra mide 36 px).
- **Secundario:** `raised` con texto `ink`; en hover, `line`. Para recuperar, comprobar o ajustar («Comprobar de
  nuevo», «Reintentar» de la biblioteca, «Abrir», «Cambiar carpeta…», «Mezclador/Biblioteca» del dock). Dentro de los
  paneles laterales baja a 12 px.
- **Fantasma:** sin fondo y con texto `ink-2`; en hover, fondo `raised` y texto `ink`. Por ejemplo «Restablecer»,
  «Mostrar archivos», «Exportar» del dock o «Cancelar».
- **Icono:** 32×32 (o 28 y 24 donde no cabe más), en `ink-3`; en hover, `raised` e `ink`. Siempre con `aria-label`
  y `title`.
- **Acción de pista:** botón con texto de 24 px, 6 px de radio, `raised` con texto `ink-2` en 11 px seminegrita; en
  hover, `line` e `ink`. Pertenece a la familia de M/S, pero es una acción, no un conmutador. Lo lleva solo la pista que
  la tiene, entre el nombre y los semitonos: «Practicar» en el bajo. Con texto, no con icono: a 16 px un icono de
  mástil se lee como una almohadilla.
- **Peligro:** `danger` con texto `surface` en 12 px seminegrita, solo en la confirmación de eliminar dentro de la fila.
- **Transporte:** reproducir es un círculo de 40 px en `ink` con icono `surface` (hover a escala 1.05, pulsado a 0.95).
  Detener es un círculo fantasma de 32 px.
- **Deshabilitado:** opacidad al 45–60 % o texto `ink-4`, y sin eventos de puntero.

### Chips de instrumento (dock)
- **Estilo:** controles con borde de 28 px de alto y 6 px de radio, uno por pista, en el orden fijo de los
  instrumentos. Llevan el punto de 10 px del instrumento y, desde 1480 px de ancho de dock, su nombre en 12 px.
- **Estado:** si suena, borde `line`, fondo `raised` al 70 % y punto sólido. Si está silenciado, borde `line` al 70 %,
  sin fondo, anillo al 55 % y nombre tachado en `ink-4`. Si no suena porque otra pista está en solo, el punto queda
  relleno al 40 %.
  Usan `aria-pressed` y el `title` explica el estado y la acción.

### Tarjetas de opción (nueva extracción)
- **Estilo:** 12 px de radio, borde `line` y padding de 10×12 px. Nombre en 13 px medio y ayuda en 11 px `ink-3`.
- **Estado:** la elegida lleva borde al 60–70 % y fondo al 10 % del color que representa (su `--stem` si es un
  instrumento, `accent` si es una calidad). Sin elegir, en hover, borde `ink-4` y `raised` al 50 %. Los instrumentos
  son botones con `aria-pressed`; las calidades, un `radiogroup`. Si el motor no las ofrece, quedan deshabilitadas al
  45 % con un `title` que explica por qué.

### Segmentado (exportación)
- **Estilo:** pozo `surface` con 12 px de radio y 4 px de padding; opciones de 32 px de alto con 8 px de radio.
- **Estado:** la elegida en `raised`, `ink` y peso medio; el resto en `ink-3` y, en hover, `ink-2`. Es un
  `radiogroup`.

### Contenedores / Paneles
- **Corner Style:** 16 px.
- **Background:** `panel`.
- **Shadow Strategy:** ninguna (ver Elevation & Depth).
- **Border:** 1 px `line`; en un error, `danger` al 30 %.
- **Internal Padding:** 20 px, o 0 cuando dentro hay una tabla con sus propios divisores.
- **Pozos internos** (rutas, notas de versión, nombre de archivo, código de error): `surface` al 60 % (o `surface`
  sólido para código), 8 px de radio, padding de 8 a 12 px, texto de 12 px seleccionable.
- **Panel lateral** (`Sheet`): 400 px, `panel`, borde izquierdo `line`, cabecera y pie con divisor y secciones con
  título de 13 px seminegrita separadas 28 px. Entra desde la derecha (24 px más fundido, 220 ms). Esc lo cierra y
  devuelve el foco. No bloquea la app: el reproductor sigue respondiendo detrás.
- **Aviso flotante:** abajo a la izquierda, justo por encima del dock. Es un `panel` con borde `line` (`danger` al
  40 % si es un error), 12 px de radio y texto de 13 px. Se cierra solo a los 6 s.

### Inputs / Fields
- **Búsqueda:** 32 px, fondo `panel`, borde transparente que pasa a `line` en hover y a `accent` al 60 % con el foco.
  Lleva el icono en `ink-3` a la izquierda y la tecla «Ctrl K» a la derecha.
- **Renombrar en línea:** 28 px, fondo `surface`, borde `accent` al 60 %, 6 px de radio. Intro guarda y Esc cancela.
- **Casillas nativas:** toman `accent-color`: el acento en general y el color del instrumento en la lista de pistas
  de exportación.
- **Foco:** contorno global de 2 px en `accent` desplazado 2 px (`:focus-visible` en `index.css`). El fader lo
  sustituye por su anillo propio.

### Navigation
- **Barra superior** (48 px, `surface`, borde inferior `line`): logotipo («Audio» en `ink-2` y «Extract» en `accent`,
  14 px seminegrita), búsqueda y, a la derecha, la píldora del motor, ajustes y el botón primario. La píldora del motor
  lleva un punto de 6 px: `accent` con GPU, `warning` en CPU, `danger` si no está disponible y `ink-4` con pulso
  mientras se comprueba.
- **Biblioteca y mezclador** se alternan desde el dock (botón «Mezclador/Biblioteca», tecla M o clic en el título),
  con doble clic en una fila y con el botón «Biblioteca» (icono de flecha atrás) en la cabecera del mezclador. No hay pestañas ni barra lateral.

### Fila de biblioteca (firma)
- **Estilo:** 56 px de alto con las columnas de `ROW_GRID`. La fila actual va en `raised` al 70 %; en hover, `raised`
  al 35 % (100 ms).
- **Primera columna:** vacía en reposo y con el icono de reproducir en hover. La fila que suena muestra el ecualizador: cuatro barras
  turquesa de 3 px (alturas al 60/100/80/45 %) que laten solo mientras suena.
- **Título:** 13.5 px medio en `ink`. Debajo, en 12 px `ink-3`: calidad · acelerador · archivo, o el aviso en ámbar
  si faltan pistas.
- **Franja de instrumentos:** siete ranuras fijas de 10 px, una por instrumento en su orden. Punto sólido si existe,
  anillo de 1 px en `ink-4` al 60 % si no se separó, y al 30 % si falta en el disco.
- **Duración y fecha:** duración en 13 px `ink-2` tabular, alineada a la derecha; fecha en 12 px `ink-3`.
- **Acciones:** exportar, carpeta, renombrar y eliminar, como botones de icono de 32 px. Están invisibles hasta el
  hover o `focus-within`; eliminar se vuelve `danger` en hover. Renombrar y eliminar se resuelven dentro de la propia
  fila.
- **Fila en curso:** mismas columnas, fondo `accent` al 4 %, spinner, anillos de los instrumentos pedidos, porcentaje
  y una barra de progreso de 2 px pegada al borde inferior. Si falla, se convierte en un bloque `danger` al 5 % con el
  error en mono y «Reintentar / Descartar».

### Fader (firma)
- **Estilo:** `input[type=range]` nativo con la clase `.fader`. El carril es redondo, de 4 px, pintado con `--stem`
  (o `accent`) hasta `--fill` y con `line` el resto. El pulgar es blanco, de 14 px, con halo `panel` de 3 px, y en
  hover o al arrastrar crece a 1.15 (120 ms).
- **0 dB:** una marca de 1 px en `ink-4`, de 10 px de alto, sobre el 75 % del carril (`UNITY_FADER`). Doble clic
  vuelve a 0 dB.
- **En el mezclador:** justo debajo del carril va el vúmetro de 3 px sobre `surface`, con el nivel en el color de la
  pista, una marca de retención de pico de 2 px en `ink-2` y relleno `danger` cuando satura. Al final de la misma fila
  va la lectura en mono 11 px `ink-3` («0.0 dB»), en una columna fija de 56 px.
- **En el dock:** el volumen de escucha usa el mismo fader teñido con `ink-2`, porque no es un instrumento.
- **Orientación:** siempre horizontal. Crece a lo ancho, nunca a lo alto.

### Stepper (semitonos y tempo)
- **Estilo:** grupo −/valor/+ sobre `surface` al 70 % con 8 px de radio (`Stepper`). Los botones miden 28 px (24 px en
  tamaño pequeño). El valor va en mono tabular (12 px u 11 px): `ink-2` en el valor original y `accent` seminegrita
  cuando se aparta de él. Tiene un ancho mínimo para que los botones no se muevan al cambiar de cifra.
- **Semitonos** (`SemitoneControl`, −12…+12): flechas ±1, RePág/AvPág ±12. Original: 0.
- **Tempo** (`TempoControl`, 50–150 %): flechas ±5 %, RePág/AvPág ±25 %. Original: 100 %. El valor lleva su unidad
  («80 %») y un ancho mínimo de 5,5ch.
- **Teclado:** es un `spinbutton`. Inicio/Fin van a los extremos y 0, Supr, Retroceso o doble clic vuelven al valor
  original. Los botones dicen qué hacen («Bajar un semitono (Voces)», «Más lento (−5 %)»).
- **En la onda:** la insignia de semitonos efectivos (mono 11 px en `accent` sobre `surface` al 85 %) aparece solo si
  el valor es distinto de 0.

### Tono y tempo (dock)
- **Bloque:** dos filas apiladas, tono arriba y tempo abajo, con un `role="group"` común. Cada fila lleva su icono de
  14 px en `ink-3` (nota musical; metrónomo dibujado con el mismo trazo de 1.8), la etiqueta en 12 px en una columna de
  40 px desde 1100 px, y un stepper pequeño. Los dos steppers tienen el mismo ancho, así que forman una columna.
- **BPM:** a la derecha del tempo, los BPM que suenan (los estimados por el porcentaje), con la cifra en mono 11 px
  `ink-2` y «BPM» en 11 px `ink-3`. No usa el acento: lo alterado ya lo marca el porcentaje. La ayuda dice que es una
  estimación a partir de las pistas y que puede ser el doble o la mitad del pulso. Si la canción no tiene pulso claro,
  no aparece.
- **Cabecera del mezclador:** la línea de metadatos añade los BPM estimados de la canción en `ink-3` («· 92 BPM») y,
  en `accent`, «· tono global +2» y «· tempo 80 %» cuando cambian. «Restablecer» también devuelve el tempo al 100 %.
- **Exportación:** el nombre de archivo describe los cambios entre paréntesis («… - mezcla (tono +2, tempo 80 %).wav»)
  y, con otro tempo, el panel dice cuánto dura el resultado frente a la original.

### Pista del mezclador
- **Controles** (columna de 312 px): punto del instrumento, nombre en 13 px medio, semitonos en tamaño pequeño y los
  botones M y S (24 px, 6 px de radio, 11 px negrita; en reposo `raised`/`ink-3`, activos en `danger` o `warning` con
  texto `surface`). Debajo, el fader con su vúmetro y la lectura de dB.
- **Onda:** en el color de la pista, con la base al 35 % y la parte reproducida al 100 % (recorte con `--progress`).
  Una pista inaudible deja los controles al 55 % y la onda al 30 % en escala de grises.
- **Cabezales:** el del mezclador es una línea de 1 px en `ink` con contorno negro. El del dock es una línea de 1 px
  en `accent` sobre una onda neutra (`ink-4`, con lo reproducido en `ink-2`).

### Modo práctica (mástil y tablatura)
Un instrumento de lectura, no un decorado: todo lo que se mueve dice qué tocar, dónde y cuándo.
- **Franja superior** (`practice-strip`): los controles de la pista de bajo tal cual están en el mezclador (con su
  vúmetro vivo), «Bajo de N cuerdas» en 13 px medio seguido de la afinación en mono 11 px `ink-3`, y debajo
  «N notas · transcripción automática», con «tablatura transpuesta ±N» en `accent` cuando hay semitonos y «N notas
  cambiadas de octava» si alguna no cabe. Los detalles largos van en `title`.
- **Mástil** (`fretboard`): diapasón `surface` con 8 px de radio sobre el `panel`; regla de trastes debajo, en
  mono 11 px `ink-3`, solo en los trastes con marca y en el 1. La nota que suena es un punto `stem-bass`
  (`fretboard-note`, radio de hasta 13 px) con su nombre sin octava («C#») en `surface`, si cabe; la cuerda que vibra se
  tiñe desde el traste pisado y su nombre pasa a `ink`. Las siguientes (hasta 3) son anillos. Las notas al aire se
  dibujan antes de la cejuela.
- **Caja de la mano:** franja `stem-bass` al 10 % con borde al 40 % y 6 px de radio sobre cuatro trastes, por debajo
  de cuerdas y trastes. Se desliza a la caja nueva con un suavizado exponencial (constante de 45 ms).
- **Tablatura:** una línea `line` por cuerda, en el mismo orden que el mástil. Cada nota es su número de traste en mono
  12 px seminegrita sobre un recorte `panel` que interrumpe la línea, como en una tablatura impresa, seguido de su
  barra de duración. La que suena es una píldora `stem-bass` de 18 px (`tab-fret-current`); las tocadas quedan en
  `ink-3`. Avanza hacia la línea «ahora» y un clic salta a ese momento (cursor de mano solo sobre la tablatura).
- **Movimiento:** un destello de ataque al empezar cada nota (anillo que crece 7 px y se apaga en 180 ms). En pausa,
  al saltar o con `prefers-reduced-motion`, todo se coloca de golpe y no hay bucle de animación.
- **Estados:** transcribiendo (spinner y una frase que explica que la primera vez tarda unos segundos, con
  aparición retardada), error (bloque `danger` con el mensaje seleccionable y «Reintentar» secundario) y sin notas
  (texto centrado).
- **Accesibilidad:** el canvas es `role="img"` con una descripción del mástil, la afinación y el clic en la
  tablatura; el transporte sigue en el dock y en el teclado.

### Estados de carga, vacío y error
- **Spinner:** círculo de 14 px con borde de 2 px en `ink-4` y el arco superior en `accent`.
- **Esqueleto:** barras `raised` (y `raised` al 70 %) con pulso, en las mismas columnas de la tabla.
- **Espera que puede no serlo:** un aviso de espera que a menudo se resuelve al instante (abrir el modo práctica con
  las notas ya guardadas) aparece con 220 ms de retardo y un fundido de 160 ms (`.reveal-late`), para no parpadear.
- **Vacío:** texto centrado. En el primer uso aparece abierto el panel de nueva extracción y el dock explica que la
  escucha estará ahí.
- **Errores:** siempre dicen qué pasó y qué hacer, con una acción de recuperación al lado («Reintentar», «Comprobar de
  nuevo»). El texto del error es seleccionable.

## Do's and Don'ts

### Do:
- **Do** usar los tokens de `src/index.css` mediante utilidades de Tailwind (`bg-panel`, `text-ink-3`, `border-line`, `bg-accent/10`); un color nuevo se añade primero al `@theme`.
- **Do** pintar todo lo que represente una pista con su `--stem` mediante `stemStyle(id)` y respetar el orden de `STEM_ORDER`.
- **Do** reservar el acento para la acción primaria, el foco, el progreso y lo que suena o está alterado, con el texto sobre el acento en `surface`.
- **Do** expresar jerarquía y profundidad con el siguiente escalón tonal (`surface` → `panel` → `raised` → `line`) y bordes de 1 px.
- **Do** escribir el texto en `ink`, `ink-2` o `ink-3`, y dejar `ink-4` solo para lo decorativo o deshabilitado.
- **Do** usar mono tabular para tiempos, dB, semitonos, tempo y BPM, con el signo − tipográfico.
- **Do** reutilizar `Fader`, `Stepper` (con `SemitoneControl` y `TempoControl`), `Sheet`/`SheetSection`, `ROW_GRID` y `stemStyle` antes que crear variantes.
- **Do** dar `aria-label` y `title` a cada botón de solo icono, y hacer que las acciones ocultas aparezcan también con `focus-within`.
- **Do** mantener las transiciones de estado cortas (100–220 ms) y comprobar que `prefers-reduced-motion` las anula.
- **Do** dibujar en canvas con los tokens leídos de las variables CSS (`getComputedStyle`), a la resolución del dispositivo, cacheando lo estático y sin bucle de animación cuando nada se mueve.

### Don't:
- **Don't** usar sombras de elevación ni sombras difuminadas en paneles, paneles laterales o avisos: un `box-shadow` solo puede ser un anillo sin difuminado.
- **Don't** usar los colores de instrumento para estados, botones o decoración, ni el rojo o el ámbar de estado para representar instrumentos.
- **Don't** comunicar un estado solo con color: M/S llevan letra y los avisos llevan texto o icono.
- **Don't** introducir un segundo color de acento.
- **Don't** poner faders en vertical ni controles que crezcan a lo alto en el mezclador.
- **Don't** convertir las listas de extracciones o de pistas en rejillas de tarjetas: son filas con columnas fijas.
- **Don't** hacer translúcidos los paneles: la translucidez queda reservada a la superposición de arrastrar y soltar.
- **Don't** poner texto blanco sobre `accent`, `danger` o `warning`: va en `surface`.
- **Don't** bajar de 11 px en ningún texto.
