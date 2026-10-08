#!/usr/bin/env python3
"""Transcribe la pista de bajo de una extracción a notas, para el modo práctica de AudioExtract.

Sigue las reglas de `separate.py`: la app lo lanza como proceso hijo (motor integrado,
Python local o Docker), stdout queda reservado al protocolo (una línea JSON por
mensaje) y todo lo demás —el `print` de Basic Pitch, avisos de librerías— va a stderr.

    {"type": "done",  "model": "basic_pitch", "notes": [
                        {"note": "C#2", "frequency": 69.3, "startTimeMs": 1200, "endTimeMs": 1500}, ...]}
    {"type": "error", "message": "..."}

El modelo es Basic Pitch (Spotify, Apache 2.0) en su versión ONNX, que viene
dentro del paquete: no descarga nada y no necesita TensorFlow ni GPU (una canción
de 4–5 minutos tarda unos segundos en CPU). Si la imagen del motor no lo trae, se
usan las ruedas que la app instala junto a este script (`AUDIOEXTRACT_WHEELS`).

Basic Pitch es polifónico y en un bajo suele detectar también armónicos (la
octava o la quinta por encima de la nota real) y pequeños solapes entre notas
ligadas. `to_bass_line` lo reduce a la línea monofónica que se toca.

Uso manual:
    python transcribe.py --input bass.wav
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import traceback
from pathlib import Path
from typing import Any, Iterable, NamedTuple

# El stdout real queda reservado para el protocolo (ver separate.py).
_PROTOCOL = sys.stdout
sys.stdout = sys.stderr

# Al importarse, Basic Pitch avisa con `logging.warning` de cada backend que no
# está instalado (TensorFlow, CoreML, TFLite): ruido que taparía un error real en
# las últimas líneas de stderr que la app guarda.
logging.basicConfig(level=logging.ERROR, stream=sys.stderr)

import catalog  # noqa: E402 - después de proteger stdout

MODEL = "basic_pitch"

# Rango del bajo: de B0 (30,87 Hz, cuerda grave de un bajo de 5) a G4 (392 Hz,
# traste 24 de la cuerda G), con medio semitono de margen. Fuera de él casi todo
# son armónicos o ruido de la separación.
MIN_FREQUENCY_HZ = 29.0
MAX_FREQUENCY_HZ = 420.0
# Basic Pitch descarta por defecto las notas de menos de 128 ms; en un bajo, las
# semicorcheas a tempo rápido duran menos.
MIN_NOTE_MS = 80.0

# Dos notas que se solapan al menos esta fracción de la más corta suenan a la vez.
CONFLICT_OVERLAP = 0.5
# Intervalos (semitonos) en los que la nota aguda suele ser un armónico de la grave:
# octava, octava + quinta y dos octavas. La grave tiene ventaja al decidir cuál se queda.
HARMONIC_INTERVALS = frozenset({12, 19, 24})
HARMONIC_BONUS = 1.5
# Tras recortar solapes se aplica el mismo mínimo que al modelo: lo que queda más
# corto suele ser el transitorio del ataque, no una nota (y una sola nota grave
# espuria bastaría para pedir un bajo de 5 cuerdas).
MIN_LINE_NOTE_SECONDS = MIN_NOTE_MS / 1000

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def emit(kind: str, **payload: Any) -> None:
    _PROTOCOL.write(json.dumps({"type": kind, **payload}) + "\n")
    _PROTOCOL.flush()


class Note(NamedTuple):
    start: float  # segundos
    end: float
    pitch: int  # MIDI
    amplitude: float


def note_name(pitch: int) -> str:
    """Notación científica: MIDI 37 → «C#2», MIDI 69 → «A4»."""
    return f"{NOTE_NAMES[pitch % 12]}{pitch // 12 - 1}"


def frequency(pitch: int) -> float:
    return 440.0 * 2 ** ((pitch - 69) / 12)


def weight(note: Note, rival: Note) -> float:
    """Amplitud, con ventaja para la fundamental frente a su posible armónico."""
    return note.amplitude * (HARMONIC_BONUS if rival.pitch - note.pitch in HARMONIC_INTERVALS else 1.0)


def to_bass_line(events: Iterable[Note]) -> list[Note]:
    """Reduce la salida polifónica de Basic Pitch a una línea monofónica.

    Recorre las notas por orden de inicio. Si una se solapa con la anterior:
    - poco (notas ligadas): la anterior termina donde empieza la nueva;
    - mucho (suenan a la vez): se queda la de más peso; si gana la nueva, la anterior
      se corta en su inicio o desaparece si apenas había sonado.
    """
    line: list[Note] = []
    for note in sorted(events, key=lambda n: (n.start, n.pitch)):
        if line and (overlap := min(line[-1].end, note.end) - max(line[-1].start, note.start)) > 0:
            last = line[-1]
            shorter = min(last.end - last.start, note.end - note.start)
            if overlap >= CONFLICT_OVERLAP * shorter and weight(note, last) <= weight(last, note):
                continue
            if note.start - last.start >= MIN_LINE_NOTE_SECONDS:
                line[-1] = last._replace(end=note.start)
            else:
                line.pop()
        line.append(note)
    return [note for note in line if note.end - note.start >= MIN_LINE_NOTE_SECONDS]


def to_message(note: Note) -> dict[str, Any]:
    return {
        "note": note_name(note.pitch),
        "frequency": round(frequency(note.pitch), 2),
        "startTimeMs": round(note.start * 1000),
        "endTimeMs": round(note.end * 1000),
    }


def transcribe(input_path: Path) -> list[Note]:
    # Basic Pitch puede venir de la imagen o de las ruedas que instala la app (ver catalog.py).
    catalog.use_bundled_wheels()
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model, predict

    # Siempre el modelo ONNX: el mismo resultado en Docker, Windows y macOS, sin TensorFlow.
    model = Model(build_icassp_2022_model_path(FilenameSuffix.onnx))
    _, _, events = predict(
        input_path,
        model,
        minimum_frequency=MIN_FREQUENCY_HZ,
        maximum_frequency=MAX_FREQUENCY_HZ,
        minimum_note_length=MIN_NOTE_MS,
    )
    # Cada evento: (inicio s, fin s, nota MIDI, amplitud, curvas de pitch bend).
    return to_bass_line(Note(float(start), float(end), int(pitch), float(amplitude)) for start, end, pitch, amplitude, *_ in events)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcripción de una pista de bajo a notas (modo práctica).")
    parser.add_argument("--input", required=True, help="Pista de bajo (bass.wav de una extracción)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        input_path = Path(args.input)
        if not input_path.is_file():
            raise FileNotFoundError(f"No existe la pista de bajo: {input_path}")
        notes = transcribe(input_path)
        emit("done", model=MODEL, notes=[to_message(note) for note in notes])
        return 0
    except ModuleNotFoundError as error:
        if catalog.offline():
            message = f"El motor no incluye la transcripción del bajo. {catalog.repair_hint()}"
        else:
            message = (
                f"Falta el paquete «{error.name}» en {sys.executable}. Instala la transcripción con: "
                "pip install --no-deps basic-pitch==0.4.0 && pip install -r python/requirements-transcription.txt"
            )
        emit("error", message=message)
    except Exception as error:  # noqa: BLE001 - todo error debe llegar a la app
        traceback.print_exc()
        emit("error", message=f"{type(error).__name__}: {error}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
