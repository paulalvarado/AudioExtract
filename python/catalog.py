#!/usr/bin/env python3
"""Catálogo de modelos de separación que usa AudioExtract.

Vive aparte de `separate.py` para que la imagen Docker descargue los pesos en una
capa propia: modificar `separate.py` no obliga a descargar otra vez ~1 GB.

    python catalog.py --prefetch htdemucs htdemucs_6s bs_roformer_sw uvr_wind

Claves de modelo:
    htdemucs        Demucs v4, 4 pistas. Calidad «rápida».
    htdemucs_6s     Demucs v4, 6 pistas (+ guitarra y piano). Calidad «rápida».
    htdemucs_ft     Demucs v4 afinado, 4 pistas, ~4× más lento (opcional).
    bs_roformer_sw  BS-RoFormer SW (audio-separator), 6 pistas. Calidad «máxima».
    uvr_wind        UVR 17_HP-Wind_Inst (audio-separator): viento (metales y maderas).
"""

from __future__ import annotations

import argparse
import contextlib
import importlib.util
import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator


@dataclass(frozen=True)
class SeparatorModel:
    """Modelo que se ejecuta con audio-separator."""

    filename: str
    label: str
    # Nombre de pista del modelo (en minúsculas) → nombre de pista de AudioExtract.
    stems: dict[str, str]


SEPARATOR_MODELS = {
    "bs_roformer_sw": SeparatorModel(
        filename="BS-Roformer-SW.ckpt",
        label="BS-RoFormer SW",
        stems={
            "vocals": "vocals",
            "drums": "drums",
            "bass": "bass",
            "guitar": "guitar",
            "piano": "piano",
            "other": "other",
        },
    ),
    "uvr_wind": SeparatorModel(
        filename="17_HP-Wind_Inst-UVR.pth",
        label="UVR Wind",
        # UVR llama «woodwinds» a su salida de viento, pero incluye también los metales.
        stems={"woodwinds": "wind"},
    ),
}

MODEL_LABELS = {
    "htdemucs": "HTDemucs",
    "htdemucs_6s": "HTDemucs 6s",
    "htdemucs_ft": "HTDemucs FT",
    **{key: model.label for key, model in SEPARATOR_MODELS.items()},
}


def offline() -> bool:
    """`AUDIOEXTRACT_OFFLINE=1` (lo define la imagen Docker): solo vale lo que ya está descargado."""
    return os.environ.get("AUDIOEXTRACT_OFFLINE") == "1"


def models_dir() -> Path:
    """Carpeta de los modelos de audio-separator (los de Demucs van a `TORCH_HOME`)."""
    configured = os.environ.get("AUDIOEXTRACT_MODELS_DIR", "").strip()
    if configured:
        return Path(configured)
    return Path.home() / ".cache" / "audioextract" / "models"


def has_separator_package() -> bool:
    return importlib.util.find_spec("audio_separator") is not None


# Lo que importa transcribe.py: Basic Pitch y su modelo ONNX (incluido en el paquete).
TRANSCRIPTION_PACKAGES = ("basic_pitch", "onnxruntime", "librosa", "resampy", "pretty_midi", "mir_eval")

_wheels_ready = False


def use_bundled_wheels() -> None:
    """Hace importables las ruedas de Python puro que la app instala junto a sus scripts.

    `AUDIOEXTRACT_WHEELS` es la carpeta `python/wheels` de la app (montada en el contenedor). Así una
    versión nueva de la app añade funciones al motor, como la transcripción, sin reconstruir la imagen
    ni usar la red. Cada rueda se descomprime una vez en la carpeta temporal y se añade al FINAL de
    `sys.path`: lo que ya trae el entorno siempre tiene prioridad.
    """
    global _wheels_ready
    folder = os.environ.get("AUDIOEXTRACT_WHEELS", "").strip()
    if _wheels_ready or not folder or not Path(folder).is_dir():
        return
    import shutil
    import tempfile
    import zipfile

    root = Path(tempfile.gettempdir()) / "audioextract-wheels"
    root.mkdir(parents=True, exist_ok=True)
    for wheel in sorted(Path(folder).glob("*.whl")):
        target = root / wheel.stem
        if not target.is_dir():
            staging = Path(tempfile.mkdtemp(prefix=".extract-", dir=root))
            with zipfile.ZipFile(wheel) as archive:
                archive.extractall(staging)
            try:
                staging.rename(target)
            except OSError:
                # Otro proceso la descomprimió a la vez: vale la suya.
                shutil.rmtree(staging, ignore_errors=True)
        if str(target) not in sys.path:
            sys.path.append(str(target))
    importlib.invalidate_caches()
    _wheels_ready = True


