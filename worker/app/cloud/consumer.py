"""Consumidor de la cola en Supabase: reclama un trabajo, analiza y publica el resultado.

Flujo por trabajo (PLAN_V2 B12):
  claim_next_job → descarga audio/{user}/{song}/… → valida (formato, tamaño, duración)
  → caché por sha256 (copia los stems) o pipeline → stems a stems/{user}/{song}/
  → charts (chart + peaks) → songs.status/summary → jobs.status = done.
El audio del usuario se queda en su bucket privado (es su biblioteca); el trabajo local se borra.
"""

from __future__ import annotations

import json
import logging
import shutil
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.api.config import Settings
from app.api.errors import ApiError
from app.api.runner import Runner
from app.api.stages import PIPELINE_STAGES, build_stages, chart_summary, song_status
from app.api.uploads import save_upload
from app.cloud.supabase import SupabaseError, SupabaseRest, TooLargeError
from app.pipeline.run import PipelineError

log = logging.getLogger("drumhero.cloud")

AUDIO_BUCKET = "audio"
STEMS_BUCKET = "stems"
ACTIVE_STATUSES = ("separating", "transcribing", "tempo", "quantizing", "finalizing")


class CanceledError(Exception):
    """El usuario canceló (o borró la canción) durante el análisis."""


