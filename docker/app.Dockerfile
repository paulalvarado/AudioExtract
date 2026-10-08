# syntax=docker/dockerfile:1.7
#
# Compila AudioExtract para Windows desde Linux (Tauri + cargo-xwin) y deja el
# instalador en ./release, sin instalar Rust, Node ni Visual Studio en el equipo:
#
#   docker build -f docker/app.Dockerfile --target export --output type=local,dest=release .
#
# Los tests de Rust también se compilan para Windows y se ejecutan en el equipo:
#
#   docker build -f docker/app.Dockerfile --target tests --output type=local,dest=release/tests .
#   release\tests\audioextract-tests.exe
#
# cargo-xwin descarga el CRT de MSVC y el SDK de Windows; al usarlo se aceptan
# sus licencias: https://go.microsoft.com/fwlink/?LinkId=2086102

FROM rust:1-trixie AS toolchain

ARG CARGO_XWIN_VERSION=0.23.1
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends nsis clang lld llvm \
 && rm -rf /var/lib/apt/lists/*

# cargo-xwin y tauri-winres buscan las herramientas sin sufijo de versión.
# Debian no trae `clang-cl`, pero clang entra en ese modo si se invoca con ese nombre.
RUN set -eu; \
    llvm_bin="$(ls -d /usr/lib/llvm-*/bin | sort -V | tail -n1)"; \
    for tool in lld-link llvm-rc llvm-lib llvm-dlltool; do \
      if ! command -v "$tool" >/dev/null 2>&1 && [ -e "$llvm_bin/$tool" ]; then \
        ln -s "$llvm_bin/$tool" "/usr/local/bin/$tool"; \
      fi; \
    done; \
    command -v clang-cl >/dev/null 2>&1 || ln -s "$llvm_bin/clang" /usr/local/bin/clang-cl; \
    clang-cl --version; lld-link --version; \
    for tool in llvm-rc llvm-lib makensis; do command -v "$tool"; done

RUN rustup target add x86_64-pc-windows-msvc \
 && cargo install --locked "cargo-xwin@${CARGO_XWIN_VERSION}"

COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

FROM toolchain AS build
# Cachés de BuildKit: las recompilaciones solo rehacen lo que cambió.
# Antes de exportar se comprueba que el instalador lleva el motor de la app (scripts y ruedas de
# Python): sin eso, una versión nueva no funcionaría con la imagen del motor que ya hay instalada.
# Solo se exporta el instalador de esta versión (la caché guarda también los de versiones anteriores).
# /root/.cache/tauri guarda las utilidades de NSIS que Tauri baja de GitHub: sin caché las descargaba en
# cada construcción, y esa descarga no tiene tiempo de espera (en la 0.4.0 se quedó colgada).
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/root/.cache/cargo-xwin \
    --mount=type=cache,target=/root/.cache/tauri \
    --mount=type=cache,target=/src/src-tauri/target \
    npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis \
 && nsi="$(find src-tauri/target/x86_64-pc-windows-msvc/release/nsis -name '*.nsi' | head -n1)" \
 && for file in separate.py transcribe.py catalog.py basic_pitch-0.4.0-py2.py3-none-any.whl; do \
      grep -q "$file" "$nsi" || { echo "El instalador no incluye $file" >&2; exit 1; }; \
    done \
 && version="$(node -p "require('./package.json').version")" \
 && mkdir -p /out \
 && cp "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/AudioExtract_${version}_x64-setup.exe" /out/

FROM scratch AS export
COPY --from=build /out/ /

FROM toolchain AS test-build
# `generate_context!` embebe ../dist al compilar, así que el frontend va primero.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/root/.cache/cargo-xwin \
    --mount=type=cache,target=/src/src-tauri/target \
    npm run build \
 && cd src-tauri \
 && cargo xwin test --no-run --lib --target x86_64-pc-windows-msvc \
 && mkdir -p /out \
 && cp "$(ls -t target/x86_64-pc-windows-msvc/debug/deps/audioextract_lib-*.exe | head -n1)" /out/audioextract-tests.exe

FROM scratch AS tests
COPY --from=test-build /out/ /
