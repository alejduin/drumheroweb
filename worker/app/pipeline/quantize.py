"""Etapa 4 — ajustar los golpes a la rejilla real de beats.

La rejilla se subdivide entre cada par de beats consecutivos (sigue la deriva de
tempo). Solo se ajusta un golpe si queda a <= tolerancia de un punto: si no, se
deja en su tiempo real para no alejarlo de donde suena (el jugador toca con la
música y se le evalúa contra `t`). `tRaw` conserva siempre el onset original.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.pipeline.transcribe import Onset

DEFAULT_SUBDIVISIONS = 4  # semicorcheas
TRIPLET_SUBDIVISIONS = 3  # tresillos de corchea
DEFAULT_TOLERANCE_S = 0.035
SAME_POINT_EPS_S = 1e-4


@dataclass(frozen=True)
class QuantizeOptions:
    subdivisions: int = DEFAULT_SUBDIVISIONS
    triplets: bool = False
    tolerance_s: float = DEFAULT_TOLERANCE_S


@dataclass(frozen=True)
class QuantizedOnset:
    t: float
    t_raw: float
    piece: str
    confidence: float
    snapped: bool


def build_grid(beats: np.ndarray, duration_s: float, options: QuantizeOptions) -> np.ndarray:
    """Puntos de rejilla en [0, duration_s], subdividiendo cada intervalo entre beats.

    Antes del primer beat y después del último se extrapola con el intervalo vecino
    (anacrusas y finales).
    """
    beats = np.asarray(beats, dtype=np.float64)
    if len(beats) < 2:
        return beats.copy()

    divisions = [options.subdivisions]
    if options.triplets:
        divisions.append(TRIPLET_SUBDIVISIONS)
    fractions = np.unique(np.concatenate([np.arange(d) / d for d in divisions]))

    first_step, last_step = beats[1] - beats[0], beats[-1] - beats[-2]
    n_before = int(np.ceil(beats[0] / first_step)) if first_step > 0 else 0
    n_after = int(np.ceil((duration_s - beats[-1]) / last_step)) if last_step > 0 else 0
    extended = np.concatenate(
        [
            beats[0] - first_step * np.arange(n_before, 0, -1),
            beats,
            beats[-1] + last_step * np.arange(1, n_after + 1),
        ]
    )
    steps = np.diff(extended)
    points = (extended[:-1, None] + steps[:, None] * fractions[None, :]).ravel()
    points = np.append(points, extended[-1])
    return np.unique(points[(points >= 0) & (points <= duration_s)])


def snap(times: np.ndarray, grid: np.ndarray, tolerance_s: float) -> tuple[np.ndarray, np.ndarray]:
    """→ (tiempos ajustados, máscara de los que se ajustaron)."""
    times = np.asarray(times, dtype=np.float64)
    if len(grid) == 0 or len(times) == 0:
        return times.copy(), np.zeros(len(times), dtype=bool)
    right_idx = np.clip(np.searchsorted(grid, times), 0, len(grid) - 1)
    left_idx = np.clip(right_idx - 1, 0, len(grid) - 1)
    left, right = grid[left_idx], grid[right_idx]
    nearest = np.where(np.abs(times - left) <= np.abs(right - times), left, right)
    snapped = np.abs(nearest - times) <= tolerance_s
    return np.where(snapped, nearest, times), snapped


def quantize(onsets: list[Onset], grid: np.ndarray, tolerance_s: float) -> list[QuantizedOnset]:
    """Ajusta y resuelve colisiones: dos golpes de la misma pieza en el mismo punto
    se funden en uno (se queda el de mayor confianza). Orden por (t, pieza)."""
    times, mask = snap(np.array([o.t for o in onsets]), grid, tolerance_s)
    best: dict[tuple[int, str], QuantizedOnset] = {}
    for onset, t, did_snap in zip(onsets, times, mask, strict=True):
        note = QuantizedOnset(
            t=float(t), t_raw=onset.t, piece=onset.piece, confidence=onset.confidence, snapped=bool(did_snap)
        )
        key = (round(t / SAME_POINT_EPS_S), onset.piece)
        if key not in best or note.confidence > best[key].confidence:
            best[key] = note
    return sorted(best.values(), key=lambda n: (n.t, n.piece))
