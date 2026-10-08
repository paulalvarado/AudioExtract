#!/usr/bin/env python3
"""Separa una canción en pistas por instrumento para AudioExtract.

La app de Tauri lanza este script como proceso hijo (dentro de Docker o con un
Python local) y lee su stdout. Cada mensaje es una línea JSON:

    {"type": "device",       "device": "cuda", "name": "NVIDIA GeForce RTX 3060"}
    {"type": "capabilities", "protocol": 2, "engine": "2.1.0", "wind": true, "transcription": true,
                             "qualities": {"fast": ["guitar", "piano"], "best": ["guitar", "piano"]}}
    {"type": "progress",     "percent": 42.0, "stage": "separating"}
    {"type": "log",          "message": "..."}
    {"type": "done",         "stems": ["vocals", "drums", ...], "sampleRate": 44100,
                             "frames": 9261000, "models": ["bs_roformer_sw", "uvr_wind"]}
    {"type": "error",        "message": "..."}

`capabilities` solo se emite con --check; `transcription` dice si este motor
también trae transcribe.py (notas del bajo para el modo práctica). Todo lo demás
(avisos de Torch, descargas, logs de audio-separator) va a stderr.

Calidades:
    fast  Demucs v4: htdemucs (4 pistas), o htdemucs_6s si se pide guitarra o piano.
    best  BS-RoFormer SW: 6 pistas, bastante más limpio pero ~4× más lento (~9× en CPU).
El viento (trompetas, saxos, flautas…) se extrae después de la pista «otros».
Lo que se separa sin haberse pedido vuelve a «otros».

Uso manual:
    python separate.py --input cancion.mp3 --output ./stems --instruments guitar,piano,wind --quality best
    python separate.py --check        # acelerador y modelos disponibles
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import platform
import shutil
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any, Callable, Iterable, Iterator, TypeVar

# Tiene que definirse antes de importar torch: en Apple Silicon, las
# operaciones que Metal (MPS) no implementa caen a CPU en lugar de fallar.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

# El stdout real queda reservado para el protocolo. Cualquier print de una
# librería acaba en stderr y no puede corromper las líneas JSON.
_PROTOCOL = sys.stdout
sys.stdout = sys.stderr

import catalog  # noqa: E402 - después de proteger stdout

ENGINE_VERSION = "2.1.0"
PROTOCOL_VERSION = 2
SAMPLE_RATE = 44100

BASE_STEMS = ("vocals", "drums", "bass", "other")
OPTIONAL_STEMS = ("guitar", "piano", "wind")
STEM_ORDER = ("vocals", "drums", "bass", "guitar", "piano", "wind", "other")

# Pico al que se lleva el audio antes de pasarlo a audio-separator: así ninguna
# salida supera 1.0, nada se normaliza ni se recorta, y al deshacer la ganancia
# el balance entre pistas queda intacto.
HEADROOM_PEAK = 0.5

# Coste relativo de cada paso (medido en una RTX 3060 y en 12 hilos de CPU), para
# repartir la barra de progreso entre la separación principal y el viento.
GPU_COST = {"fast": 1.0, "best": 4.0, "wind": 1.5}
CPU_COST = {"fast": 1.0, "best": 9.0, "wind": 1.3}

# Tramos de la fase que ocupa cada bucle `tqdm` de audio-separator, en orden de
# ejecución. VR: bandas y ventanas (rápidos) antes de la inferencia (lo lento).
LOOP_SPANS = {
    "bs_roformer_sw": [(0.0, 1.0)],
    "uvr_wind": [(0.05, 0.08), (0.08, 0.12), (0.12, 1.0)],
}

T = TypeVar("T")


class EngineSetupError(Exception):
    """Falta un modelo o un paquete: el mensaje ya dice cómo arreglarlo."""


def emit(kind: str, **payload: Any) -> None:
    _PROTOCOL.write(json.dumps({"type": kind, **payload}) + "\n")
    _PROTOCOL.flush()


class Progress:
    """Convierte el avance de cada fase en un porcentaje global, sin inundar stdout."""

    def __init__(self, spans: dict[str, tuple[float, float]]) -> None:
        self.spans = spans
        self._last_percent = -1.0
        self._last_stage = ""

    def report(self, stage: str, fraction: float = 0.0) -> None:
        low, high = self.spans[stage]
        fraction = min(max(fraction, 0.0), 1.0)
        percent = round(low + (high - low) * fraction, 1)
        if stage != self._last_stage or abs(percent - self._last_percent) >= 0.5 or fraction == 1.0:
            self._last_stage = stage
            self._last_percent = percent
            emit("progress", percent=percent, stage=stage)


class ChunkTracker:
    """Sustituto de `tqdm` dentro de `demucs.apply`.

    `apply_model` trocea la canción y recorre los trozos con `tqdm.tqdm(...)`.
    Envolviendo ese iterable sabemos cuántos trozos se han procesado. Un
    `BagOfModels` o `shifts > 1` repiten el recorrido, por eso se cuentan pasadas.
    """

    def __init__(self, progress: Progress, passes: int) -> None:
        self.progress = progress
        self.passes = max(passes, 1)
        self.completed_passes = 0

    def reset(self) -> None:
        self.completed_passes = 0

    def tqdm(self, iterable: Iterable[Any], **_kwargs: Any) -> Iterator[Any]:
        items = list(iterable)
        total = max(len(items), 1)
        for index, item in enumerate(items):
            yield item
            # Al pedir el siguiente elemento, `apply_model` ya ha procesado este trozo.
            done = (self.completed_passes + (index + 1) / total) / self.passes
            self.progress.report("separating", done)
        self.completed_passes += 1


class LoopTracker:
    """Sustituto de `tqdm` en los módulos de audio-separator: cada bucle ocupa su tramo de la fase."""

    def __init__(self, progress: Progress, stage: str, spans: list[tuple[float, float]]) -> None:
        self.progress = progress
        self.stage = stage
        self.spans = spans
        self.loops = 0

    def tqdm(self, iterable: Iterable[Any], *_args: Any, **_kwargs: Any) -> Iterator[Any]:
        items = list(iterable)
        low, high = self.spans[min(self.loops, len(self.spans) - 1)]
        self.loops += 1
        total = max(len(items), 1)
        for index, item in enumerate(items):
            yield item
            self.progress.report(self.stage, low + (high - low) * (index + 1) / total)


@contextlib.contextmanager
def patched(module: ModuleType, name: str, value: Any) -> Iterator[None]:
    original = getattr(module, name)
    setattr(module, name, value)
    try:
        yield
    finally:
        setattr(module, name, original)


# --- Dispositivo -----------------------------------------------------------


def pick_device(requested: str) -> tuple[str, str]:
    import torch

    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError(
            "Se pidió CUDA pero esta instalación de PyTorch no la detecta "
            f"(torch {torch.__version__}, CUDA {torch.version.cuda}). "
            "Instala la variante CUDA de PyTorch."
        )
    if requested == "mps" and not _mps_available(torch):
        raise RuntimeError("Se pidió Metal (MPS) pero no está disponible en este equipo.")

    device = requested
    if requested == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif _mps_available(torch):
            device = "mps"
        else:
            device = "cpu"

    if device.startswith("cuda"):
        return device, torch.cuda.get_device_name(torch.device(device))
    if device == "mps":
        return device, f"Apple {platform.machine()} · Metal"
    return device, platform.processor() or platform.machine() or "CPU"


def _mps_available(torch: Any) -> bool:
    mps = getattr(torch.backends, "mps", None)
    return bool(mps and mps.is_available())


def cpu_hint() -> str | None:
    """Explica por qué no se usa GPU cuando probablemente se podría."""
    import torch

    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "PyTorch no detecta Metal (MPS); actualiza torch a una versión reciente."
    if torch.version.cuda is not None:
        return (
            "PyTorch tiene soporte CUDA pero no ve ninguna GPU. En Docker, el contenedor "
            "necesita --gpus all y un driver de NVIDIA reciente en el equipo."
        )
    if sys.platform in ("win32", "linux"):
        return (
            "Esta instalación de PyTorch es solo CPU. Para usar la GPU NVIDIA: "
            "pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128"
        )
    return None


class Device:
    """Dispositivo en uso; puede caer a CPU a mitad de la separación."""

    def __init__(self, requested: str) -> None:
        self.name, self.label = pick_device(requested)
        emit("device", device=self.name, name=self.label)
        if self.name == "cpu" and (hint := cpu_hint()):
            emit("log", message=hint)

    def run(self, action: Callable[[str], T]) -> T:
        """Ejecuta `action(dispositivo)`; si la GPU se queda sin memoria (o MPS no
        soporta una operación), lo reintenta en CPU."""
        try:
            return action(self.name)
        except RuntimeError as error:
            if self.name == "cpu":
                raise
            import torch

            emit("log", message=f"Falló en {self.name} ({error}). Reintentando en CPU…")
            if self.name.startswith("cuda"):
                torch.cuda.empty_cache()
            self.name, self.label = pick_device("cpu")
            emit("device", device=self.name, name=self.label)
            return action(self.name)


# --- Audio -----------------------------------------------------------------


def load_audio(path: Path, samplerate: int, channels: int) -> Any:
    """Lee el audio como tensor [canales, muestras] a `samplerate`."""
    import torch
    from demucs.audio import AudioFile, convert_audio

    try:
        import soundfile as sf

        # libsndfile >= 1.1 (incluido en soundfile >= 0.12) lee WAV, FLAC, AIFF, OGG y MP3.
        data, source_rate = sf.read(str(path), dtype="float32", always_2d=True)
        wav = torch.from_numpy(data.T.copy())
        return convert_audio(wav, source_rate, samplerate, channels)
    except Exception as soundfile_error:
        # Plan B: ffmpeg a través del lector de Demucs (M4A, AAC… o MP3 raros).
        try:
            return AudioFile(path).read(streams=0, samplerate=samplerate, channels=channels)
        except Exception as ffmpeg_error:
            raise RuntimeError(
                f"No se pudo leer el audio ({soundfile_error}); "
                f"tampoco con ffmpeg ({ffmpeg_error})."
            ) from ffmpeg_error


def fit_length(data: Any, frames: int) -> Any:
    import numpy as np

    if data.shape[-1] >= frames:
        return data[..., :frames]
    return np.pad(data, ((0, 0), (0, frames - data.shape[-1])))


# --- Plan ------------------------------------------------------------------


@dataclass(frozen=True)
class Plan:
    quality: str
    primary: str  # clave de catalog
    keep: frozenset[str]  # guitarra/piano que se entregan como pista propia
    wind: bool

    @property
    def models(self) -> list[str]:
        return [self.primary, "uvr_wind"] if self.wind else [self.primary]

    def spans(self, device: str) -> dict[str, tuple[float, float]]:
        """Tramo de la barra global que ocupa cada fase, en orden de ejecución."""
        cost = CPU_COST if device == "cpu" else GPU_COST
        separating = cost[self.quality]
        wind = cost["wind"] if self.wind else 0.0
        split = 8.0 + 88.0 * separating / (separating + wind)
        # Demucs fija la frecuencia de muestreo, así que su modelo se carga antes que el audio.
        loading = ["loading_model", "loading_audio"] if self.quality == "fast" else ["loading_audio", "loading_model"]
        spans = {loading[0]: (0.0, 4.0), loading[1]: (4.0, 8.0), "separating": (8.0, split), "saving": (96.0, 100.0)}
        if self.wind:
            spans["wind"] = (split, 96.0)
        return spans


def make_plan(quality: str, instruments: set[str], demucs_override: str | None) -> Plan:
    six = bool(instruments & {"guitar", "piano"})
    if quality == "best":
        primary = "bs_roformer_sw"
    elif six:
        primary = "htdemucs_6s"
    else:
        primary = demucs_override or "htdemucs"
    return Plan(quality, primary, frozenset(instruments & {"guitar", "piano"}), "wind" in instruments)


def require(key: str) -> None:
    if catalog.is_available(key):
        return
    label = catalog.MODEL_LABELS.get(key, key)
    if catalog.offline():
        raise EngineSetupError(
            f"El modelo {label} no está en la imagen del motor. Reconstrúyela con: npm run docker:engine"
        )
    raise EngineSetupError(
        f"Faltan los paquetes para usar {label}. Instálalos con: pip install -r python/requirements.txt"
    )


def available_qualities() -> dict[str, list[str]]:
    """Calidad → instrumentos opcionales que puede separar con los modelos presentes."""
    qualities: dict[str, list[str]] = {}
    if catalog.is_available("htdemucs"):
        qualities["fast"] = ["guitar", "piano"] if catalog.is_available("htdemucs_6s") else []
    if catalog.is_available("bs_roformer_sw"):
        qualities["best"] = ["guitar", "piano"]
    return qualities


# --- Separación ------------------------------------------------------------


def separate_with_demucs(plan: Plan, input_path: Path, device: Device, args: argparse.Namespace, progress: Progress) -> dict[str, Any]:
    import torch
    import demucs.apply as demucs_apply
    from demucs.apply import BagOfModels, apply_model

    progress.report("loading_model")
    model = catalog.load_demucs(plan.primary)
    progress.report("loading_model", 1.0)

    progress.report("loading_audio")
    mix = load_audio(input_path, model.samplerate, model.audio_channels)
    progress.report("loading_audio", 1.0)

    models = len(model.models) if isinstance(model, BagOfModels) else 1
    tracker = ChunkTracker(progress, passes=models * max(args.shifts, 1))
    if hasattr(demucs_apply, "tqdm"):
        demucs_apply.tqdm = SimpleNamespace(tqdm=tracker.tqdm)
    else:
        emit("log", message="Esta versión de Demucs no expone el progreso por trozos.")

    # Misma normalización que `demucs.separate`.
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    normalized = (mix - mean) / std

    def attempt(device_name: str) -> Any:
        tracker.reset()
        progress.report("separating")
        with torch.inference_mode():
            return apply_model(
                model,
                normalized[None],
                device=device_name,
                shifts=args.shifts,
                split=True,
                overlap=args.overlap,
                progress=True,
                num_workers=0,
            )[0]

    sources = device.run(attempt) * std + mean
    return {name: sources[index].cpu().numpy() for index, name in enumerate(model.sources)}


def run_separator(
    key: str,
    audio: Any,
    work_dir: Path,
    device_name: str,
    progress: Progress,
    stage: str,
    load_stage: str | None = None,
) -> dict[str, Any]:
    """Separa `audio` ([canales, muestras] a 44,1 kHz) con un modelo de audio-separator.

    El audio se escribe con un pico conocido (HEADROOM_PEAK) para que
    audio-separator no normalice ni recorte; al leer las salidas se deshace esa
    ganancia. Si no hay `load_stage`, la carga del modelo ocupa el 5 % inicial de `stage`.
    """
    import numpy as np
    import soundfile as sf
    import torch
    import audio_separator.separator.architectures.mdxc_separator as mdxc_module
    import audio_separator.separator.architectures.vr_separator as vr_module

    spec = catalog.SEPARATOR_MODELS[key]
    work_dir.mkdir(parents=True, exist_ok=True)

    progress.report(load_stage or stage, 0.0)
    single = next(iter(spec.stems)) if len(spec.stems) == 1 else None
    separator = catalog.create_separator(work_dir, output_single_stem=single)
    separator.torch_device = torch.device(device_name)
    if device_name != "mps":
        separator.torch_device_mps = None
    separator.load_model(model_filename=spec.filename)
    progress.report(load_stage or stage, 1.0 if load_stage else 0.05)

    peak = float(np.abs(audio).max())
    gain = HEADROOM_PEAK / peak if peak > 0 else 1.0
    source = work_dir / f"{key}.wav"
    sf.write(str(source), (audio * gain).T, SAMPLE_RATE, subtype="PCM_24")

    names = {stem: f"{key}-{target}" for stem, target in spec.stems.items()}
    tracker = LoopTracker(progress, stage, LOOP_SPANS[key])
    with patched(mdxc_module, "tqdm", tracker.tqdm), patched(vr_module, "tqdm", tracker.tqdm):
        separator.separate(str(source), custom_output_names=names)

    stems: dict[str, Any] = {}
    for stem, target in spec.stems.items():
        path = work_dir / f"{names[stem]}.wav"
        if not path.is_file():
            raise RuntimeError(f"{spec.label} no generó la pista «{stem}».")
        data, _ = sf.read(str(path), dtype="float32", always_2d=True)
        stems[target] = fit_length(data.T / gain, audio.shape[-1])
    return stems


def fold_into_other(stems: dict[str, Any], keep: frozenset[str]) -> None:
    """Lo que el modelo separa sin que se haya pedido vuelve a «otros»."""
    missing = [name for name in BASE_STEMS if name not in stems]
    if missing:
        raise RuntimeError(f"El modelo no produce las pistas {missing} (produce {sorted(stems)}).")
    for name in list(stems):
        if name not in BASE_STEMS and name not in keep:
            stems["other"] = stems["other"] + stems.pop(name)


def save_stems(stems: dict[str, Any], output_dir: Path, progress: Progress) -> list[str]:
    import numpy as np
    import soundfile as sf

    names = [name for name in STEM_ORDER if name in stems]
    # Una sola ganancia para todas las pistas: evita el clipping sin alterar el
    # balance entre ellas (reescalar cada una por separado lo cambiaría).
    peak = max(float(np.abs(stems[name]).max()) for name in names)
    gain = 0.999 / peak if peak > 0.999 else 1.0

    output_dir.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(names):
        data = np.clip(stems[name] * gain, -1.0, 1.0).T
        sf.write(str(output_dir / f"{name}.wav"), data, SAMPLE_RATE, subtype="PCM_16")
        progress.report("saving", (index + 1) / len(names))
    return names


def run(args: argparse.Namespace) -> None:
    input_path = Path(args.input)
    output_dir = Path(args.output)
    if not input_path.is_file():
        raise FileNotFoundError(f"No existe el archivo de entrada: {input_path}")

    plan = make_plan(args.quality, args.instruments, args.model)
    for key in plan.models:
        require(key)

    device = Device(args.device)
    progress = Progress(plan.spans(device.name))
    # Intermedios de audio-separator; si la separación se cancela, la app borra toda la carpeta.
    work_dir = output_dir / ".work"

    try:
        if plan.quality == "fast":
            stems = separate_with_demucs(plan, input_path, device, args, progress)
        else:
            progress.report("loading_audio")
            mix = load_audio(input_path, SAMPLE_RATE, 2).numpy()
            progress.report("loading_audio", 1.0)
            stems = device.run(
                lambda name: run_separator(plan.primary, mix, work_dir, name, progress, "separating", "loading_model")
            )
            del mix

        fold_into_other(stems, plan.keep)

        if plan.wind:
            other = stems["other"]
            wind = device.run(lambda name: run_separator("uvr_wind", other, work_dir, name, progress, "wind"))["wind"]
            # El resto se calcula por diferencia: viento + otros = «otros» original, sin pérdidas.
            stems["wind"] = wind
            stems["other"] = other - wind

        progress.report("saving")
        frames = next(iter(stems.values())).shape[-1]
        names = save_stems(stems, output_dir, progress)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    emit("done", stems=names, sampleRate=SAMPLE_RATE, frames=int(frames), models=plan.models)


def check(args: argparse.Namespace) -> None:
    import torch

    device, name = pick_device(args.device)
    emit("device", device=device, name=name)
    emit(
        "capabilities",
        protocol=PROTOCOL_VERSION,
        engine=ENGINE_VERSION,
        qualities=available_qualities(),
        wind=catalog.is_available("uvr_wind"),
        transcription=catalog.has_transcription() and Path(__file__).with_name("transcribe.py").is_file(),
    )
    emit("log", message=f"Python {platform.python_version()} · torch {torch.__version__} · CUDA {torch.version.cuda}")
    if device == "cpu" and (hint := cpu_hint()):
        emit("log", message=hint)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Separación de una canción en pistas por instrumento.")
    parser.add_argument("--input", help="Archivo de audio de entrada (MP3, WAV, FLAC, AIFF, M4A…)")
    parser.add_argument("--output", help="Carpeta donde se guardan las pistas .wav")
    parser.add_argument(
        "--instruments",
        default="",
        help="Instrumentos opcionales separados por comas: guitar, piano, wind (voces, batería, bajo y otros siempre)",
    )
    parser.add_argument("--quality", choices=("fast", "best"), default="fast", help="fast: Demucs · best: BS-RoFormer SW")
    parser.add_argument("--model", help="Modelo de Demucs para 4 pistas en calidad fast (htdemucs, htdemucs_ft…)")
    parser.add_argument("--device", default="auto", help="auto, cuda, cuda:1, mps o cpu")
    parser.add_argument("--shifts", type=int, default=1, help="Demucs: pasadas con desplazamiento aleatorio")
    parser.add_argument("--overlap", type=float, default=0.25, help="Demucs: solapamiento entre trozos")
    parser.add_argument("--check", action="store_true", help="Solo muestra el acelerador y los modelos disponibles")
    args = parser.parse_args()

    if not args.check and not (args.input and args.output):
        parser.error("--input y --output son obligatorios")
    requested = {part.strip().lower() for part in args.instruments.split(",") if part.strip()}
    unknown = requested - set(STEM_ORDER)
    if unknown:
        parser.error(f"Instrumentos desconocidos: {', '.join(sorted(unknown))}")
    args.instruments = requested & set(OPTIONAL_STEMS)
    return args


def main() -> int:
    args = parse_args()
    try:
        if args.check:
            check(args)
        else:
            run(args)
        return 0
    except EngineSetupError as error:
        emit("error", message=str(error))
    except ModuleNotFoundError as error:
        emit(
            "error",
            message=(
                f"Falta el paquete «{error.name}» en {sys.executable}. "
                "Instala las dependencias con: pip install -r python/requirements.txt"
            ),
        )
    except Exception as error:  # noqa: BLE001 - todo error debe llegar a la app
        traceback.print_exc()
        emit("error", message=f"{type(error).__name__}: {error}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
