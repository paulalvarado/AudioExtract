<#
.SYNOPSIS
  Prepara el motor Python local (alternativa a Docker) en Windows.

.DESCRIPTION
  Crea un entorno virtual con PyTorch, Demucs y audio-separator donde la app lo
  busca: %LOCALAPPDATA%\com.audioextract.desktop\python\.venv (app instalada) o,
  con -Dev, python\.venv dentro del repositorio (desarrollo).
  Después, usa la app con la variable de usuario AUDIOEXTRACT_ENGINE=python:
    setx AUDIOEXTRACT_ENGINE python    (y vuelve a abrir la app)

.PARAMETER Cuda
  Instala PyTorch con CUDA 12.8 (GPU NVIDIA). Sin este parámetro, solo CPU.
#>
[CmdletBinding()]
param(
  [switch]$Cuda,
  [switch]$Dev,
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = if ($Dev) { Join-Path $root "python\.venv" } else { Join-Path $env:LOCALAPPDATA "com.audioextract.desktop\python\.venv" }

$version = & $Python -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ([version]$version -lt [version]"3.10") { throw "Hace falta Python 3.10 o posterior (tienes $version)." }

Write-Host "Creando el entorno en $venv"
& $Python -m venv $venv
$py = Join-Path $venv "Scripts\python.exe"
& $py -m pip install --upgrade pip

if ($Cuda) {
  & $py -m pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
} else {
  & $py -m pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu
}

# Fija las versiones de torch para que pip no las sustituya al resolver audio-separator.
$pins = Join-Path $venv "torch-pins.txt"
& $py -m pip freeze | Select-String -Pattern "^torch(audio|vision)?==" | ForEach-Object { $_.Line } | Set-Content -Encoding utf8 $pins
& $py -m pip install -r (Join-Path $root "python\requirements.txt") -c $pins

# Transcripción del bajo (modo práctica): basic-pitch sin dependencias, porque pide un
# TensorFlow que no existe para Python 3.12; su modelo ONNX corre con onnxruntime.
& $py -m pip install --no-deps basic-pitch==0.4.0
& $py -m pip install -r (Join-Path $root "python\requirements-transcription.txt") -c $pins

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "Aviso: instala ffmpeg (winget install Gyan.FFmpeg) y añádelo al PATH: audio-separator lo necesita para la calidad máxima y el viento." -ForegroundColor Yellow
}

Write-Host "`nComprobando el motor…"
& $py (Join-Path $root "python\separate.py") --check
Write-Host "`nListo. Para que la app use este motor: setx AUDIOEXTRACT_ENGINE python  (y vuelve a abrirla)." -ForegroundColor Green
Write-Host "La primera separación de cada calidad descarga sus modelos (hasta ~1 GB)."
