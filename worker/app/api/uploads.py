"""Recepción y validación del audio subido (PLAN_V2 §3: MP3/WAV/M4A, ≤ 50 MB, ≤ 10 min)."""

from __future__ import annotations

import hashlib
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.api.config import ALLOWED_FORMATS, Settings
from app.api.errors import ApiError
from app.audio import AudioDecodeError, probe

CHUNK_BYTES = 1 << 20


@dataclass(frozen=True)
class SavedUpload:
    path: Path
    sha256: str
    title_tag: str
    artist_tag: str


def safe_file_name(name: str) -> str:
    """Nombre sin rutas ni caracteres raros (sirve de título si el MP3 no tiene etiquetas)."""
    base = Path(name.replace("\\", "/")).name
    base = re.sub(r"[^\w\s.,()&'+-]", "_", base, flags=re.UNICODE).strip(" .")
    return base[:150] or "audio"


def check_extension(file_name: str) -> str:
    ext = Path(file_name).suffix.lower()
    if ext not in ALLOWED_FORMATS:
        raise ApiError(
            422, "UNSUPPORTED_FORMAT", f"formato no soportado ({ext or 'sin extensión'}): usa MP3, WAV o M4A"
        )
    return ext


def save_upload(source: BinaryIO, file_name: str, dest_dir: Path, settings: Settings) -> SavedUpload:
    """Copia por bloques (cortando al pasar el límite), calcula el sha256 y valida el contenido."""
    ext = check_extension(file_name)
    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / safe_file_name(file_name)
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("wb") as out:
            while chunk := source.read(CHUNK_BYTES):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise ApiError(
                        413, "TOO_LARGE", f"el archivo supera {settings.max_upload_bytes // (1 << 20)} MB"
                    )
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise ApiError(422, "DECODE_FAILED", "el archivo está vacío")

        try:
            info = probe(path)
        except AudioDecodeError as exc:
            raise ApiError(422, "DECODE_FAILED", "no se pudo leer el audio") from exc
        if not info.formats & ALLOWED_FORMATS[ext]:
            raise ApiError(422, "UNSUPPORTED_FORMAT", f"el contenido no es {ext[1:].upper()}")
        if info.duration_s > settings.max_duration_s:
            raise ApiError(
                422,
                "TOO_LONG",
                f"dura {info.duration_s / 60:.1f} min; el máximo es {settings.max_duration_s / 60:.0f} min",
            )
    except BaseException:
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise
    return SavedUpload(
        path=path,
        sha256=digest.hexdigest(),
        title_tag=info.tags.get("title", ""),
        artist_tag=info.tags.get("artist", ""),
    )
