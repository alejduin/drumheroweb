"""Etapa 2 — detectar golpes por clase con ADTOF (Frame_RNN, port PyTorch).

ADTOF da activaciones por frame (0-1) para 5 clases a ADTOF_FPS; `pick_onsets`
las convierte en golpes con tiempo y confianza, ya mapeados a piezas del chart v2.
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib.resources import files

import numpy as np

ADTOF_FPS = 100
ADTOF_COMMIT = "85c192e78f716ea0b111cc8a5ee4a8f6a3a4f8a9"

# Orden de salida del modelo (pitches General MIDI que usa ADTOF)
ADTOF_CLASSES = ("kick", "snare", "tom", "hihat", "cymbal")
ADTOF_LABELS = (35, 38, 47, 42, 49)
# Umbrales por clase publicados por ADTOF para Frame_RNN
ADTOF_THRESHOLDS = (0.22, 0.24, 0.32, 0.22, 0.30)

# ADTOF no distingue hi-hat abierto/cerrado, toms ni crash/ride: cada clase va a la
# pieza más común; el resto se corrige en el editor (Fase C).
ADTOF_TO_PIECE = {
    "kick": "kick",
    "snare": "snare",
    "tom": "tom1",
    "hihat": "hihat_closed",
    "cymbal": "crash",
}

# Dos picos de la misma clase más cercanos que esto son un solo golpe
MIN_ONSET_GAP_S = 0.03


@dataclass(frozen=True)
class Onset:
    t: float  # segundos, con resolución sub-frame
    piece: str
    confidence: float  # pico de activación (PLAN_V2 D17)


def pick_onsets(
    act: np.ndarray,
    fps: float = ADTOF_FPS,
    thresholds: tuple[float, ...] = ADTOF_THRESHOLDS,
    min_gap_s: float = MIN_ONSET_GAP_S,
) -> list[Onset]:
    """Picos locales por clase sobre el umbral → golpes ordenados por tiempo."""
    onsets: list[Onset] = []
    padded = np.pad(act, ((1, 1), (0, 0)), constant_values=0.0)
    for cls, (name, threshold) in enumerate(zip(ADTOF_CLASSES, thresholds, strict=True)):
        a = padded[:, cls]
        center = a[1:-1]
        # >= a la derecha y > a la izquierda: una meseta da un solo pico
        is_peak = (center >= threshold) & (center > a[:-2]) & (center >= a[2:])
        frames = np.flatnonzero(is_peak)
        kept: list[tuple[float, float]] = []
        for f in frames:
            prev, peak, nxt = a[f], a[f + 1], a[f + 2]
            t = (f + _parabolic_offset(prev, peak, nxt)) / fps
            if kept and t - kept[-1][0] < min_gap_s:
                if peak > kept[-1][1]:
                    kept[-1] = (t, float(peak))
                continue
            kept.append((t, float(peak)))
        piece = ADTOF_TO_PIECE[name]
        onsets.extend(Onset(t=max(t, 0.0), piece=piece, confidence=min(c, 1.0)) for t, c in kept)
    onsets.sort(key=lambda o: (o.t, o.piece))
    return onsets


def _parabolic_offset(prev: float, peak: float, nxt: float) -> float:
    """Desplazamiento (-0.5..0.5 frames) del máximo de la parábola por 3 puntos."""
    denom = prev - 2 * peak + nxt
    if denom >= 0:  # no es un máximo estricto (meseta)
        return 0.0
    return float(np.clip(0.5 * (prev - nxt) / denom, -0.5, 0.5))


class DrumTranscriber:
    """Carga el modelo una vez y calcula activaciones sobre audio mono 44.1 kHz."""

    def __init__(self, device: str = "cpu") -> None:
        import torch
        from adtof_pytorch import calculate_n_bins, create_frame_rnn_model
        from adtof_pytorch.audio import create_adtof_processor

        self.device = device
        self.processor = create_adtof_processor(fps=ADTOF_FPS)
        self.model = create_frame_rnn_model(calculate_n_bins())
        weights_path = files("adtof_pytorch") / "data" / "adtof_frame_rnn_pytorch_weights.pth"
        checkpoint = torch.load(str(weights_path), map_location="cpu", weights_only=False)
        state = checkpoint.get("model_weights", checkpoint)
        # El loader del port usa strict=False y fallaría en silencio: exigimos que
        # todas las capas del modelo reciban pesos.
        missing, _unexpected = self.model.load_state_dict(_with_gru_aliases(self.model, state), strict=False)
        if missing:
            raise RuntimeError(f"ADTOF: faltan pesos para {missing}")
        self.model.eval().to(device)

    def activations(self, mono: np.ndarray) -> np.ndarray:
        """mono: float32 [muestras] a 44.1 kHz → activaciones float32 [frames, 5]."""
        import torch

        stft = self.processor.compute_stft(np.ascontiguousarray(mono, dtype=np.float32))
        spec = self.processor.apply_filterbank(stft).T[:, :, np.newaxis]  # [T, bins, 1]
        x = torch.from_numpy(spec).float().unsqueeze(0).to(self.device)
        with torch.no_grad():
            pred = self.model(x)[0].cpu().numpy()
        return pred.astype(np.float32, copy=False)


def _with_gru_aliases(model, state: dict) -> dict:
    """Replica el renombrado de claves GRU del loader original (fw/bw ↔ l0/l0_reverse)."""
    state = dict(state)
    for i, layer in enumerate(getattr(model, "gru_layers", [])):
        if not (hasattr(layer, "fw") and hasattr(layer, "bw")):
            continue
        prefix = f"gru_layers.{i}"
        for direction, suffix in (("fw", "l0"), ("bw", "l0_reverse")):
            for param in ("weight_ih", "weight_hh", "bias_ih", "bias_hh"):
                target = f"{prefix}.{direction}.{param}"
                source = f"{prefix}.{param}_{suffix}"
                if source in state and target not in state:
                    state[target] = state[source]
    return state
