"""Etapa 2 — detectar golpes por clase con ADTOF (Frame_RNN, port PyTorch).

ADTOF da 5 clases. El mapeo a las piezas del chart v2 se hace en A3; aquí
solo se exponen las activaciones por frame (0-1) a ADTOF_FPS.
"""

from __future__ import annotations

from importlib.resources import files

import numpy as np

ADTOF_FPS = 100
ADTOF_COMMIT = "85c192e78f716ea0b111cc8a5ee4a8f6a3a4f8a9"

# Orden de salida del modelo (pitches General MIDI que usa ADTOF)
ADTOF_CLASSES = ("kick", "snare", "tom", "hihat", "cymbal")
ADTOF_LABELS = (35, 38, 47, 42, 49)
# Umbrales por clase publicados por ADTOF para Frame_RNN
ADTOF_THRESHOLDS = (0.22, 0.24, 0.32, 0.22, 0.30)


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
