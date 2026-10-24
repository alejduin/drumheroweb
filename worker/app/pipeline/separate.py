"""Etapa 1 — aislar la batería con Demucs v4 (htdemucs)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from app.audio import CHANNELS, SAMPLE_RATE

DEMUCS_MODEL = "htdemucs"

ProgressFn = Callable[[float], None]


@dataclass(frozen=True)
class Stems:
    drums: np.ndarray  # float32 [2, muestras]
    backing: np.ndarray  # float32 [2, muestras] — mezcla menos batería (drums + backing == mezcla)


class DrumSeparator:
    """Carga htdemucs una vez y separa batería / resto.

    Equivale a `demucs --two-stems drums`, pero con arrays en memoria para
    no reescribir WAV intermedios ni depender de torchaudio para E/S.
    """

    def __init__(self, device: str = "cpu", model_name: str = DEMUCS_MODEL) -> None:
        from demucs.pretrained import get_model

        self.device = device
        self.model_name = model_name
        self.model = get_model(model_name)
        self.model.eval()
        if self.model.samplerate != SAMPLE_RATE or self.model.audio_channels != CHANNELS:
            raise RuntimeError(f"{model_name}: se esperaba {SAMPLE_RATE} Hz estéreo")
        if "drums" not in self.model.sources:
            raise RuntimeError(f"{model_name} no tiene stem de batería: {self.model.sources}")

    def separate(self, audio: np.ndarray, progress: ProgressFn | None = None) -> Stems:
        """audio: float32 [2, muestras] a 44.1 kHz → Stems de la misma longitud."""
        import torch
        from demucs.apply import apply_model

        wav = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))
        # Normalización igual a demucs.separate (mejora la separación en mezclas fuertes o suaves)
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        wav = (wav - mean) / std

        if progress:
            progress(0.0)
        with torch.no_grad():
            sources = apply_model(
                self.model,
                wav[None],
                device=self.device,
                split=True,
                overlap=0.25,
                progress=False,
            )[0]
        sources = sources * std + mean
        if progress:
            progress(1.0)

        drums = sources[self.model.sources.index("drums")].cpu().numpy().astype(np.float32, copy=False)
        # Residuo en vez de sumar los otros stems: Demucs no garantiza que sus fuentes
        # sumen la mezcla, y así sonar ambos stems a la vez equivale al original.
        backing = np.ascontiguousarray(audio, dtype=np.float32) - drums
        return Stems(drums=drums, backing=backing)
