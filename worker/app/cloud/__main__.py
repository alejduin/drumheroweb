"""Worker en modo nube (PLAN_V2 B12): `python -m app.cloud`.

Recoge los trabajos que la app deja en Supabase. Variables:
  SUPABASE_URL, SUPABASE_SECRET_KEY (clave secreta / service_role: nunca en el navegador),
  WORKER_ID (por defecto el hostname), DRUMHERO_DATA_DIR (carpeta temporal de trabajo).
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import sys
from pathlib import Path

from app.api.config import Settings
from app.api.runner import PipelineRunner
from app.cloud.consumer import CloudConsumer, CloudLoop
from app.cloud.supabase import SupabaseRest
from app.device import resolve_device
from app.versions import model_versions


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # Cada consulta a la cola (cada 5 s) llenaría el log
    logging.getLogger("httpx").setLevel(logging.WARNING)
    log = logging.getLogger("drumhero.cloud")
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not url or not key:
        log.error("faltan SUPABASE_URL y SUPABASE_SECRET_KEY (ver worker/.env.example)")
        return 2
    worker_id = os.environ.get("WORKER_ID", "").strip() or socket.gethostname()
    settings = Settings(
        data_dir=Path(os.environ.get("DRUMHERO_DATA_DIR", "/data")), storage_backend="supabase"
    )

    device = resolve_device()
    runner = PipelineRunner(device)
    log.info("cargando modelos en %s…", device)
    runner.preload()

    db = SupabaseRest(url, key)
    loop = CloudLoop(CloudConsumer(db, runner, settings, worker_id), device, model_versions())
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: loop.stop())
    log.info("worker %s esperando trabajos de %s", worker_id, url)
    try:
        loop.run()
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
