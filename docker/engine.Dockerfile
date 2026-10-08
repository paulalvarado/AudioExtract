# syntax=docker/dockerfile:1.7
#
# Motor de separación: Python 3.12 + PyTorch (CUDA 12.8) + Demucs v4 +
# audio-separator (BS-RoFormer SW y el modelo de viento de UVR), con todos los
# pesos dentro de la imagen, así el contenedor funciona sin red.
# La app lo lanza con `docker run --gpus all --network none …` por cada canción.
# La misma imagen transcribe el bajo para el modo práctica (Basic Pitch, en CPU):
#   docker run --rm --network none -v …/bass.wav:/input/bass.wav:ro \
#     --entrypoint python audioextract-engine -u /app/transcribe.py --input /input/bass.wav
#
#   docker build -f docker/engine.Dockerfile -t audioextract-engine python
#   docker run --rm --gpus all --network none audioextract-engine --check
#
# Las capas van de lo que menos cambia a lo que más: editar separate.py solo
# rehace la última y no vuelve a descargar ni PyTorch ni los modelos.

FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TORCH_HOME=/opt/torch \
    AUDIOEXTRACT_MODELS_DIR=/opt/models \
    AUDIOEXTRACT_OFFLINE=1

# ffmpeg: audio-separator lo exige y además permite leer M4A/AAC.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Las ruedas cu128 traen el runtime de CUDA; el driver lo aporta Windows a
# través de WSL2 cuando el contenedor se lanza con --gpus all.
ARG TORCH_VERSION=2.8.0
ARG TORCHVISION_VERSION=0.23.0
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu128
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --index-url "$TORCH_INDEX" \
      "torch==${TORCH_VERSION}" "torchaudio==${TORCH_VERSION}" "torchvision==${TORCHVISION_VERSION}" \
 && pip freeze | grep -iE '^torch(audio|vision)?==' > /opt/torch-pins.txt

# Las versiones de torch quedan fijadas: sin eso, pip cambiaría la variante CUDA
# por la genérica de PyPI al resolver audio-separator. gcc solo hace falta para
# compilar diffq (no tiene rueda para Linux) y se elimina en la misma capa.
COPY requirements.txt /app/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev \
 && pip install -c /opt/torch-pins.txt -r /app/requirements.txt \
 && apt-get purge -y gcc libc6-dev \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Modelos incluidos, separados por espacios (ver python/catalog.py). Para
# añadir el Demucs afinado: --build-arg MODELS="htdemucs htdemucs_6s htdemucs_ft bs_roformer_sw uvr_wind"
ARG MODELS="htdemucs htdemucs_6s bs_roformer_sw uvr_wind"
COPY catalog.py /app/catalog.py
RUN python /app/catalog.py --prefetch $MODELS

# Transcripción del bajo (modo práctica): Basic Pitch con su modelo ONNX, que viene
# dentro del paquete. Va después de los modelos para que añadirla no los descargue de
# nuevo. basic-pitch se instala sin dependencias (para Python 3.12 pide un TensorFlow
# que no existe y que aquí no hace falta: onnxruntime ya está), y el resto se instala
# sin cambiar la versión de nada de lo anterior. pip avisará de que basic-pitch
# «requiere tensorflow»: es esperado. La última línea comprueba que el modelo carga sin red.
ARG BASIC_PITCH_VERSION=0.4.0
COPY requirements-transcription.txt /app/requirements-transcription.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip freeze > /tmp/installed.txt \
 && pip install --no-deps "basic-pitch==${BASIC_PITCH_VERSION}" \
 && pip install -c /tmp/installed.txt -r /app/requirements-transcription.txt \
 && rm /tmp/installed.txt \
 && python -c "from basic_pitch import FilenameSuffix, build_icassp_2022_model_path; from basic_pitch.inference import Model; Model(build_icassp_2022_model_path(FilenameSuffix.onnx))"

COPY separate.py /app/separate.py
COPY transcribe.py /app/transcribe.py

WORKDIR /app
ENTRYPOINT ["python", "-u", "/app/separate.py"]
