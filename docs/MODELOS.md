# Modelos de separación

AudioExtract no entrena modelos: usa modelos abiertos y elige cuál ejecutar según los instrumentos y
la calidad que pidas. El usuario elige **instrumentos**, no modelos.

## Qué modelo se usa

| Petición | Calidad rápida | Calidad máxima |
| --- | --- | --- |
| Voces, batería, bajo, otros | Demucs `htdemucs` | BS-RoFormer SW |
| + guitarra y/o piano | Demucs `htdemucs_6s` | BS-RoFormer SW |
| + viento | segunda pasada con UVR `17_HP-Wind_Inst` sobre la pista «otros» | igual |

Reglas:

- Lo que el modelo separa pero no se pidió (p. ej. la guitarra si solo pediste piano) se suma a «otros».
- El viento se extrae de «otros» y el resto se calcula **por diferencia** (`otros = otros − viento`),
  así que viento + otros reproducen exactamente la pista «otros» original.
- Todas las pistas se guardan con una **única ganancia común** si alguna saturaría, para no alterar el
  balance entre ellas. Antes de pasar audio a audio-separator se deja un margen conocido y se deshace
  al leer, para que su normalización interna nunca actúe.

## Los modelos

| Clave (`catalog.py`) | Modelo | Pistas | Tamaño | Origen |
| --- | --- | --- | --- | --- |
| `htdemucs` | Hybrid Transformer Demucs v4 | voces, batería, bajo, otros | ~80 MB | [facebookresearch/demucs](https://github.com/facebookresearch/demucs) (MIT) |
| `htdemucs_6s` | Demucs v4, 6 fuentes | + guitarra, piano | ~55 MB | ídem |
| `htdemucs_ft` | Demucs v4 afinado (opcional) | 4 pistas, ~4× más lento | ~320 MB | ídem |
| `bs_roformer_sw` | BS-RoFormer SW (jarredou) | voces, batería, bajo, guitarra, piano, otros | 700 MB | vía [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator) (MIT) |
| `uvr_wind` | UVR `17_HP-Wind_Inst` (VR Arch) | viento / resto | 224 MB | [Ultimate Vocal Remover](https://github.com/Anjok07/ultimatevocalremovergui) vía audio-separator |

Calidad publicada (SDR en dB, más es mejor; conjunto Multisong de MVSEP):

| | Voces | Batería | Bajo | Guitarra | Piano | Otros |
| --- | --- | --- | --- | --- | --- | --- |
| BS-RoFormer SW ([MVSEP](https://mvsep.com/algorithms/77)) | 11,3 | 14,1 | 14,6 | 9,1 | 7,8 | 8,7 |
| htdemucs (audio-separator) | 9,9 | 9,4 | 11,6 | — | — | — |

Los autores de Demucs advierten que el piano de `htdemucs_6s` «no funciona muy bien»: para piano,
usa la calidad máxima.

## Tiempos medidos

Canción de prueba de 3 minutos, contenedor Docker sin red, incluyendo arrancar el contenedor y cargar
los modelos:

| Configuración | RTX 3060 (12 GB) | CPU (12 hilos) |
| --- | --- | --- |
| Rápida, 4 pistas | 16 s | 52 s |
| Rápida, 6 pistas | 24 s | — |
| Máxima + viento, 7 pistas | 2 min 9 s | ~3,3 min por minuto de canción¹ |
| Solo la pasada de viento | 18 s | ~33 s por minuto de canción¹ |

¹ Extrapolado de un fragmento de 30 s. La VRAM máxima medida fue de 1,5 GB (BS-RoFormer) y 1,2 GB (viento).

La app muestra estimaciones por minuto de canción a partir de estas medidas; en tu equipo pueden variar.

## Límites conocidos

- **Viento** reúne metales y maderas (trompetas, trombones, saxos, flautas, clarinetes…) en una sola
  pista: el modelo no los distingue entre sí. Su calidad es menor que la de las pistas principales y
  puede dejar parte en «otros».
- Instrumentos que no tienen pista propia (cuerdas, sintetizadores, percusión latina…) van a «otros».
- Las pistas se guardan en WAV 16 bits / 44,1 kHz, estéreo.
- Los pesos de audio-separator y UVR se publican para uso con sus herramientas; revisa sus términos
  antes de un uso comercial.

## Transcripción del bajo (modo práctica)

[Basic Pitch](https://github.com/spotify/basic-pitch) de Spotify (Apache 2.0) convierte la pista de
bajo en notas. Se usa su versión **ONNX**, que viene dentro del paquete `basic-pitch` (no descarga
pesos) y corre con onnxruntime en CPU: una canción de 4 min 27 s se transcribió en 5,7 s más 0,8 s de
carga, dentro del contenedor sin red. No necesita TensorFlow ni GPU, así que no compite con una
separación.

- `basic-pitch` 0.4.0 se instala con `--no-deps`: para Python ≥ 3.11 declara TensorFlow < 2.15.1, que
  no existe para Python 3.12. Sus dependencias reales están en `python/requirements-transcription.txt`.
- `transcribe.py` limita la búsqueda al rango del bajo (29–420 Hz: de B0 al traste 24 de la cuerda G) y
  reduce la salida, polifónica, a una línea monofónica: si dos notas suenan a la vez se queda la más
  fuerte, con ventaja para la grave cuando la aguda está a una octava, octava + quinta o dos octavas
  (los armónicos típicos del bajo); los solapes cortos entre notas ligadas se recortan, y se descartan
  las notas de menos de 80 ms. En la canción de prueba, 753 notas en bruto quedaron en 591.
- Límites: fragmentos de ataque, notas fantasma y octavas equivocadas siguen siendo posibles, sobre
  todo con una pista de bajo poco limpia. La separación en calidad máxima da un bajo más limpio.

## Añadir o quitar modelos de la imagen

La lista de modelos incluidos es un argumento de construcción:

```powershell
docker build -f docker/engine.Dockerfile --build-arg MODELS="htdemucs htdemucs_6s uvr_wind" -t audioextract-engine python
```

La app pregunta al motor qué tiene (`separate.py --check`) y solo ofrece lo disponible: sin
`bs_roformer_sw` desaparece la calidad máxima; sin `uvr_wind`, el viento; sin `htdemucs_6s`, la
guitarra y el piano en calidad rápida.

Para añadir un modelo nuevo de audio-separator, regístralo en `SEPARATOR_MODELS` de
[`python/catalog.py`](../python/catalog.py) (archivo y correspondencia de pistas) y úsalo en el plan de
[`python/separate.py`](../python/separate.py).
