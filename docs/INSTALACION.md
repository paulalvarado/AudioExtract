# Instalar AudioExtract desde el repositorio

AudioExtract tiene dos piezas que se instalan por separado:

1. **La app** (ventana, biblioteca, mezclador): un instalador de Windows (`.exe`) o una app de macOS.
2. **El motor de separación** (PyTorch + modelos, ~10 GB): en Windows, una imagen de Docker; en macOS,
   un entorno de Python.

La app busca el motor cada vez que arranca y te dice si falta algo y cómo arreglarlo.

- [Windows con Docker (recomendado)](#windows-con-docker-recomendado)
- [macOS (Apple Silicon)](#macos-apple-silicon)
- [Windows sin Docker (motor Python)](#windows-sin-docker-motor-python)
- [Actualizar](#actualizar)
- [Desinstalar](#desinstalar)
- [Variables de entorno](#variables-de-entorno)
- [Solución de problemas](#solución-de-problemas)

---

## Windows con Docker (recomendado)

### Lo que necesitas

| Requisito | Detalle |
| --- | --- |
| Windows 10 u 11 de 64 bits | |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Con el backend **WSL2** (el predeterminado). Tiene que estar abierto al construir y al separar. |
| [Git](https://git-scm.com/download/win) | Para clonar el repositorio. |
| ~20 GB libres | Imagen del motor (~14 GB) + cachés de compilación. |
| GPU NVIDIA (opcional) | Driver reciente. Docker Desktop la expone al contenedor automáticamente. Sin GPU, la app separa con la CPU. |

No hace falta instalar Rust, Node.js, Python ni Visual Studio: todo se compila dentro de Docker.

### Opción A: un solo comando

```powershell
git clone https://github.com/<usuario>/AudioExtract.git
cd AudioExtract
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

El script [`scripts/install.ps1`](../scripts/install.ps1):

1. Comprueba que Docker está en marcha y si hay GPU NVIDIA.
2. Construye la imagen del motor `audioextract-engine` (la primera vez: 20–40 min según la conexión).
3. Comprueba el motor con `--check`.
4. Compila el instalador en `release\AudioExtract_<versión>_x64-setup.exe` (la primera vez ~10 min).
5. Abre el instalador.

Opciones útiles:

```powershell
scripts\install.ps1 -SkipEngine          # solo recompilar la app (el motor ya existe)
scripts\install.ps1 -SkipApp             # solo reconstruir el motor
scripts\install.ps1 -Models "htdemucs htdemucs_6s uvr_wind"   # sin la calidad máxima (−0,7 GB)
scripts\install.ps1 -NoLaunch            # no abrir el instalador al terminar
```

### Opción B: paso a paso

Con Node.js instalado, los atajos `npm run docker:*` equivalen a los comandos de la derecha:

```powershell
# 1. Motor de separación (una vez; incluye los pesos de todos los modelos)
npm run docker:engine   # docker build -f docker/engine.Dockerfile -t audioextract-engine python

# 2. Comprobar que el motor ve la GPU
npm run docker:check    # docker run --rm --gpus all --network none audioextract-engine --check
# → {"type": "device", "device": "cuda", "name": "NVIDIA GeForce …"}
# → {"type": "capabilities", "protocol": 2, "qualities": {"fast": […], "best": […]}, "wind": true, "transcription": true}

# 3. Instalador de la app → release\AudioExtract_<versión>_x64-setup.exe
npm run docker:app      # docker build -f docker/app.Dockerfile --target export --output type=local,dest=release .
```

Ejecuta el instalador. Se instala solo para tu usuario (no pide permisos de administrador) en
`%LOCALAPPDATA%\AudioExtract`. Windows SmartScreen avisará porque no está firmado: *Más información →
Ejecutar de todas formas*.

### Primer arranque

Abre AudioExtract con Docker Desktop en marcha. En la barra superior verás el estado del motor:
`CUDA` (GPU lista), `CPU` (sin GPU, más lento) o `Motor no disponible` con el motivo y el arreglo.
Suelta una canción en la ventana y elige los instrumentos. La guía de uso está en [USO.md](USO.md).

---

## macOS (Apple Silicon)

En macOS, Docker no puede usar la GPU del Mac, así que la app usa por defecto un **motor Python local**
que aprovecha Metal (MPS).

1. Instala [Homebrew](https://brew.sh) si no lo tienes, y después:

   ```bash
   brew install python@3.12 ffmpeg git
   git clone https://github.com/<usuario>/AudioExtract.git
   cd AudioExtract
   bash scripts/setup-python.sh
   ```

   El script crea un entorno en `~/Library/Application Support/com.audioextract.desktop/python/.venv`
   con PyTorch, Demucs y audio-separator, y comprueba que detecta Metal.

2. Instala la app:
   - **Desde GitHub Releases** (si el repositorio publica versiones): descarga el `.dmg` de Apple Silicon.
     Como no está firmada por Apple, la primera vez ábrela con *clic derecho → Abrir*.
   - **Desde el código**: necesitas [Rust](https://rustup.rs), Node.js 20.19+ y las herramientas de Xcode
     (`xcode-select --install`). Después: `npm ci && npm run tauri build`; la app queda en
     `src-tauri/target/release/bundle/macos/`.

La primera separación de cada calidad descarga sus modelos (hasta ~1 GB) a `~/.cache`.

---

## Windows sin Docker (motor Python)

Útil si no puedes usar Docker. Necesitas Python 3.10–3.12 y [ffmpeg](https://www.gyan.dev/ffmpeg/builds/)
en el PATH (`winget install Gyan.FFmpeg`).

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-python.ps1 -Cuda   # sin -Cuda: solo CPU
setx AUDIOEXTRACT_ENGINE python
```

Cierra y vuelve a abrir la app. El entorno queda en `%LOCALAPPDATA%\com.audioextract.desktop\python\.venv`
y la app lo encuentra sola. La app sigue necesitando su instalador (Opción A con `-SkipEngine`, u
Opción B paso 3).

---

## Actualizar

**Con un instalador nuevo**: ejecuta el `.exe` de la versión nueva con la app cerrada. Detecta la
versión instalada y **se instala encima sin preguntar ni desinstalar nada**: la biblioteca, las mezclas
guardadas y los ajustes se conservan. Es el mismo instalador que usa la actualización automática.

**Desde el repositorio**:

```powershell
git pull
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -SkipEngine
```

El instalador lleva los scripts del motor y las librerías de Python puro que necesitan, y la app los
usa con la imagen que ya tienes: **instalar la versión nueva actualiza también el motor**. Solo si el
[CHANGELOG](../CHANGELOG.md) dice expresamente que una versión requiere reconstruir la imagen (un cambio
de PyTorch o de modelos), quita `-SkipEngine` (o ejecuta `npm run docker:engine`).

**Desde la app**: si el repositorio publica versiones firmadas en GitHub Releases
([ACTUALIZACIONES.md](ACTUALIZACIONES.md)), la app avisa de la versión nueva y la instala con un clic.

---

## Desinstalar

1. **App**: *Configuración de Windows → Aplicaciones → AudioExtract → Desinstalar*. Por defecto conserva
   los ajustes; marca «Eliminar los datos de aplicación» si quieres quitarlos. La biblioteca nunca se
   borra al desinstalar.
2. **Motor**: `docker rmi audioextract-engine` (libera ~14 GB). Opcional: `docker builder prune` para
   las cachés de compilación.
3. **Biblioteca**: la carpeta `Música\AudioExtract` (o la que elegiste) es tuya: bórrala a mano si ya no
   la quieres.

---

## Variables de entorno

La app las lee al arrancar y al separar. Defínelas como variables de usuario
(`setx NOMBRE valor`) y vuelve a abrir la app.

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `AUDIOEXTRACT_ENGINE` | `docker` (`python` en macOS) | Motor de separación |
| `AUDIOEXTRACT_IMAGE` | `audioextract-engine:latest` | Imagen de Docker del motor |
| `AUDIOEXTRACT_DOCKER_GPUS` | `all` | `none` para no pasar la GPU a Docker (la app lo hace sola si Docker no puede usarla) |
| `AUDIOEXTRACT_DOCKER` | `docker` | Ruta a `docker.exe` si no está en el PATH |
| `AUDIOEXTRACT_PYTHON` | entorno de la app → `python/.venv` → `python` | Intérprete del motor Python |
| `AUDIOEXTRACT_SCRIPT` | el incluido en la app | `separate.py` alternativo (motor Python) |
| `AUDIOEXTRACT_MODEL` | — | Modelo de Demucs para 4 pistas en calidad rápida, p. ej. `htdemucs_ft` (¹) |
| `AUDIOEXTRACT_DEVICE` | `auto` | Forzar `cuda`, `cuda:1`, `mps` o `cpu` |

(¹) Con Docker el modelo tiene que estar dentro de la imagen:
`docker build -f docker/engine.Dockerfile --build-arg MODELS="htdemucs htdemucs_6s htdemucs_ft bs_roformer_sw uvr_wind" -t audioextract-engine python`.

---

## Solución de problemas

| Síntoma | Causa y solución |
| --- | --- |
| «Docker Desktop no está en marcha» | Abre Docker Desktop, espera a que diga *Engine running* y pulsa *Comprobar de nuevo* en la app. |
| «No existe la imagen audioextract-engine» | Falta construir el motor: `npm run docker:engine` (o `scripts\install.ps1 -SkipApp`). |
| La barra dice `CPU` y tienes una GPU NVIDIA | Actualiza el driver de NVIDIA y Docker Desktop. Comprueba con `docker run --rm --gpus all --network none audioextract-engine --check`. |
| «El motor instalado es de una versión anterior» | La app es nueva y el motor no: `npm run docker:engine`. Mientras tanto, separa voces/batería/bajo/otros. |
| La calidad máxima tarda mucho | Sin GPU, BS-RoFormer tarda ~3 min por minuto de canción. Usa la calidad rápida. |
| «Sin memoria» en la GPU | El motor reintenta en CPU automáticamente. Cierra otras apps que usen la GPU. |
| No se puede leer un M4A | Con el motor Python, instala ffmpeg. En Docker ya viene incluido. |
| SmartScreen bloquea el instalador | Es un instalador sin firma digital: *Más información → Ejecutar de todas formas*. |
| La compilación de Docker falla por espacio | `docker system df` y `docker builder prune` para liberar cachés. |
| El tono y el tempo aparecen deshabilitados | El módulo WASM de Signalsmith no pudo cargarse: actualiza WebView2 (Microsoft Edge). |