@dataclass(frozen=True)
class Published:
    chart: dict
    peaks: dict
    drums_path: str
    backing_path: str
    cached: bool


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CloudConsumer:
    def __init__(self, db: SupabaseRest, runner: Runner, settings: Settings, worker_id: str) -> None:
        self._db = db
        self._runner = runner
        self._settings = settings
        self._worker_id = worker_id

    # ─── arranque y latido ───────────────────────────────────────────────────

    def requeue_interrupted(self) -> int:
        """Trabajos que este worker dejó a medias (se apagó la PC): vuelven a la cola."""
        rows = self._db.update(
            "jobs",
            {"status": "queued", "stages": build_stages("queued"), "worker_id": None},
            worker_id=f"eq.{self._worker_id}",
            status=f"in.({','.join(ACTIVE_STATUSES)})",
        )
        return len(rows)

    def heartbeat(self, device: str, models: dict) -> None:
        self._db.upsert(
            "workers",
            {"id": self._worker_id, "device": device, "models": models, "last_seen": utc_now()},
            on_conflict="id",
        )

    # ─── un trabajo ──────────────────────────────────────────────────────────

    def process_next(self) -> bool:
        """Procesa el trabajo en cola más antiguo. False si no había ninguno."""
        claimed = self._db.rpc("claim_next_job", {"p_worker": self._worker_id})
        if not claimed:
            return False
        job = claimed[0]
        job_id = job["id"]
        current = {"stage": "separate"}
        work_root = self._settings.work_dir / job_id
        self._update_job(job_id, status="separating", stages=build_stages("separating"))
        try:
            song = self._db.select_one("songs", id=f"eq.{job['song_id']}")
            if song is None:
                raise CanceledError()
            if song["status"] != "analyzing":
                # Reintento: la canción vuelve a "Analizando" mientras dure el trabajo
                self._db.update("songs", {"status": "analyzing", "error": None}, id=f"eq.{song['id']}")
            audio = self._download_audio(song, work_root)
            published = self._from_cache(song, audio.sha256) or self._analyze(
                job_id, song, audio.path, audio.sha256, work_root, current
            )
            self._finish(job_id, song, published, audio.sha256)
            log.info("trabajo %s listo%s", job_id, " (caché)" if published.cached else "")
        except CanceledError:
            self._update_job(job_id, status="canceled", stages=build_stages("canceled", current["stage"]))
            log.info("trabajo %s cancelado", job_id)
        except ApiError as exc:
            self._fail(job, current["stage"], exc.code, exc.message)
        except PipelineError as exc:
            self._fail(job, current["stage"], exc.code, str(exc))
        except Exception as exc:
            log.exception("trabajo %s falló", job_id)
            self._fail(job, current["stage"], "INTERNAL", str(exc) or exc.__class__.__name__)
        finally:
            shutil.rmtree(work_root, ignore_errors=True)
        return True

    def _download_audio(self, song: dict, work_root: Path):
        """Baja el MP3 del usuario y lo valida igual que una subida local."""
        work_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=work_root) as raw:
            try:
                self._db.download(AUDIO_BUCKET, song["audio_path"], raw, self._settings.max_upload_bytes)
            except TooLargeError as exc:
                limit = self._settings.max_upload_bytes // (1 << 20)
                raise ApiError(413, "TOO_LARGE", f"el archivo supera {limit} MB") from exc
            except SupabaseError as exc:
                if exc.status in (400, 404):
                    raise ApiError(404, "NOT_FOUND", "no se encontró el audio de la canción") from exc
                raise
            raw.seek(0)
            return save_upload(raw, song["file_name"], work_root / "upload", self._settings)

    def _check_cancel(self, job_id: str) -> None:
        latest = self._db.select_one("jobs", id=f"eq.{job_id}", select="cancel_requested")
        if latest is None or latest["cancel_requested"]:
            raise CanceledError()

    def _analyze(
        self, job_id: str, song: dict, audio_path: Path, sha256: str, work_root: Path, current: dict
    ) -> Published:
        def on_stage(name: str) -> None:
            self._check_cancel(job_id)
            status, stage = PIPELINE_STAGES.get(name, ("separating", current["stage"]))
            if stage != current["stage"] or name == "decode":
                current["stage"] = stage
                self._update_job(job_id, status=status, stages=build_stages(status))

        result = self._runner.run(audio_path, work_root / "out", on_stage)
        self._check_cancel(job_id)
        drums, backing = self._stem_paths(song)
        for name, path in (("drums.ogg", drums), ("backing.ogg", backing)):
            self._db.upload(STEMS_BUCKET, path, (result.out_dir / name).read_bytes(), "audio/ogg")
        peaks = json.loads((result.out_dir / "peaks.json").read_text())
        self._db.upsert(
            "analysis_cache",
            {
                "audio_sha256": sha256,
                "chart": result.chart,
                "peaks": peaks,
                "drums_path": drums,
                "backing_path": backing,
            },
            on_conflict="audio_sha256",
        )
        return Published(result.chart, peaks, drums, backing, cached=False)

    def _from_cache(self, song: dict, sha256: str) -> Published | None:
        """Mismo audio ya analizado: copia sus stems a la carpeta de esta canción."""
        hit = self._db.select_one("analysis_cache", audio_sha256=f"eq.{sha256}")
        if hit is None:
            return None
        drums, backing = self._stem_paths(song)
        try:
            for source, dest in ((hit["drums_path"], drums), (hit["backing_path"], backing)):
                if source != dest:
                    self._db.copy(STEMS_BUCKET, source, dest)
        except SupabaseError as exc:
            # La canción de origen se borró: se vuelve a analizar
            log.info("caché sin stems (%s): se analiza de nuevo", exc.status)
            self._db.delete("analysis_cache", audio_sha256=f"eq.{sha256}")
            return None
        return Published(hit["chart"], hit["peaks"], drums, backing, cached=True)

    @staticmethod
    def _stem_paths(song: dict) -> tuple[str, str]:
        folder = f"{song['user_id']}/{song['id']}"
        return f"{folder}/drums.ogg", f"{folder}/backing.ogg"

    def _finish(self, job_id: str, song: dict, published: Published, sha256: str) -> None:
        chart = {
            **published.chart,
            "title": song["title"],
            "artist": song["artist"],
            "audioUrl": f"storage://{AUDIO_BUCKET}/{song['audio_path']}",
            "audioSha256": sha256,
            "stems": {
                "drums": f"storage://{STEMS_BUCKET}/{published.drums_path}",
                "backing": f"storage://{STEMS_BUCKET}/{published.backing_path}",
            },
            "youtubeUrl": song.get("youtube_url"),
            "youtubeOffsetMs": song.get("youtube_offset_ms", 0),
        }
        summary = chart_summary(chart)
        self._db.upsert(
            "charts",
            {
                "song_id": song["id"],
                "user_id": song["user_id"],
                "data": chart,
                "peaks": published.peaks,
                "drums_path": published.drums_path,
                "backing_path": published.backing_path,
                "edited": False,
            },
            on_conflict="song_id",
        )
        self._db.update(
            "songs",
            {
                "status": song_status(chart),
                "summary": summary,
                "error": None,
                "audio_sha256": sha256,
            },
            id=f"eq.{song['id']}",
        )
        self._update_job(
            job_id,
            status="done",
            stages=build_stages("done"),
            summary=summary,
            cached=published.cached,
            error=None,
        )

    def _fail(self, job: dict, stage: str, code: str, message: str) -> None:
        error = {"code": code, "message": message}
        self._update_job(job["id"], status="failed", stages=build_stages("failed", stage), error=error)
        self._db.update("songs", {"status": "failed", "error": error}, id=f"eq.{job['song_id']}")
        log.warning("trabajo %s falló: %s %s", job["id"], code, message)

    def _update_job(self, job_id: str, **values: object) -> None:
        self._db.update("jobs", values, id=f"eq.{job_id}")


class CloudLoop:
    """Hilo principal: consume la cola y late cada HEARTBEAT_S para que la app lo vea."""

    POLL_S = 5.0
    HEARTBEAT_S = 30.0

    def __init__(self, consumer: CloudConsumer, device: str, models: dict) -> None:
        self._consumer = consumer
        self._device = device
        self._models = models
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        requeued = self._consumer.requeue_interrupted()
        if requeued:
            log.info("%d trabajos interrumpidos vuelven a la cola", requeued)
        beat = threading.Thread(target=self._beat, name="heartbeat", daemon=True)
        beat.start()
        while not self._stop.is_set():
            try:
                worked = self._consumer.process_next()
            except Exception:  # sin red un rato: se reintenta
                log.exception("error consultando la cola")
                worked = False
            if not worked:
                self._stop.wait(self.POLL_S)

    def _beat(self) -> None:
        while not self._stop.is_set():
            try:
                self._consumer.heartbeat(self._device, self._models)
            except Exception:
                log.warning("no se pudo enviar el latido", exc_info=True)
            self._stop.wait(self.HEARTBEAT_S)
