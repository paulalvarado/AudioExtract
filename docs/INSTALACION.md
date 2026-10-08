# Instalar AudioExtract

Basta con instalar la app. La primera vez que la abres, ella misma instala su **motor de separación**
(Python, PyTorch y los modelos) con un clic. Elige la variante según tu equipo: con CUDA si tienes una
GPU NVIDIA, con Metal en un Mac con Apple Silicon y para el procesador en el resto. No hace falta Docker,
ni Python, ni ningún paso con comandos.

- [Lo que necesitas](#lo-que-necesitas)
- [Instalar la app](#instalar-la-app)
- [Primer arranque: el motor](#primer-arranque-el-motor)
- [Actualizar](#actualizar)
- [Desinstalar](#desinstalar)
- [Otros motores: Docker o tu propio Python](#otros-motores-docker-o-tu-propio-python)
- [Variables de entorno](#variables-de-entorno)
- [Solución de problemas](#solución-de-problemas)

---

## Lo que necesitas

| | Detalle |
| --- | --- |
| Sistema | Windows 10 u 11 de 64 bits, o macOS 14 o posterior en un Mac con Apple Silicon. |
| Conexión a internet | Solo la primera vez, para descargar el motor. Después separa sin conexión. |
| Espacio libre | Unos 9,5 GB durante la instalación del motor con GPU NVIDIA (luego ocupa ~5,9 GB) o 5,5 GB sin ella (luego, ~2 GB). Además, ~40 MB por minuto de canción separada. |
| GPU NVIDIA (opcional) | Con 2 GB de memoria o más y un driver reciente (527 o posterior). Sin ella, separa con el procesador, más despacio. Las GPU de otras marcas no se usan. |
| Memoria | 8 GB; 16 GB recomendados para la calidad máxima. |

---

## Instalar la app

### Desde GitHub Releases

Descarga el instalador de la [última versión](https://github.com/paulalvarado/AudioExtract/releases/latest):

- **Windows**: `AudioExtract_<versión>_x64-setup.exe`. Se instala solo para tu usuario (no pide permisos
  de administrador) en `%LOCALAPPDATA%\AudioExtract`. Windows SmartScreen avisará porque el instalador
  no está firmado: *Más información → Ejecutar de todas formas*.
- **macOS**: el `.dmg` de Apple Silicon. Como la app no está firmada por Apple, la primera vez ábrela con
  *clic derecho → Abrir*.

### Compilarla desde el código (Windows)

Para compilar hace falta [Docker Desktop](https://www.docker.com/products/docker-desktop/) (con WSL2)
y [Git](https://git-scm.com/download/win). Rust, Node y Visual Studio no hacen falta, porque todo se
compila dentro de Docker. La app que sale no usa Docker para nada.

```powershell
git clone https://github.com/paulalvarado/AudioExtract.git
cd AudioExtract
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

[`scripts/install.ps1`](../scripts/install.ps1) compila el instalador en
`release\AudioExtract_<versión>_x64-setup.exe` (la primera vez, unos 10 min) y lo abre. Equivale a
`npm run docker:app`. Con `-NoLaunch` no abre el instalador.

### Compilarla desde el código (macOS)

Necesitas [Rust](https://rustup.rs), Node.js 20.19+ y las herramientas de Xcode
(`xcode-select --install`). Después: `npm ci && npm run tauri build`; la app queda en
`src-tauri/target/release/bundle/macos/`.

---

## Primer arranque: el motor

Al abrir la app sin motor, el panel «Nueva extracción» muestra lo que detectó en tu equipo (GPU, memoria
y procesador), con qué separará, cuánto descarga y cuánto ocupará. Pulsa **Instalar el motor**. El
avance se ve en el panel y en la barra superior, paso a paso: Python, PyTorch y las librerías de audio,
ffmpeg, los modelos y una comprobación final. Mientras tanto puedes seguir escuchando tu biblioteca.

| Tu equipo | Variante | Descarga | Ocupa |
| --- | --- | --- | --- |
| GPU NVIDIA de la serie 16, 20 o posterior (capacidad de cómputo 7.0+) | PyTorch con CUDA 12.8 | ≈4,4 GB | ≈5,9 GB |
| GPU NVIDIA anterior (Maxwell, Pascal: GTX 900/1000) | PyTorch con CUDA 12.6 | ≈3,9 GB | ≈5,1 GB |
| Sin GPU NVIDIA, driver anterior al 527 o GPU de menos de 2 GB | PyTorch para el procesador | ≈1,8 GB | ≈2,0 GB |
| Mac con Apple Silicon | PyTorch con Metal | ≈1,3 GB | ≈2,1 GB |

(GB binarios, como los cuenta el explorador de archivos. Durante la instalación se ocupa más espacio
temporalmente: el panel avisa si no hay suficiente.)

- **Dónde queda**: `%LOCALAPPDATA%\com.audioextract.desktop\engine` en Windows y
  `~/Library/Application Support/com.audioextract.desktop/engine` en macOS. Ajustes → Motor de separación
  muestra la ruta.
- **Si se corta** (sin conexión, o porque pulsas *Detener*): vuelve a pulsar el botón. Lo ya descargado
  no se repite.
- **Reinstalar**: Ajustes → Motor de separación → *Reinstalar el motor*. Úsalo si algo se estropea o si
  cambias de GPU. Si instalaste una GPU NVIDIA después, Ajustes te avisa de que el motor puede
  aprovecharla.
- **Privacidad**: la descarga sale de los repositorios oficiales (python-build-standalone, PyTorch, PyPI
  y los de cada modelo) y cada paquete se comprueba contra el SHA-256 que trae la app. Al separar, el
  motor no usa la red.

---

## Actualizar

**Con un instalador nuevo**: ejecuta el `.exe` de la versión nueva con la app cerrada. Detecta la
versión instalada y **se instala encima sin preguntar ni desinstalar nada**: la biblioteca, las mezclas,
los ajustes y el motor se conservan. Es el mismo instalador que usa la actualización automática.

**Desde la app**: si el repositorio publica versiones firmadas en GitHub Releases
([ACTUALIZACIONES.md](ACTUALIZACIONES.md)), la app avisa de la versión nueva y la instala con un clic.

**El motor se pone al día solo**: si una versión nueva necesita otras versiones de los paquetes del
motor u otros modelos, la app lo detecta al abrirse y lo actualiza sin preguntar. Solo descarga lo que
cambió, y el avance se ve en la barra superior. Si la versión solo cambia los scripts del motor, no hay
nada que descargar: viajan con el instalador.

---

## Desinstalar

1. **App y motor**: *Configuración de Windows → Aplicaciones → AudioExtract → Desinstalar*. Marca
   «Eliminar los datos de aplicación» para borrar también el motor (la carpeta `engine`) y los ajustes.
   Si no la marcas, se conservan para una próxima instalación.
2. **Biblioteca**: la carpeta `Música\AudioExtract` (o la que elegiste) es tuya y nunca se borra al
   desinstalar. Bórrala a mano si ya no la quieres.
3. Si alguna vez construiste la imagen Docker del motor: `docker rmi audioextract-engine` libera ~14 GB.

---

## Otros motores: Docker o tu propio Python

El motor integrado es el predeterminado y el recomendado. Para desarrollar o en sistemas que no lo
admiten (Linux, Mac con Intel), la app también puede usar:

- **Tu propio Python** (3.10–3.12) con las dependencias del motor: `scripts\setup-python.ps1 -Dev` (o
  `bash scripts/setup-python.sh --dev`) crea `python/.venv` en el repositorio, y la app lo usa si no hay
  motor integrado. Para otro intérprete, define `AUDIOEXTRACT_PYTHON`. Necesita ffmpeg en el PATH.
- **Docker** (Windows y Linux con GPU NVIDIA vía WSL2): construye la imagen con
  `npm run docker:engine` (o `scripts\install.ps1 -DockerEngine`) y define
  `setx AUDIOEXTRACT_ENGINE docker`. Docker Desktop tiene que estar abierto para separar.

---

## Variables de entorno

La app las lee al arrancar y al separar. Defínelas como variables de usuario
(`setx NOMBRE valor`) y vuelve a abrir la app. Ninguna hace falta con el motor integrado.

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `AUDIOEXTRACT_ENGINE` | `python` | `python`: el motor integrado (o el de `AUDIOEXTRACT_PYTHON`); `docker`: la imagen de Docker |
| `AUDIOEXTRACT_PYTHON` | motor integrado → `python/.venv` del repo | Intérprete de Python con las dependencias del motor |
| `AUDIOEXTRACT_SCRIPT` | el incluido en la app | `separate.py` alternativo |
| `AUDIOEXTRACT_MODEL` | — | Modelo de Demucs para 4 pistas en calidad rápida, p. ej. `htdemucs_ft` (¹) |
| `AUDIOEXTRACT_DEVICE` | `auto` | Forzar `cuda`, `cuda:1`, `mps` o `cpu` |
| `AUDIOEXTRACT_IMAGE` | `audioextract-engine:latest` | Imagen de Docker del motor |
| `AUDIOEXTRACT_DOCKER_GPUS` | `all` | `none` para no pasar la GPU a Docker (la app lo hace sola si Docker no puede usarla) |
| `AUDIOEXTRACT_DOCKER` | `docker` | Ruta a `docker.exe` si no está en el PATH |
| `AUDIOEXTRACT_UV` | el incluido en la app | `uv` alternativo para instalar el motor integrado (pruebas) |

(¹) El motor integrado y la imagen Docker solo usan modelos ya descargados. Con Docker:
`docker build -f docker/engine.Dockerfile --build-arg MODELS="htdemucs htdemucs_6s htdemucs_ft bs_roformer_sw uvr_wind" -t audioextract-engine python`.

---

## Solución de problemas

| Síntoma | Causa y solución |
| --- | --- |
| «No se pudo descargar» al instalar el motor | Sin conexión o se cortó. Pulsa *Reintentar*: lo ya descargado no se repite. Si estás detrás de un proxy, define `HTTPS_PROXY`. |
| «Hacen falta X GB libres» | Libera espacio en el disco de `%LOCALAPPDATA%` y vuelve a abrir el panel. |
| La barra dice `CPU` y tienes una GPU NVIDIA | Actualiza el driver de NVIDIA y, en Ajustes, pulsa *Reinstalar el motor*: la app vuelve a mirar tu GPU. |
| «El motor se instaló, pero no arranca» | Pulsa *Reinstalar el motor*. Si persiste, el mensaje de debajo dice qué falló; abre una incidencia en GitHub con él. |
| La calidad máxima tarda mucho | Sin GPU, BS-RoFormer tarda ~3 min por minuto de canción. Usa la calidad rápida. |
| «Sin memoria» en la GPU | El motor reintenta en CPU automáticamente. Cierra otras apps que usen la GPU. |
| SmartScreen bloquea el instalador | Es un instalador sin firma digital: *Más información → Ejecutar de todas formas*. |
| La compilación de Docker falla por espacio | `docker system df` y `docker builder prune` para liberar cachés. |
| El tono y el tempo aparecen deshabilitados | El módulo WASM de Signalsmith no pudo cargarse: actualiza WebView2 (Microsoft Edge). |