def has_transcription() -> bool:
    """Si se puede transcribir el bajo del modo práctica (no necesita descargar pesos)."""
    use_bundled_wheels()
    return all(importlib.util.find_spec(name) is not None for name in TRANSCRIPTION_PACKAGES)


def demucs_signatures(name: str) -> list[str]:
    """Firmas de los checkpoints de un modelo de Demucs, según el YAML que trae el paquete."""
    import demucs
    import yaml

    spec = Path(demucs.__file__).parent / "remote" / f"{name}.yaml"
    if not spec.is_file():
        return []
    data = yaml.safe_load(spec.read_text(encoding="utf-8")) or {}
    return [str(signature) for signature in data.get("models", [])]


def demucs_downloaded(name: str) -> bool:
    import torch

    signatures = demucs_signatures(name)
    checkpoints = Path(torch.hub.get_dir()) / "checkpoints"
    return bool(signatures) and all(any(checkpoints.glob(f"{sig}-*.th")) for sig in signatures)


def is_available(key: str) -> bool:
    """Si el modelo se puede usar ahora mismo (sin red, en Docker, tiene que estar descargado)."""
    model = SEPARATOR_MODELS.get(key)
    if model is None:
        # Cualquier otro nombre es un modelo de Demucs (htdemucs_ft, mdx_extra…).
        if importlib.util.find_spec("demucs") is None:
            return False
        return demucs_downloaded(key) if offline() else True
    if not has_separator_package():
        return False
    return (models_dir() / model.filename).is_file() if offline() else True


@contextlib.contextmanager
def trusted_checkpoint_loading(torch: Any) -> Iterator[None]:
    """Permite cargar los checkpoints oficiales de Demucs con torch >= 2.6.

    Desde torch 2.6, `torch.load` usa `weights_only=True` por defecto y los
    paquetes de Demucs (que incluyen la clase del modelo) dejan de cargarse. Solo
    se relaja durante `get_model`, que descarga de los repositorios oficiales de
    Demucs y verifica el hash de cada archivo.
    """
    original = torch.load

    def load(*args: Any, **kwargs: Any) -> Any:
        kwargs["weights_only"] = False
        return original(*args, **kwargs)

    torch.load = load
    try:
        yield
    finally:
        torch.load = original


def load_demucs(name: str) -> Any:
    import torch
    from demucs.pretrained import get_model

    with trusted_checkpoint_loading(torch):
        model = get_model(name)
    model.eval()
    return model


def create_separator(output_dir: Path, **options: Any) -> Any:
    """`Separator` de audio-separator sin normalización de pico (el balance entre pistas no cambia)."""
    from audio_separator.separator import Separator

    return Separator(
        log_level=logging.WARNING,
        model_file_dir=str(models_dir()),
        output_dir=str(output_dir),
        output_format="WAV",
        normalization_threshold=1.0,
        sample_rate=44100,
        use_soundfile=True,
        **options,
    )


def prefetch(keys: list[str]) -> None:
    """Descarga y valida los pesos (se usa al construir la imagen Docker).

    Las claves que no son de audio-separator se tratan como modelos de Demucs.
    """
    for key in keys:
        if key in SEPARATOR_MODELS:
            models_dir().mkdir(parents=True, exist_ok=True)
            separator = create_separator(models_dir())
            separator.load_model(model_filename=SEPARATOR_MODELS[key].filename)
            detail = SEPARATOR_MODELS[key].filename
        else:
            model = load_demucs(key)
            detail = f"{', '.join(model.sources)} @ {model.samplerate} Hz"
        print(json.dumps({"type": "log", "message": f"Modelo {key} listo: {detail}"}), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Modelos de separación de AudioExtract.")
    parser.add_argument(
        "--prefetch",
        nargs="+",
        metavar="MODELO",
        required=True,
        help=f"{', '.join(MODEL_LABELS)} o cualquier modelo de Demucs",
    )
    args = parser.parse_args()
    prefetch(args.prefetch)
    return 0


if __name__ == "__main__":
    sys.exit(main())
