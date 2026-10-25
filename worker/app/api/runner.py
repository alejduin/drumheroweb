"""Quién ejecuta el análisis: el pipeline real (modelos) o uno falso en los tests."""

from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from app.device import resolve_device
from app.pipeline.run import AnalysisResult, Models, analyze


class Runner(Protocol):
    def run(self, audio_path: Path, out_root: Path, on_stage: Callable[[str], None]) -> AnalysisResult:
        """Escribe chart.json, drums.ogg, backing.ogg y peaks.json en result.out_dir."""
        ...


class PipelineRunner:
    """Carga los modelos una sola vez (con el primer trabajo o con `preload`)."""

    def __init__(self, device: str | None = None) -> None:
        self._device = device
        self._models: Models | None = None
        self._lock = threading.Lock()

    def preload(self) -> None:
        with self._lock:
            if self._models is None:
                self._models = Models.load(resolve_device(self._device))

    def run(self, audio_path: Path, out_root: Path, on_stage: Callable[[str], None]) -> AnalysisResult:
        self.preload()
        assert self._models is not None
        return analyze(audio_path, out_root, self._models, on_stage=on_stage)
