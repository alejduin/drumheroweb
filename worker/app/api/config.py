"""Configuración del servicio por variables de entorno."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from app.pipeline.run import MAX_AUDIO_DURATION_S

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
# Extensiones aceptadas → formatos de ffprobe que las respaldan (el contenido manda, no el nombre)
ALLOWED_FORMATS: dict[str, frozenset[str]] = {
    ".mp3": frozenset({"mp3"}),
    ".wav": frozenset({"wav"}),
    ".m4a": frozenset({"mov", "mp4", "m4a", "3gp", "3g2", "mj2"}),
}
DEFAULT_ORIGINS = ("http://localhost:5173",)


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    storage_backend: str = "local"
    max_upload_bytes: int = MAX_UPLOAD_BYTES
    max_duration_s: float = MAX_AUDIO_DURATION_S
    cors_origins: tuple[str, ...] = DEFAULT_ORIGINS
    # Carga los modelos al arrancar en vez de con el primer trabajo
    preload_models: bool = False

    @classmethod
    def from_env(cls) -> Settings:
        backend = os.environ.get("STORAGE_BACKEND", "local").strip().lower()
        if backend != "local":
            # STORAGE_BACKEND=supabase llega con B12
            raise ValueError(f"STORAGE_BACKEND no soportado todavía: {backend!r}")
        origins = os.environ.get("CORS_ORIGINS", "")
        return cls(
            data_dir=Path(os.environ.get("DRUMHERO_DATA_DIR", "/data")),
            storage_backend=backend,
            cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()) or DEFAULT_ORIGINS,
            preload_models=os.environ.get("PRELOAD_MODELS", "0") == "1",
        )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jobs.sqlite3"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def work_dir(self) -> Path:
        return self.data_dir / "work"

    @property
    def files_dir(self) -> Path:
        """Stems y peaks por sha256; lo sirve GET /v1/files/{path}."""
        return self.data_dir / "files"
