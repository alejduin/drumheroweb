"""Pipeline completo: MP3 → chart v2 (full) + stems Opus + peaks.

Las etapas coinciden con AnalysisStageId de shared/openapi.yaml; `timings`
guarda los segundos de cada una (criterio de aceptación de A3).
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.audio import SAMPLE_RATE, AudioDecodeError, decode, encode_opus, probe, to_mono
from app.pipeline.chart import SongMeta, build_chart, clean_grid, song_id_from_name, validate_chart
from app.pipeline.dynamics import estimate_velocities
from app.pipeline.peaks import compute_peaks
from app.pipeline.quantize import QuantizeOptions, build_grid, quantize
from app.pipeline.transcribe import pick_onsets
from app.versions import model_tag

# Mismo valor que MAX_AUDIO_DURATION_S en src/constants/chart.ts
MAX_AUDIO_DURATION_S = 600

StageFn = Callable[[str], None]


class PipelineError(RuntimeError):
    """Fallo con un código de JobErrorCode (shared/openapi.yaml)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class Models:
    separator: object
    transcriber: object
    beat_tracker: object

    @classmethod
    def load(cls, device: str) -> Models:
        from app.pipeline.separate import DrumSeparator
        from app.pipeline.tempo import BeatTracker
        from app.pipeline.transcribe import DrumTranscriber

        return cls(DrumSeparator(device=device), DrumTranscriber(device=device), BeatTracker(device=device))


@dataclass
class AnalysisResult:
    chart: dict
    out_dir: Path
    timings: dict[str, float] = field(default_factory=dict)
    snapped_ratio: float = 0.0


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def analyze(
    audio_path: Path,
    out_root: Path,
    models: Models,
    options: QuantizeOptions | None = None,
    on_stage: StageFn | None = None,
) -> AnalysisResult:
    """Analiza un archivo y escribe en out_root/<id>/ chart.json, drums.ogg, backing.ogg y peaks.json."""
    options = options or QuantizeOptions()
    timings: dict[str, float] = {}

    @contextmanager
    def stage(name: str) -> Iterator[None]:
        if on_stage:
            on_stage(name)
        start = time.perf_counter()
        yield
        timings[name] = round(time.perf_counter() - start, 2)

    with stage("decode"):
        try:
            info = probe(audio_path)
            if info.duration_s > MAX_AUDIO_DURATION_S:
                raise PipelineError("TOO_LONG", f"{info.duration_s:.0f} s > {MAX_AUDIO_DURATION_S} s")
            mix = decode(audio_path)
        except AudioDecodeError as exc:
            raise PipelineError("DECODE_FAILED", str(exc)) from exc
        duration_s = mix.shape[1] / SAMPLE_RATE
        sha = sha256_file(audio_path)

    with stage("separate"):
        try:
            stems = models.separator.separate(mix)
        except Exception as exc:
            raise PipelineError("SEPARATION_FAILED", str(exc)) from exc
        drums_mono = to_mono(stems.drums)

    with stage("transcribe"):
        try:
            onsets = pick_onsets(models.transcriber.activations(drums_mono))
        except Exception as exc:
            raise PipelineError("TRANSCRIPTION_FAILED", str(exc)) from exc
        if not onsets:
            raise PipelineError("NO_DRUMS_DETECTED", "no se detectaron golpes de batería")

    with stage("tempo"):
        beat_grid = models.beat_tracker.track(to_mono(mix), SAMPLE_RATE)
        if len(beat_grid.beats) < 2:
            raise PipelineError("TRANSCRIPTION_FAILED", "no se detectó el pulso de la canción")
        grid = clean_grid(beat_grid.beats, beat_grid.downbeats, duration_s)

    with stage("quantize"):
        points = build_grid(np.array(grid.beats), duration_s, options)
        notes = quantize(onsets, points, options.tolerance_s)
        velocities = estimate_velocities(
            drums_mono, SAMPLE_RATE, np.array([n.t_raw for n in notes]), [n.piece for n in notes]
        )

    with stage("finalize"):
        song_id = song_id_from_name(audio_path.name, fallback=sha[:16])
        out_dir = out_root / song_id
        out_dir.mkdir(parents=True, exist_ok=True)
        encode_opus(stems.drums, out_dir / "drums.ogg")
        encode_opus(stems.backing, out_dir / "backing.ogg")
        (out_dir / "peaks.json").write_text(json.dumps(compute_peaks(mix, SAMPLE_RATE)))

        meta = SongMeta(
            id=song_id,
            title=info.tags.get("title") or Path(audio_path).stem,
            artist=info.tags.get("artist", ""),
            duration_s=duration_s,
            audio_url=f"storage://songs/{audio_path.name}",
            stems={
                "drums": f"storage://poc/{song_id}/drums.ogg",
                "backing": f"storage://poc/{song_id}/backing.ogg",
            },
            audio_sha256=sha,
        )
        chart = build_chart(meta, grid, notes, velocities.tolist(), model=model_tag())
        problems = validate_chart(chart)
        if problems:
            raise PipelineError("INTERNAL", "chart inválido: " + "; ".join(problems[:5]))
        (out_dir / "chart.json").write_text(json.dumps(chart, ensure_ascii=False, indent=1))

    snapped = sum(n.snapped for n in notes) / len(notes) if notes else 0.0
    result = AnalysisResult(chart=chart, out_dir=out_dir, timings=timings, snapped_ratio=round(snapped, 3))
    (out_dir / "run.json").write_text(
        json.dumps(
            {
                "source": audio_path.name,
                "durationS": round(duration_s, 2),
                "timings": timings,
                "totalS": round(sum(timings.values()), 2),
                "options": {
                    "subdivisions": options.subdivisions,
                    "triplets": options.triplets,
                    "toleranceS": options.tolerance_s,
                },
                "snappedRatio": result.snapped_ratio,
                "notesByPiece": notes_by_piece(chart),
            },
            indent=2,
        )
    )
    return result


def notes_by_piece(chart: dict) -> dict[str, int]:
    counts: dict[str, int] = {}
    for note in chart["difficulties"]["full"]["notes"]:
        counts[note["piece"]] = counts.get(note["piece"], 0) + 1
    return dict(sorted(counts.items()))
