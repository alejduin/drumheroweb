"""Consumidor de la tabla `jobs`: un trabajo a la vez (los modelos ocupan toda la CPU/GPU)."""

from __future__ import annotations

import logging
import shutil
import threading
from pathlib import Path

from app.api.config import Settings
from app.api.runner import Runner
from app.api.stages import PIPELINE_STAGES, chart_summary
from app.api.store import JobStore
from app.pipeline.run import PipelineError

log = logging.getLogger("drumhero.worker")

# Lo que se publica por /v1/files (chart.json va en analysis_cache)
PUBLISHED_FILES = ("drums.ogg", "backing.ogg", "peaks.json")


class CanceledError(Exception):
    """El usuario canceló durante el análisis; se corta en el siguiente cambio de etapa."""


class JobQueue:
    def __init__(self, store: JobStore, settings: Settings, runner: Runner) -> None:
        self._store = store
        self._settings = settings
        self._runner = runner
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ─── hilo consumidor ─────────────────────────────────────────────────────

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, name="job-consumer", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout)
            self._thread = None

    def notify(self) -> None:
        """Hay un trabajo nuevo en cola."""
        self._wake.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                worked = self.process_next()
            except Exception:  # un fallo del store no debe matar el consumidor
                log.exception("error en el consumidor")
                worked = False
            if not worked:
                # Espera a notify(); el timeout cubre trabajos insertados por otro proceso
                self._wake.wait(timeout=5.0)
                self._wake.clear()

    # ─── un trabajo ──────────────────────────────────────────────────────────

    def process_next(self) -> bool:
        """Procesa el trabajo en cola más antiguo. False si no había ninguno."""
        job = self._store.claim_next()
        if job is None:
            return False
        job_id = job["id"]
        current = {"stage": "separate"}

        def on_stage(name: str) -> None:
            latest = self._store.get_job(job_id)
            if latest is None or latest["cancel_requested"]:
                raise CanceledError()
            status, stage = PIPELINE_STAGES.get(name, (latest["status"], current["stage"]))
            current["stage"] = stage
            if status != latest["status"]:
                self._store.update(job_id, status=status)

        work_root = self._settings.work_dir / job_id
        try:
            result = self._runner.run(Path(job["upload_path"]), work_root, on_stage)
            latest = self._store.get_job(job_id)
            if latest is None or latest["cancel_requested"]:
                raise CanceledError()
            self._publish(job["sha256"], result.out_dir, result.chart)
            self._store.update(job_id, status="done", summary=chart_summary(result.chart))
            log.info("trabajo %s listo", job_id)
        except CanceledError:
            self._store.update(job_id, status="canceled", failed_stage=current["stage"])
            log.info("trabajo %s cancelado", job_id)
        except PipelineError as exc:
            self._fail(job_id, current["stage"], exc.code, str(exc))
        except Exception as exc:
            log.exception("trabajo %s falló", job_id)
            self._fail(job_id, current["stage"], "INTERNAL", str(exc) or exc.__class__.__name__)
        finally:
            shutil.rmtree(work_root, ignore_errors=True)
            # El audio del usuario es privado: no se guarda después del análisis
            upload_dir = Path(job["upload_path"]).parent
            if upload_dir.parent == self._settings.uploads_dir:
                shutil.rmtree(upload_dir, ignore_errors=True)
        return True

    def _fail(self, job_id: str, stage: str, code: str, message: str) -> None:
        self._store.update(
            job_id, status="failed", failed_stage=stage, error={"code": code, "message": message}
        )
        log.warning("trabajo %s falló: %s %s", job_id, code, message)

    def _publish(self, sha256: str, out_dir: Path, chart: dict) -> None:
        """Copia stems y peaks a files/<sha256>/ y guarda el chart en analysis_cache."""
        target = self._settings.files_dir / sha256
        target.mkdir(parents=True, exist_ok=True)
        for name in PUBLISHED_FILES:
            shutil.move(str(out_dir / name), target / name)
        self._store.cache_put(sha256, chart, sha256)
