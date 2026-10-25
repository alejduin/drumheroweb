"""Estados del trabajo ↔ etapas de la pantalla Importar (PLAN_V2 §3). Funciones puras."""

from __future__ import annotations

# Mismo orden y textos que la pantalla Importar
STAGES: list[tuple[str, str]] = [
    ("separate", "Separar la batería del resto"),
    ("transcribe", "Detectar golpes por pieza"),
    ("tempo", "Detectar tempo y compases"),
    ("quantize", "Cuantizar a la rejilla"),
    ("difficulties", "Generar 3 dificultades"),
]

TERMINAL_STATUSES = frozenset({"done", "failed", "canceled"})

# Etapa de app.pipeline.run.analyze → (status del trabajo, etapa de la API que corre)
PIPELINE_STAGES: dict[str, tuple[str, str]] = {
    "decode": ("separating", "separate"),
    "separate": ("separating", "separate"),
    "transcribe": ("transcribing", "transcribe"),
    "tempo": ("tempo", "tempo"),
    "quantize": ("quantizing", "quantize"),
    "finalize": ("finalizing", "difficulties"),
}

# Etapa de la API que corre en cada status en curso
_RUNNING_STAGE = {
    "separating": "separate",
    "transcribing": "transcribe",
    "tempo": "tempo",
    "quantizing": "quantize",
    "finalizing": "difficulties",
}

LOW_CONFIDENCE_THRESHOLD = 0.6

# Orden de piezas del schema (para `summary.pieces`)
PIECE_ORDER = [
    "kick",
    "snare",
    "snare_rim",
    "hihat_closed",
    "hihat_open",
    "hihat_pedal",
    "tom1",
    "tom2",
    "tom3",
    "crash",
    "ride",
]


def build_stages(status: str, failed_stage: str | None = None) -> list[dict]:
    """Lista de etapas para un status. `failed_stage` = etapa que corría al fallar o cancelar."""
    ids = [stage_id for stage_id, _ in STAGES]
    if status == "done":
        current, current_state = None, None
        done_until = len(ids)
    elif status in _RUNNING_STAGE:
        current, current_state = _RUNNING_STAGE[status], "running"
        done_until = ids.index(current)
    elif status in ("failed", "canceled") and failed_stage in ids:
        current = failed_stage
        current_state = "failed" if status == "failed" else "pending"
        done_until = ids.index(current)
    else:  # queued, o fallo antes de empezar
        current, current_state = None, None
        done_until = 0

    stages = []
    for i, (stage_id, label) in enumerate(STAGES):
        if i < done_until:
            state, progress = "done", 1.0
        elif stage_id == current and current_state:
            state, progress = current_state, 0.0
        else:
            state, progress = "pending", 0.0
        stages.append({"id": stage_id, "label": label, "state": state, "progress": progress})
    return stages


def chart_summary(chart: dict) -> dict:
    """JobSummary: alimenta las 3 tarjetas de la pantalla Importar."""
    notes = chart["difficulties"]["full"]["notes"]
    present = {n["piece"] for n in notes}
    low: dict[str, int] = {}
    for note in notes:
        if note["confidence"] < LOW_CONFIDENCE_THRESHOLD:
            low[note["piece"]] = low.get(note["piece"], 0) + 1
    return {
        "bpm": chart["bpm"],
        "timeSignature": chart["timeSignature"],
        "durationS": chart["durationS"],
        "pieces": [p for p in PIECE_ORDER if p in present],
        "lowConfidenceCount": sum(low.values()),
        "lowConfidenceByPiece": {p: low[p] for p in PIECE_ORDER if p in low},
    }
