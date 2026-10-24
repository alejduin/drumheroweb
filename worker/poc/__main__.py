"""CLI del PoC de la Fase A.

docker compose run --rm poc health      # carga los 3 modelos y muestra versiones
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from app.device import resolve_device
from app.versions import model_versions


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="poc", description="DrumHero AI — PoC de transcripción")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("health", help="carga los modelos y muestra versiones").set_defaults(func=cmd_health)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
