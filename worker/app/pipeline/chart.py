"""Etapa 5 — armar y validar el chart v2 (shared/chart-v2.schema.json).

El worker solo emite la dificultad `full`; `basic` e `intermediate` van vacías y
las genera el cliente con generateDifficulties (PLAN_V2 D13).
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import cache
from pathlib import Path

import numpy as np

from app.pipeline.dynamics import dynamic_for
from app.pipeline.quantize import QuantizedOnset

# Mismo valor que TIME_EPSILON_S en src/constants/chart.ts
TIME_EPSILON_S = 0.0005
DOWNBEAT_MATCH_S = 0.07  # distancia máxima para asociar un downbeat a un beat
TIME_DECIMALS = 4
CONFIDENCE_DECIMALS = 3
DEFAULT_BEATS_PER_BAR = 4
_ID_INVALID = re.compile(r"[^A-Za-z0-9_-]+")


@dataclass(frozen=True)
class SongMeta:
    id: str
    title: str
    artist: str
    duration_s: float
    audio_url: str | None
    stems: dict[str, str] | None
    audio_sha256: str | None


@dataclass(frozen=True)
class CleanGrid:
    beats: list[float]
    downbeats: list[float]


def song_id_from_name(name: str, fallback: str) -> str:
    """'01 Rock simple.mp3' → '01-Rock-simple' (patrón del schema)."""
    slug = _ID_INVALID.sub("-", Path(name).stem).strip("-_")[:128]
    return slug or fallback


def clean_grid(beats: np.ndarray, downbeats: np.ndarray, duration_s: float) -> CleanGrid:
    """Deja la rejilla de beat_this conforme a las invariantes del chart.

    beats estrictamente ascendentes dentro de [0, duration]; cada downbeat se
    reemplaza por el beat más cercano (si está a <= DOWNBEAT_MATCH_S) y se
    descartan duplicados. Sin downbeats válidos, el compás 1 empieza en el primer beat.
    """
    rounded = np.round(np.sort(np.asarray(beats, dtype=np.float64)), TIME_DECIMALS)
    rounded = rounded[(rounded >= 0) & (rounded <= duration_s)]
    clean_beats: list[float] = []
    for b in rounded:
        if not clean_beats or b - clean_beats[-1] > TIME_EPSILON_S:
            clean_beats.append(float(b))
    if not clean_beats:
        raise ValueError("la rejilla no tiene beats")

    beat_arr = np.array(clean_beats)
    clean_downbeats: list[float] = []
    for d in np.sort(np.asarray(downbeats, dtype=np.float64)):
        nearest = float(beat_arr[np.argmin(np.abs(beat_arr - d))])
        if abs(nearest - d) <= DOWNBEAT_MATCH_S and (not clean_downbeats or nearest > clean_downbeats[-1]):
            clean_downbeats.append(nearest)
    return CleanGrid(beats=clean_beats, downbeats=clean_downbeats or [clean_beats[0]])


def estimate_bpm(beats: list[float]) -> float:
    """Tempo medio a partir de la mediana del intervalo entre beats."""
    if len(beats) < 2:
        return 120.0
    return round(60.0 / float(np.median(np.diff(beats))), 2)


def estimate_beats_per_bar(grid: CleanGrid) -> int:
    """Moda de beats entre downbeats consecutivos (numerador del compás)."""
    if len(grid.downbeats) < 2:
        return DEFAULT_BEATS_PER_BAR
    positions = np.searchsorted(np.array(grid.beats), np.array(grid.downbeats))
    counts = np.diff(positions)
    counts = counts[(counts >= 1) & (counts <= 32)]
    if len(counts) == 0:
        return DEFAULT_BEATS_PER_BAR
    values, freq = np.unique(counts, return_counts=True)
    return int(values[np.argmax(freq)])


def build_chart(
    meta: SongMeta,
    grid: CleanGrid,
    notes: list[QuantizedOnset],
    velocities: list[int],
    model: str,
    created_at: datetime | None = None,
) -> dict:
    full = []
    for note, velocity in sorted(zip(notes, velocities, strict=True), key=lambda nv: (nv[0].t, nv[0].piece)):
        if note.t_raw > meta.duration_s:
            continue
        full.append(
            {
                "t": round(min(note.t, meta.duration_s), TIME_DECIMALS),
                "piece": note.piece,
                "velocity": int(velocity),
                "confidence": round(float(np.clip(note.confidence, 0, 1)), CONFIDENCE_DECIMALS),
                "dynamic": dynamic_for(int(velocity)),
                "tRaw": round(note.t_raw, TIME_DECIMALS),
            }
        )
    created = (created_at or datetime.now(timezone.utc)).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "version": 2,
        "id": meta.id,
        "title": meta.title,
        "artist": meta.artist,
        "bpm": estimate_bpm(grid.beats),
        "timeSignature": [estimate_beats_per_bar(grid), 4],
        "durationS": round(meta.duration_s, TIME_DECIMALS),
        "audioUrl": meta.audio_url,
        "stems": meta.stems,
        "audioSha256": meta.audio_sha256,
        "youtubeUrl": None,
        "youtubeOffsetMs": 0,
        "grid": {"beats": grid.beats, "downbeats": grid.downbeats},
        "difficulties": {"basic": {"notes": []}, "intermediate": {"notes": []}, "full": {"notes": full}},
        "sections": [],
        "source": {"kind": "ai", "model": model, "createdAt": created},
    }


# ─── Validación ──────────────────────────────────────────────────────────────


def shared_dir() -> Path:
    env = os.environ.get("DRUMHERO_SHARED_DIR")
    return Path(env) if env else Path(__file__).resolve().parents[3] / "shared"


@cache
def _schema_validator():
    from jsonschema import Draft202012Validator, FormatChecker

    schema = json.loads((shared_dir() / "chart-v2.schema.json").read_text())
    return Draft202012Validator(schema, format_checker=FormatChecker())


def validate_chart(chart: dict) -> list[str]:
    """Errores del schema y, si lo pasa, de las invariantes. Vacía = válido."""
    errors = [
        f"{'/'.join(map(str, e.absolute_path)) or '(raíz)'}: {e.message}"
        for e in _schema_validator().iter_errors(chart)
    ]
    return errors or chart_invariant_issues(chart)


def chart_invariant_issues(chart: dict) -> list[str]:
    """Port de validateChartInvariants (src/chart/invariants.ts); mismos mensajes."""
    issues: list[str] = []
    max_t = chart["durationS"] + TIME_EPSILON_S
    beats, downbeats = chart["grid"]["beats"], chart["grid"]["downbeats"]

    for i in range(1, len(beats)):
        if beats[i] <= beats[i - 1]:
            issues.append(f"grid.beats[{i}]: los beats deben ser estrictamente ascendentes")
    if beats[-1] > max_t:
        issues.append("grid.beats: hay beats después de durationS")

    for i, d in enumerate(downbeats):
        if i > 0 and d <= downbeats[i - 1]:
            issues.append(f"grid.downbeats[{i}]: los downbeats deben ser estrictamente ascendentes")
        if not any(abs(b - d) <= TIME_EPSILON_S for b in beats):
            issues.append(f"grid.downbeats[{i}]: el downbeat no coincide con ningún beat")

    for difficulty in ("basic", "intermediate", "full"):
        notes = chart["difficulties"][difficulty]["notes"]
        for i, note in enumerate(notes):
            path = f"difficulties.{difficulty}.notes[{i}]"
            if i > 0 and note["t"] < notes[i - 1]["t"]:
                issues.append(f"{path}: las notas deben estar ordenadas por t")
            if note["t"] > max_t:
                issues.append(f"{path}: la nota está después de durationS")
            if "tRaw" in note and note["tRaw"] > max_t:
                issues.append(f"{path}: tRaw está después de durationS")

    measure_count = len(downbeats)
    previous_end = 0
    for i, section in enumerate(chart["sections"]):
        path = f"sections[{i}]"
        if section["endMeasure"] < section["startMeasure"]:
            issues.append(f"{path}: endMeasure debe ser >= startMeasure")
        if section["startMeasure"] <= previous_end:
            issues.append(f"{path}: las secciones deben estar ordenadas y sin solaparse")
        if section["endMeasure"] > measure_count:
            issues.append(f"{path}: la sección termina después del último compás ({measure_count})")
        previous_end = max(previous_end, section["startMeasure"], section["endMeasure"])
    return issues
