"""Groove sintético con verdad conocida, para tests sin audio del usuario."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.audio import SAMPLE_RATE


@dataclass
class Groove:
    drums: np.ndarray  # float32 [2, n]
    backing: np.ndarray  # float32 [2, n]
    onsets: dict[str, list[float]] = field(default_factory=dict)  # clase ADTOF → segundos
    beat_s: float = 0.5

    @property
    def mix(self) -> np.ndarray:
        return self.drums + self.backing


def _place(buf: np.ndarray, sound: np.ndarray, t: float, sr: int) -> None:
    start = int(round(t * sr))
    end = min(len(buf), start + len(sound))
    buf[start:end] += sound[: end - start]


def make_groove(bpm: float = 120, seconds: float = 5.0, sr: int = SAMPLE_RATE, seed: int = 7) -> Groove:
    """Rock básico: bombo en 1 y 3, caja en 2 y 4, hi-hat en corcheas, acorde de fondo."""
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    beat = 60.0 / bpm
    t_kick = np.arange(int(0.25 * sr)) / sr
    t_short = np.arange(int(0.12 * sr)) / sr

    kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-t_kick * 30)) * t_kick) * np.exp(-t_kick * 12)
    snare = (0.6 * rng.standard_normal(len(t_short)) + 0.5 * np.sin(2 * np.pi * 190 * t_short)) * np.exp(
        -t_short * 25
    )
    hat_noise = np.diff(rng.standard_normal(len(t_short) + 1))  # ruido con énfasis en agudos
    hihat = 0.25 * hat_noise * np.exp(-t_short * 60)

    drums = np.zeros(n, dtype=np.float64)
    onsets: dict[str, list[float]] = {"kick": [], "snare": [], "hihat": []}
    t, i = 0.1, 0
    while t + 0.3 < seconds:
        if i % 4 in (0, 2):
            _place(drums, 0.9 * kick, t, sr)
            onsets["kick"].append(t)
        if i % 4 in (1, 3):
            _place(drums, 0.7 * snare, t, sr)
            onsets["snare"].append(t)
        for sub in (0.0, 0.5):
            _place(drums, hihat, t + sub * beat, sr)
            onsets["hihat"].append(t + sub * beat)
        t += beat
        i += 1

    tt = np.arange(n) / sr
    chord = sum(np.sin(2 * np.pi * f * tt) for f in (220.0, 277.18, 329.63)) * 0.08
    stereo = lambda x: np.stack([x, x]).astype(np.float32)  # noqa: E731
    return Groove(drums=stereo(drums), backing=stereo(chord), onsets=onsets, beat_s=beat)
