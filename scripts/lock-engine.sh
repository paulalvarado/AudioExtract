#!/bin/sh
# Genera python/locks/*.txt: el entorno exacto (versiones y SHA-256) que instala la app en cada
# tipo de equipo. Se ejecuta en Docker, sin Python en el equipo:
#
#   docker run --rm -v ./:/src -w /src python:3.12-slim sh scripts/lock-engine.sh
#
# Después de cambiar requirements*.txt o constraints.txt, regenera y sube ENGINE_SPEC en
# src-tauri/src/setup.rs: la app pondrá al día el motor de cada usuario al abrirse.
set -eu

pip install --quiet --root-user-action=ignore --disable-pip-version-check uv==0.12.19

TORCH_PINS="torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0"
INPUTS="python/requirements.txt python/requirements-transcription.txt python/requirements-local.txt"

lock() {
  name=$1 platform=$2 index=$3 torch=$4
  printf '%s\n' $torch > /tmp/torch.txt
  # Las ruedas de PyTorch salen de su índice; el resto, de PyPI.
  set -- --index-strategy unsafe-best-match
  [ -n "$index" ] && set -- "$@" --index "https://download.pytorch.org/whl/$index"
  uv pip compile --quiet --python-version 3.12 --python-platform "$platform" \
    --generate-hashes --emit-index-url --no-header --no-annotate "$@" \
    -c python/constraints.txt /tmp/torch.txt $INPUTS -o "python/locks/$name.txt"
  echo "$name: $(grep -c '==' "python/locks/$name.txt") paquetes"
}

mkdir -p python/locks
# GPU NVIDIA con capacidad de cómputo 7.0 o más (Turing, Ampere, Ada, Blackwell…).
lock windows-cuda x86_64-pc-windows-msvc cu128 "$TORCH_PINS"
# GPU NVIDIA más antigua (Maxwell, Pascal): las ruedas cu128 ya no las incluyen.
lock windows-cuda-legacy x86_64-pc-windows-msvc cu126 "$TORCH_PINS"
lock windows-cpu x86_64-pc-windows-msvc cpu "$TORCH_PINS"
# Apple Silicon (macOS 14 o posterior: onnxruntime no publica ruedas para la 13): Metal (MPS) viene
# en las ruedas de PyPI; audio-separator pide torch >= 2.13 en arm64.
MACOSX_DEPLOYMENT_TARGET=14.0 lock macos-arm64 aarch64-apple-darwin "" "torch>=2.13 torchaudio torchvision"
