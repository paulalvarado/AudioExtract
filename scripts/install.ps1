<#
.SYNOPSIS
  Instala AudioExtract en Windows desde el código fuente, sin instalar Rust, Node ni Python:
  todo se compila dentro de Docker.

.DESCRIPTION
  1. Comprueba Docker Desktop (y si hay GPU NVIDIA).
  2. Construye la imagen del motor de separación (la primera vez descarga ~10 GB).
  3. Compila el instalador de la app en release\.
  4. Lo ejecuta. Si ya tienes AudioExtract instalado, se actualiza encima y conserva
     la biblioteca y los ajustes.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1

.EXAMPLE
  # Solo recompilar la app (el motor ya está construido):
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -SkipEngine

.EXAMPLE
  # Motor más ligero, sin la calidad máxima (ahorra ~0,7 GB):
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Models "htdemucs htdemucs_6s uvr_wind"
#>
[CmdletBinding()]
param(
  [switch]$SkipEngine,
  [switch]$SkipApp,
  [switch]$NoLaunch,
  [string]$Models = "htdemucs htdemucs_6s bs_roformer_sw uvr_wind"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

Step "Comprobando Docker"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "No se encuentra Docker. Instala Docker Desktop (https://www.docker.com/products/docker-desktop/) con el backend WSL2, ábrelo y vuelve a ejecutar este script."
}
docker info --format "{{.ServerVersion}}" *> $null
if ($LASTEXITCODE -ne 0) {
  Fail "Docker Desktop no está en marcha. Ábrelo, espera a que arranque y vuelve a ejecutar este script."
}
Write-Host "Docker $(docker version --format '{{.Server.Version}}') listo."

if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  $gpu = (nvidia-smi --query-gpu=name --format=csv,noheader | Select-Object -First 1)
  Write-Host "GPU NVIDIA detectada: $gpu. La separación usará CUDA."
} else {
  Write-Host "No se detecta una GPU NVIDIA: la app separará con la CPU (más lento, pero funciona)." -ForegroundColor Yellow
}

if (-not $SkipEngine) {
  Step "Construyendo el motor de separación (la primera vez tarda: PyTorch + modelos, ~10 GB)"
  docker build -f docker/engine.Dockerfile --build-arg "MODELS=$Models" -t audioextract-engine python
  if ($LASTEXITCODE -ne 0) { Fail "Falló la construcción del motor. Revisa el mensaje anterior (¿conexión a internet? ¿espacio en disco?)." }

  Step "Comprobando el motor"
  docker run --rm --gpus all --network none audioextract-engine --check 2>$null
  if ($LASTEXITCODE -ne 0) {
    docker run --rm --network none audioextract-engine --check
    if ($LASTEXITCODE -ne 0) { Fail "El motor no responde. Revisa el mensaje anterior." }
    Write-Host "Docker no puede usar la GPU: la app lo detectará y separará con la CPU." -ForegroundColor Yellow
  }
}

if (-not $SkipApp) {
  Step "Compilando el instalador de la app (Rust + React dentro de Docker)"
  docker build -f docker/app.Dockerfile --target export --output type=local,dest=release .
  if ($LASTEXITCODE -ne 0) { Fail "Falló la compilación de la app. Revisa el mensaje anterior." }
}

$setup = Get-ChildItem release -Filter "AudioExtract_*_x64-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { Fail "No se encontró el instalador en release\." }
Write-Host "`nInstalador: $($setup.FullName)" -ForegroundColor Green

if (-not $NoLaunch) {
  Step "Abriendo el instalador"
  Write-Host "Windows SmartScreen puede avisar porque el instalador no está firmado: «Más información» → «Ejecutar de todas formas»."
  Start-Process $setup.FullName
}
