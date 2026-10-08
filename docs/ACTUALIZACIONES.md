# Versiones y actualizaciones

AudioExtract se actualiza siempre con **el mismo instalador** que se usa para instalarlo. Hay dos formas
de lanzarlo y las dos hacen lo mismo: instalar encima, sin desinstalar, conservando la biblioteca, las
mezclas y los ajustes.

1. **A mano**: ejecutar el `AudioExtract_<versión>_x64-setup.exe` nuevo con la app cerrada.
2. **Desde la app**: si la compilación tiene el actualizador configurado, la app descarga ese mismo
   instalador desde GitHub Releases, comprueba su firma y lo ejecuta en modo pasivo; al terminar se
   vuelve a abrir.

## Cómo actualiza el instalador

El instalador NSIS de Tauri, cuando detecta una versión anterior instalada, muestra por defecto una
página «Ya está instalado» con la opción marcada «Desinstalar antes de instalar», que lanza el
desinstalador de la versión vieja con su propia ventana en mitad de la instalación.

AudioExtract usa la plantilla oficial con un parche (`src-tauri/windows/installer.nsi`, generado por
[`scripts/nsis-template.mjs`](../scripts/nsis-template.mjs)) para que, **si la versión instalada es
anterior**, el instalador entre en el mismo modo que usa el actualizador integrado (`/UPDATE`):

- no muestra la página de reinstalar ni ejecuta el desinstalador anterior;
- no pregunta la carpeta: reutiliza la de la instalación existente;
- actualiza los accesos directos que existan y no crea los que el usuario borró;
- nunca borra datos de la app ni la biblioteca.

Si la versión es **la misma**, se mantiene la página de reparar/desinstalar; si es **anterior**
(bajar de versión), también. Solo actualiza sin preguntar cuando la versión es mayor, así que **cada
publicación debe subir la versión**.

La plantilla depende de la versión de `tauri-bundler`. Tras actualizar `@tauri-apps/cli`:

```bash
npm run nsis:template     # descarga la plantilla de esa versión y reaplica el parche
```

Si el parche no encaja (Tauri cambió la plantilla), el script falla indicando qué ancla falta.

## Política de versiones

