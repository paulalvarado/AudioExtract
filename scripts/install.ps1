<#
.SYNOPSIS
  Compila e instala AudioExtract en Windows desde el código fuente, sin instalar Rust, Node ni Python:
  la compilación corre dentro de Docker.

.DESCRIPTION
  1. Comprueba Docker Desktop (solo hace falta para compilar).
  2. Compila el instalador de la app en release\.
  3. Lo ejecuta. Si ya tienes AudioExtract instalado, se actualiza encima y conserva
     la biblioteca y los ajustes.

  El motor de separación ya no se construye aquí: la app lo instala por sí misma la primera vez
  que la abres (Python, PyTorch según tu GPU y los modelos), sin Docker. Con -DockerEngine se
  construye además la imagen Docker del motor, para quien prefiera usarla (AUDIOEXTRACT_ENGINE=docker).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1

.EXAMPLE
  # Además, la imagen Docker del motor (opcional; la primera vez descarga ~10 GB):
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -DockerEngine
#>
[CmdletBinding()]
param(
  [switch]$DockerEngine,
  [switch]$SkipApp,
  [switch]$NoLaunch,
  [string]$Models = "htdemucs htdemucs_6s bs_roformer_sw uvr_wind",
  # Sin efecto: el motor Docker ya solo se construye con -DockerEngine.
  [switch]$SkipEngine
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

if ($DockerEngine) {
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
  Write-Host "Al abrir la app, pulsa «Instalar el motor»: detecta tu GPU y descarga lo que necesita (una sola vez)."
  Start-Process $setup.FullName
}
