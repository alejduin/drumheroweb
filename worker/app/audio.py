"""Decodificación y codificación de audio con ffmpeg.

Todo el pipeline trabaja con arrays float32 de forma [canales, muestras] a
SAMPLE_RATE. Decodificamos siempre con ffmpeg (y no con librosa/torchaudio)
para controlar el tratamiento del encoder delay del MP3: ffmpeg lo recorta
usando la cabecera LAME/iTunes, igual que decodeAudioData en Chrome. Así los
stems quedan alineados con el original (PLAN_V2 D14).
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SAMPLE_RATE = 44100
CHANNELS = 2


class AudioDecodeError(RuntimeError):
    """El archivo no se pudo decodificar (formato no soportado o corrupto)."""


@dataclass(frozen=True)
class AudioInfo:
    duration_s: float
    tags: dict[str, str]  # etiquetas del contenedor (ID3, Vorbis…), claves en minúscula
    formats: frozenset[str] = frozenset()  # format_name de ffprobe ("mov,mp4,m4a" → 3 nombres)


def probe(path: str | Path) -> AudioInfo:
    """Duración y etiquetas según el contenedor (sin decodificar)."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,format_name:format_tags",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise AudioDecodeError(result.stderr.decode(errors="replace").strip())
    try:
        fmt = json.loads(result.stdout)["format"]
        duration = float(fmt["duration"])
    except (KeyError, ValueError) as exc:
        raise AudioDecodeError(f"duración no disponible: {path}") from exc
    tags = {str(k).lower(): str(v).strip() for k, v in fmt.get("tags", {}).items()}
    formats = frozenset(name for name in str(fmt.get("format_name", "")).split(",") if name)
    return AudioInfo(duration_s=duration, tags=tags, formats=formats)


def probe_duration_s(path: str | Path) -> float:
    """Duración en segundos según el contenedor (sin decodificar)."""
    return probe(path).duration_s


def decode(path: str | Path, sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS) -> np.ndarray:
    """Decodifica cualquier formato soportado por ffmpeg a float32 [canales, muestras]."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-i",
            str(path),
            "-f",
            "f32le",
            "-ac",
            str(channels),
            "-ar",
            str(sample_rate),
            "-",
        ],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0 or len(result.stdout) == 0:
        raise AudioDecodeError(result.stderr.decode(errors="replace").strip() or "sin audio")
    samples = np.frombuffer(result.stdout, dtype="<f4")
    return samples.reshape(-1, channels).T.copy()


def encode_opus(
    audio: np.ndarray, out_path: str | Path, sample_rate: int = SAMPLE_RATE, bitrate: str = "160k"
) -> Path:
    """Codifica float32 [canales, muestras] a Opus/OGG (stems para el navegador)."""
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    interleaved = np.ascontiguousarray(np.clip(audio, -1.0, 1.0).T, dtype="<f4")
    result = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "f32le",
            "-ar",
            str(sample_rate),
            "-ac",
            str(audio.shape[0]),
            "-i",
            "-",
            "-c:a",
            "libopus",
            "-b:a",
            bitrate,
            str(out),
        ],
        input=interleaved.tobytes(),
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode(errors="replace").strip())
    return out


def to_mono(audio: np.ndarray) -> np.ndarray:
    """[canales, muestras] → [muestras]."""
    return audio.mean(axis=0) if audio.ndim == 2 else audio
