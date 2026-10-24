"""Picos de forma de onda para el componente Waveform (WaveformPeaks en openapi.yaml)."""

from __future__ import annotations

import numpy as np

DEFAULT_SAMPLES_PER_PEAK = 441  # 100 picos por segundo a 44.1 kHz
PEAK_DECIMALS = 3


def compute_peaks(
    audio: np.ndarray, sample_rate: int, samples_per_peak: int = DEFAULT_SAMPLES_PER_PEAK
) -> dict:
    """audio float32 [canales, muestras] → máximo |x| por bloque, normalizado a 0–1."""
    mono_abs = np.abs(audio).max(axis=0) if audio.ndim == 2 else np.abs(audio)
    n_blocks = int(np.ceil(len(mono_abs) / samples_per_peak))
    padded = np.zeros(n_blocks * samples_per_peak, dtype=np.float32)
    padded[: len(mono_abs)] = mono_abs
    blocks = padded.reshape(n_blocks, samples_per_peak).max(axis=1)
    top = float(blocks.max()) if n_blocks else 0.0
    if top > 0:
        blocks = blocks / top
    return {
        "samplesPerPeak": samples_per_peak,
        "sampleRate": sample_rate,
        "peaks": np.round(blocks, PEAK_DECIMALS).tolist(),
    }
