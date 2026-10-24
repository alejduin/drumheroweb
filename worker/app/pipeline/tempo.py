"""Etapa 3 — beats y downbeats con beat_this (CPJKU)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

BEAT_THIS_CHECKPOINT = "final0"


@dataclass(frozen=True)
class BeatGrid:
    beats: np.ndarray  # segundos, ascendente
    downbeats: np.ndarray  # segundos, subconjunto (aprox.) de beats


class BeatTracker:
    """Carga beat_this una vez. Sin DBN (madmom): el post-proceso propio basta."""

    def __init__(self, device: str = "cpu", checkpoint: str = BEAT_THIS_CHECKPOINT) -> None:
        from beat_this.inference import Audio2Beats

        self.checkpoint = checkpoint
        self._audio2beats = Audio2Beats(checkpoint_path=checkpoint, device=device, dbn=False)

    def track(self, mono: np.ndarray, sample_rate: int) -> BeatGrid:
        """mono: float32 [muestras] → BeatGrid en segundos."""
        beats, downbeats = self._audio2beats(np.ascontiguousarray(mono, dtype=np.float32), sample_rate)
        return BeatGrid(
            beats=np.asarray(beats, dtype=np.float64),
            downbeats=np.asarray(downbeats, dtype=np.float64),
        )
