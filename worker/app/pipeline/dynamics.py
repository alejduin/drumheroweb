"""Velocity y dinámica de cada golpe (PLAN_V2 D17).

ADTOF no estima intensidad: se mide la energía RMS del stem de batería en una
ventana corta tras el onset. Antes se filtra por la banda de la pieza para que,
p. ej., un bombo simultáneo no infle la velocity del hi-hat. La escala es
relativa a cada pieza: la mediana en dB → BASE_VELOCITY.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfiltfilt

RMS_WINDOW_S = 0.03
RMS_PRE_S = 0.005  # margen antes del onset (el tiempo de ADTOF tiene ~10 ms de resolución)
BASE_VELOCITY = 90
VELOCITY_PER_DB = 3.0
GHOST_MAX_VELOCITY = 50  # < 50 = ghost (PLAN_V2 D3)
ACCENT_MIN_VELOCITY = 100  # > 100 = acento
SILENCE_DB = -120.0

# Banda (Hz) por pieza: (corte bajo, corte alto); None = sin corte de ese lado
PIECE_BANDS: dict[str, tuple[float | None, float | None]] = {
    "kick": (None, 150.0),
    "snare": (150.0, 6000.0),
    "snare_rim": (300.0, 8000.0),
    "tom1": (70.0, 1000.0),
    "tom2": (70.0, 1000.0),
    "tom3": (60.0, 800.0),
    "hihat_closed": (6000.0, None),
    "hihat_open": (6000.0, None),
    "hihat_pedal": (6000.0, None),
    "crash": (4000.0, None),
    "ride": (3000.0, None),
}


def band_filter(mono: np.ndarray, sample_rate: int, band: tuple[float | None, float | None]) -> np.ndarray:
    low, high = band
    nyquist = sample_rate / 2
    if low is not None and high is not None:
        sos = butter(4, [low / nyquist, high / nyquist], btype="bandpass", output="sos")
    elif low is not None:
        sos = butter(4, low / nyquist, btype="highpass", output="sos")
    elif high is not None:
        sos = butter(4, high / nyquist, btype="lowpass", output="sos")
    else:
        return mono
    return sosfiltfilt(sos, mono)


def onset_db(signal: np.ndarray, sample_rate: int, times: np.ndarray) -> np.ndarray:
    """RMS en dB de [t - RMS_PRE_S, t - RMS_PRE_S + RMS_WINDOW_S] para cada t."""
    out = np.full(len(times), SILENCE_DB)
    win = int(RMS_WINDOW_S * sample_rate)
    for i, t in enumerate(times):
        start = max(int(round((t - RMS_PRE_S) * sample_rate)), 0)
        chunk = signal[start : start + win]
        if len(chunk):
            rms = float(np.sqrt(np.mean(np.square(chunk, dtype=np.float64))))
            out[i] = 20 * np.log10(rms) if rms > 0 else SILENCE_DB
    return out


def db_to_velocity(db: np.ndarray) -> np.ndarray:
    """dB de una misma pieza → velocity 1–127 (mediana = BASE_VELOCITY)."""
    db = np.asarray(db, dtype=np.float64)
    if len(db) == 0:
        return np.zeros(0, dtype=int)
    ref = float(np.median(db))
    velocity = np.rint(BASE_VELOCITY + VELOCITY_PER_DB * (db - ref))
    return np.clip(velocity, 1, 127).astype(int)


def dynamic_for(velocity: int) -> str:
    if velocity < GHOST_MAX_VELOCITY:
        return "ghost"
    if velocity > ACCENT_MIN_VELOCITY:
        return "accent"
    return "normal"


def estimate_velocities(
    drums_mono: np.ndarray, sample_rate: int, times: np.ndarray, pieces: list[str]
) -> np.ndarray:
    """Velocity por golpe, normalizada dentro de cada pieza."""
    times = np.asarray(times, dtype=np.float64)
    velocities = np.full(len(times), BASE_VELOCITY, dtype=int)
    piece_arr = np.array(pieces, dtype=object)
    for piece in sorted(set(pieces)):
        idx = np.flatnonzero(piece_arr == piece)
        filtered = band_filter(drums_mono, sample_rate, PIECE_BANDS.get(piece, (None, None)))
        velocities[idx] = db_to_velocity(onset_db(filtered, sample_rate, times[idx]))
    return velocities
