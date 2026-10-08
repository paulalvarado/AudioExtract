#!/usr/bin/env bash
# Prepara el motor Python local. En macOS (Apple Silicon) es el motor por
# defecto de la app: usa la GPU a través de Metal (MPS).
#
#   bash scripts/setup-python.sh          # entorno para la app instalada
#   bash scripts/setup-python.sh --dev    # python/.venv dentro del repositorio
#   bash scripts/setup-python.sh --cuda   # Linux con GPU NVIDIA
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dev=0
cuda=0
for arg in "$@"; do
  case "$arg" in
    --dev) dev=1 ;;
    --cuda) cuda=1 ;;
    *) echo "Opción desconocida: $arg" >&2; exit 1 ;;
  esac
done

if [[ $dev == 1 ]]; then
  venv="$root/python/.venv"
elif [[ "$(uname)" == "Darwin" ]]; then
  venv="$HOME/Library/Application Support/com.audioextract.desktop/python/.venv"
else
  venv="${XDG_DATA_HOME:-$HOME/.local/share}/com.audioextract.desktop/python/.venv"
fi

python="${PYTHON:-python3}"
"$python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else "Hace falta Python 3.10 o posterior")'

echo "Creando el entorno en $venv"
mkdir -p "$(dirname "$venv")"
"$python" -m venv "$venv"
py="$venv/bin/python"
"$py" -m pip install --upgrade pip

if [[ "$(uname)" == "Darwin" ]]; then
  # Metal (MPS) viene incluido en las ruedas de macOS; audio-separator pide torch >= 2.13 en arm64.
  "$py" -m pip install "torch>=2.13" torchaudio torchvision
elif [[ $cuda == 1 ]]; then
  "$py" -m pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
else
  "$py" -m pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu
fi

# Fija las versiones de torch para que pip no las sustituya al resolver audio-separator.
"$py" -m pip freeze | grep -iE '^torch(audio|vision)?==' > "$venv/torch-pins.txt"
"$py" -m pip install -r "$root/python/requirements.txt" -c "$venv/torch-pins.txt"

# Transcripción del bajo (modo práctica): basic-pitch sin dependencias, porque pide un
# TensorFlow que no existe para Python 3.12; su modelo ONNX corre con onnxruntime.
"$py" -m pip install --no-deps basic-pitch==0.4.0
"$py" -m pip install -r "$root/python/requirements-transcription.txt" -c "$venv/torch-pins.txt"

command -v ffmpeg >/dev/null || echo "Aviso: instala ffmpeg (brew install ffmpeg / apt install ffmpeg) para leer M4A y para audio-separator." >&2

echo
echo "Comprobando el motor…"
"$py" "$root/python/separate.py" --check
echo
echo "Listo. La primera separación de cada calidad descarga sus modelos (hasta ~1 GB)."
