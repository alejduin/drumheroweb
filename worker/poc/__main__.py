"""CLI del PoC de la Fase A.

docker compose run --rm poc health                      # carga los 3 modelos y muestra versiones
docker compose run --rm poc analyze poc/songs/x.mp3     # una canción → poc/out/<id>/
docker compose run --rm poc analyze poc/songs           # todas las de la carpeta
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from app.device import resolve_device
from app.pipeline.quantize import DEFAULT_TOLERANCE_S
from app.versions import model_versions

AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".opus"}
POC_DIR = Path(__file__).resolve().parent


def cmd_health(_args: argparse.Namespace) -> int:
    import torch

    device = resolve_device()
    print(f"torch {torch.__version__} · dispositivo: {device}", file=sys.stderr)

    # Cargar los modelos verifica que los pesos están (y los descarga la primera vez)
    from app.pipeline.separate import DrumSeparator
    from app.pipeline.tempo import BeatTracker
    from app.pipeline.transcribe import DrumTranscriber

    for name, factory in (
        ("demucs", DrumSeparator),
        ("adtof", DrumTranscriber),
        ("beat_this", BeatTracker),
    ):
        start = time.perf_counter()
        factory(device=device)
        print(f"  {name}: cargado en {time.perf_counter() - start:.1f} s", file=sys.stderr)

    # Mismo formato que GET /v1/health (shared/openapi.yaml)
    print(json.dumps({"status": "ok", "device": device, "models": model_versions()}, indent=2))
    return 0


def _audio_files(target: Path) -> list[Path]:
    # Se acepta "songs/x.mp3" (relativo a poc/) además de rutas normales
    if not target.exists() and (POC_DIR / target).exists():
        target = POC_DIR / target
    if target.is_dir():
        return sorted(p for p in target.iterdir() if p.suffix.lower() in AUDIO_EXTENSIONS)
    if target.is_file():
        return [target]
    raise SystemExit(f"no existe: {target}")


def cmd_analyze(args: argparse.Namespace) -> int:
    from app.pipeline.quantize import QuantizeOptions
    from app.pipeline.run import Models, PipelineError, analyze, notes_by_piece

    files = _audio_files(Path(args.target))
    if not files:
        raise SystemExit(f"no hay audio en {args.target}")
    options = QuantizeOptions(triplets=args.triplets, tolerance_s=args.tolerance_ms / 1000)
    device = resolve_device()

    start = time.perf_counter()
    models = Models.load(device)
    print(f"modelos cargados en {time.perf_counter() - start:.1f} s ({device})", file=sys.stderr)

    failures = 0
    for path in files:
        print(f"\n▶ {path.name}", file=sys.stderr)
        try:
            result = analyze(
                path,
                Path(args.out),
                models,
                options,
                on_stage=lambda s: print(f"  · {s}", file=sys.stderr),
            )
        except PipelineError as exc:
            failures += 1
            print(f"  ✗ {exc.code}: {exc}", file=sys.stderr)
            continue
        chart = result.chart
        n_notes = len(chart["difficulties"]["full"]["notes"])
        stages = "  ".join(f"{k} {v:.1f}s" for k, v in result.timings.items())
        print(f"  ✓ {result.out_dir}", file=sys.stderr)
        print(
            f"    {chart['durationS']:.0f} s · {chart['bpm']} BPM · {chart['timeSignature'][0]}/4 · "
            f"{len(chart['grid']['downbeats'])} compases · {n_notes} notas "
            f"({result.snapped_ratio:.0%} en rejilla)",
            file=sys.stderr,
        )
        print(f"    {notes_by_piece(chart)}", file=sys.stderr)
        print(f"    {stages}  · total {sum(result.timings.values()):.1f}s", file=sys.stderr)
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="poc", description="DrumHero AI — PoC de transcripción")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("health", help="carga los modelos y muestra versiones").set_defaults(func=cmd_health)

    analyze = sub.add_parser("analyze", help="MP3 (o carpeta) → chart v2 + stems + peaks")
    analyze.add_argument("target", help="archivo de audio o carpeta (p. ej. poc/songs)")
    analyze.add_argument("--out", default=str(POC_DIR / "out"), help="carpeta de salida (default: poc/out)")
    analyze.add_argument("--triplets", action="store_true", help="incluir tresillos de corchea en la rejilla")
    analyze.add_argument(
        "--tolerance-ms",
        type=float,
        default=DEFAULT_TOLERANCE_S * 1000,
        help="distancia máxima para ajustar a la rejilla",
    )
    analyze.set_defaults(func=cmd_analyze)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