AudioExtract usa [SemVer](https://semver.org/lang/es/): `MAYOR.MENOR.PARCHE`, empezando en **1.0.0**
(la primera versión pública; las 0.x fueron versiones de desarrollo que no se publicaron). El número
dice al usuario cuánto cambia la app al actualizar, así que se elige por lo que nota quien la usa, no
por el trabajo que costó el cambio:

| Sube | Cuándo | Ejemplos |
|------|--------|----------|
| **PARCHE** `1.2.3 → 1.2.4` | Arreglos y ajustes: lo que ya había funciona mejor, nada nuevo que aprender. | Un fallo corregido, un texto o un espaciado, rendimiento, dependencias, cambios internos, documentación. |
| **MENOR** `1.2.3 → 1.3.0` | Algo nuevo que el usuario puede hacer, sin romper nada de lo que tenía. | Un instrumento, un control, un formato de exportación, un modo nuevo. |
| **MAYOR** `1.2.3 → 2.0.0` | El usuario tiene que hacer algo o pierde algo al actualizar. | Hay que reconstruir el motor a mano, la biblioteca o las mezclas guardadas dejan de abrirse, se quita una función, deja de funcionar en un sistema que antes funcionaba. |

Reglas de trabajo:

- **Cada cambio se anota en «Sin publicar»** del CHANGELOG al hacerlo (Añadido, Cambiado, Corregido,
  Eliminado). Si un cambio sería mayor, se busca primero la forma de que no lo sea: por ejemplo, que la
  app migre las mezclas antiguas o complete el motor por sí misma.
- **Una versión agrupa todo lo que hay en «Sin publicar»** y sube un solo escalón: el del cambio más
  grande. Tres arreglos y una función nueva son una sola versión menor, no tres parches y una menor.
- **No hay números de relleno**: no se salta de la 1.2 a la 2.0 por marketing ni se reutiliza un
  número ya publicado. Si una versión sale con un fallo, se corrige con otra versión (parche); una
  etiqueta publicada no se mueve.
- **El motor tiene su propia versión** (el `protocol` de `--check`, ver más abajo) y no sigue a la de la
  app: la app 1.4 puede usar el motor 2.

## Publicar una versión

### Una sola vez: preparar el actualizador

```bash
npm run updater:setup -- --repo <usuario>/<repositorio>
```

Esto:

1. Genera el par de claves de firma **fuera del repositorio**, en `~/.tauri/audioextract.key` (y `.pub`).
   Para ponerle contraseña, define antes `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
2. Escribe la clave pública y la URL
   `https://github.com/<usuario>/<repositorio>/releases/latest/download/latest.json` en
   `src-tauri/tauri.conf.json` (esto sí se sube a git).
3. Te recuerda añadir en GitHub (*Settings → Secrets and variables → Actions*):
   - `TAURI_SIGNING_PRIVATE_KEY`: el contenido del archivo `.key`.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: la contraseña (o vacío).

> La clave privada es la identidad de tus actualizaciones. Si se pierde, las instalaciones existentes
> no aceptarán versiones firmadas con otra clave (habrá que actualizar a mano una vez). Si se filtra,
> cualquiera podría firmar «actualizaciones». Haz copia de seguridad y no la subas nunca a git
> (`.gitignore` ya excluye `*.key`).

### Cada versión

```bash
npm run version:set -- minor      # o patch / major / 1.3.0 — ver «Política de versiones»
npm run docker:app                # release/AudioExtract_<versión>_x64-setup.exe para probarlo
git commit -am "Versión 1.3.0"
git tag -a v1.3.0 -m "Versión 1.3.0"   # anotada: --follow-tags solo sube estas
git push --follow-tags
```

`version:set` cambia la versión en `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` y
`Cargo.lock`, y pasa la sección «Sin publicar» del CHANGELOG a la versión nueva con la fecha de hoy.
Se niega si la versión no sube, si «Sin publicar» está vacía o si pides `patch` habiendo novedades en
«Añadido».

La etiqueta dispara `.github/workflows/release.yml`. Primero `scripts/check-version.mjs` comprueba que
la etiqueta, la versión de todos esos archivos y el CHANGELOG coinciden (la CI lo comprueba también en
cada push). Después compila el instalador de Windows y la app de macOS (Apple Silicon), crea la GitHub
Release con las novedades de esa versión copiadas del CHANGELOG y, con los secretos de firma, sube
también los `.sig` y `latest.json`. A partir de ahí, las apps instaladas con el actualizador
configurado verán el aviso con esas mismas novedades.

Sin los secretos, la publicación funciona igual pero sin artefactos del actualizador: los usuarios
actualizan ejecutando el instalador nuevo.

### Compilar una versión a mano (sin GitHub Actions)

```bash
npm run docker:app                # release/AudioExtract_<versión>_x64-setup.exe, sin firma de actualizador
```

Para generar también los artefactos firmados en local:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $HOME\.tauri\audioextract.key
npx tauri build --config src-tauri/tauri.release.conf.json   # requiere Rust nativo
```

y sube a la release el instalador, su `.sig` y un `latest.json` como este:

```json
{
  "version": "1.3.0",
  "notes": "Novedades…",
  "pub_date": "2026-10-01T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contenido del .sig>",
      "url": "https://github.com/<usuario>/<repositorio>/releases/download/v1.3.0/AudioExtract_1.3.0_x64-setup.exe"
    }
  }
}
```

## El motor también tiene versión

La imagen del motor se construye aparte (`npm run docker:engine`) y no se actualiza con la app. La app
pregunta al motor qué sabe hacer (`--check`, campo `protocol`): si es antiguo, sigue funcionando con lo
que tenga y avisa de que conviene reconstruirlo. Indica en el CHANGELOG cuándo una versión requiere
reconstruir el motor.

## Firma de código

Los instaladores no llevan firma de código de Windows (Authenticode) ni de Apple, por eso SmartScreen y
Gatekeeper avisan la primera vez. Es independiente de la firma del actualizador. Para firmarlos,
consulta la guía de Tauri sobre
[firma en Windows](https://v2.tauri.app/distribute/sign/windows/) y
[en macOS](https://v2.tauri.app/distribute/sign/macos/).
