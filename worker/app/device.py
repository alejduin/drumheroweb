"""Selección de dispositivo de cómputo (cpu | cuda)."""

from __future__ import annotations

import os
from typing import Literal

Device = Literal["cpu", "cuda"]


def resolve_device(requested: str | None = None) -> Device:
    """Resuelve el dispositivo según DRUMHERO_DEVICE (cpu | cuda | auto).

    `auto` usa CUDA si está disponible. Pedir `cuda` sin GPU cae a CPU en vez
    de fallar: el PoC debe poder correr en cualquier máquina.
    """
    value = (requested or os.environ.get("DRUMHERO_DEVICE") or "auto").strip().lower()
    if value not in ("cpu", "cuda", "auto"):
        raise ValueError(f"DRUMHERO_DEVICE inválido: {value!r} (usa cpu, cuda o auto)")
    if value == "cpu":
        return "cpu"

    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"
