# Worker de análisis de DrumHero AI (PoC Fase A; base del servicio de la Fase B).
# CPU por defecto. Para GPU:
#   docker compose build --build-arg TORCH_VARIANT=cu124 poc
FROM python:3.10-slim-bookworm

# Variante de torch: cpu | cu121 | cu124. El sufijo local (2.5.1+cpu) obliga a
# tomarlo del índice de PyTorch; el resto de dependencias sale de PyPI.
ARG TORCH_VARIANT=cpu
ARG TORCH_VERSION=2.5.1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10 \
    # Pesos de Demucs y beat_this (torch.hub) en un volumen persistente
    TORCH_HOME=/models/torch \
    NUMBA_CACHE_DIR=/tmp/numba

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libsndfile1 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Las wheels de torch (~175 MB en CPU, ~2 GB en CUDA) se bajan con curl, que reanuda
# descargas cortadas (pip no), sobre una caché de BuildKit que sobrevive entre builds.
RUN --mount=type=cache,target=/wheels \
    set -eu; \
    base="https://download-r2.pytorch.org/whl/${TORCH_VARIANT}"; \
    for pkg in torch torchaudio; do \
      whl="${pkg}-${TORCH_VERSION}+${TORCH_VARIANT}-cp310-cp310-linux_x86_64.whl"; \
      # Wheel ya completa en la caché (zip íntegro) → no descargar; a medias → reanudar
      python -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1])" "/wheels/${whl}" 2>/dev/null \
        || curl -fL --retry 20 --retry-all-errors --retry-delay 3 -C - \
             -o "/wheels/${whl}" "${base}/$(echo "${whl}" | sed 's/+/%2B/')"; \
    done; \
    pip install "/wheels/torch-${TORCH_VERSION}+${TORCH_VARIANT}-cp310-cp310-linux_x86_64.whl" \
                "/wheels/torchaudio-${TORCH_VERSION}+${TORCH_VARIANT}-cp310-cp310-linux_x86_64.whl"

COPY requirements.txt /tmp/requirements.txt
# La caché de pip (montada, no queda en la imagen) conserva lo ya descargado:
# si la red corta a mitad, el siguiente intento continúa en vez de empezar de cero.
RUN --mount=type=cache,target=/root/.cache/pip \
    for attempt in 1 2 3 4 5; do \
      pip install -r /tmp/requirements.txt && exit 0; \
      echo "pip falló (intento ${attempt}), reintentando..."; sleep 5; \
    done; exit 1

COPY requirements-api.txt /tmp/requirements-api.txt
RUN --mount=type=cache,target=/root/.cache/pip pip install -r /tmp/requirements-api.txt

# Herramientas de desarrollo (lint/format); capa aparte para no invalidar la caché anterior
RUN --mount=type=cache,target=/root/.cache/pip pip install ruff==0.7.4

RUN useradd --create-home --uid 1000 worker \
 && mkdir -p /models /work /data \
 && chown worker:worker /models /work /data
USER worker
WORKDIR /work

COPY --chown=worker:worker . /work

ENTRYPOINT ["python", "-m", "poc"]
CMD ["--help"]
