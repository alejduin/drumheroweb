"""Identificadores de modelos para `health` y para chart.source.model."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from app.pipeline.separate import DEMUCS_MODEL
from app.pipeline.tempo import BEAT_THIS_CHECKPOINT
from app.pipeline.transcribe import ADTOF_COMMIT


def _pkg(name: str) -> str:
    try:
        return version(name)
    except PackageNotFoundError:
        return "no-instalado"


def model_versions() -> dict[str, str]:
    """Mismas claves que HealthResponse.models en shared/openapi.yaml."""
    return {
        "demucs": f"{DEMUCS_MODEL}@demucs-{_pkg('demucs')}",
        "adtof": f"frame_rnn@adtof-pytorch-{ADTOF_COMMIT[:7]}",
        "beatThis": f"{BEAT_THIS_CHECKPOINT}@beat-this-{_pkg('beat-this')}",
    }


def model_tag() -> str:
    """Valor compacto para chart.source.model."""
    v = model_versions()
    return "+".join((v["demucs"], v["adtof"], v["beatThis"]))
