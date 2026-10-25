"""Servicio HTTP del worker (PLAN_V2 §3, B11). `uvicorn app.api.main:app`."""

from __future__ import annotations

import json
import logging
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from app.api.config import Settings
from app.api.errors import ApiError, not_found
from app.api.queue import PUBLISHED_FILES, JobQueue
from app.api.runner import PipelineRunner, Runner
from app.api.stages import build_stages, chart_summary
from app.api.store import JobStore
from app.api.uploads import save_upload
from app.versions import model_versions

log = logging.getLogger("drumhero.worker")

# Margen sobre el límite para el resto del multipart (boundary, otros campos)
MULTIPART_OVERHEAD_BYTES = 64 * 1024


def create_app(
    settings: Settings | None = None, runner: Runner | None = None, start_consumer: bool = True
) -> FastAPI:
    settings = settings or Settings.from_env()
    runner = runner or PipelineRunner()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = JobStore(settings.db_path)
        requeued = store.requeue_interrupted()
        if requeued:
            log.info("%d trabajos interrumpidos vuelven a la cola", requeued)
        queue = JobQueue(store, settings, runner)
        app.state.store = store
        app.state.queue = queue
        if settings.preload_models and isinstance(runner, PipelineRunner):
            await run_in_threadpool(runner.preload)
        if start_consumer:
            queue.start()
        yield
        queue.stop()
        store.close()

    app = FastAPI(title="DrumHero AI — worker", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(exc.body(), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        detail = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
        return JSONResponse(ApiError(422, "UNSUPPORTED_FORMAT", detail).body(), status_code=422)

    def store(request: Request) -> JobStore:
        return request.app.state.store

    def get_job_or_404(request: Request, job_id: str) -> dict:
        job = store(request).get_job(job_id)
        if job is None:
            raise not_found(f"el trabajo {job_id}")
        return job

    @app.get("/v1/health")
    def health() -> dict:
        from app.device import resolve_device

        return {"status": "ok", "device": resolve_device(), "models": model_versions()}

    @app.post("/v1/jobs")
    async def create_job(request: Request) -> JSONResponse:
        content_type = request.headers.get("content-type", "")
        if not content_type.startswith("multipart/form-data"):
            # El cuerpo JSON (audioPath en Storage) llega con STORAGE_BACKEND=supabase (B12)
            raise ApiError(
                422, "UNSUPPORTED_FORMAT", "en modo local se sube el archivo como multipart (campo file)"
            )
        length = int(request.headers.get("content-length") or 0)
        if length > settings.max_upload_bytes + MULTIPART_OVERHEAD_BYTES:
            raise ApiError(413, "TOO_LARGE", f"el archivo supera {settings.max_upload_bytes // (1 << 20)} MB")

        form = await request.form()
        upload = form.get("file")
        if not isinstance(upload, UploadFile) or not upload.filename:
            raise ApiError(422, "UNSUPPORTED_FORMAT", "falta el archivo (campo file)")
        title = str(form.get("title") or "").strip()
        artist = str(form.get("artist") or "").strip()

        dest = settings.uploads_dir / uuid.uuid4().hex
        try:
            saved = await run_in_threadpool(save_upload, upload.file, upload.filename, dest, settings)
        finally:
            await upload.close()
        return create_job_for(request, saved, title, artist, dest)

    def create_job_for(request: Request, saved, title: str, artist: str, dest: Path) -> JSONResponse:
        jobs = store(request)
        common = {
            "sha256": saved.sha256,
            "title": title or saved.title_tag,
            "artist": artist or saved.artist_tag,
            "file_name": saved.path.name,
        }
        cached = jobs.cache_get(saved.sha256)
        if cached is not None:
            shutil.rmtree(dest, ignore_errors=True)
            job = jobs.create_job(
                **common, upload_path=None, status="done", cached=True, summary=chart_summary(cached["chart"])
            )
            return JSONResponse({"jobId": job["id"], "status": "done", "cached": True}, status_code=200)

        active = jobs.find_active(saved.sha256)
        if active is not None:
            # El mismo audio ya se está analizando: se reutiliza ese trabajo
            shutil.rmtree(dest, ignore_errors=True)
            return JSONResponse({"jobId": active["id"], "status": active["status"], "cached": False}, 202)

        job = jobs.create_job(**common, upload_path=str(saved.path))
        request.app.state.queue.notify()
        return JSONResponse({"jobId": job["id"], "status": job["status"], "cached": False}, status_code=202)

    @app.get("/v1/jobs/{job_id}")
    def get_job(request: Request, job_id: str) -> dict:
        return job_view(get_job_or_404(request, job_id))

    @app.delete("/v1/jobs/{job_id}", status_code=204)
    def cancel_job(request: Request, job_id: str) -> Response:
        get_job_or_404(request, job_id)
        store(request).request_cancel(job_id)
        return Response(status_code=204)

    @app.get("/v1/jobs/{job_id}/result")
    def get_result(request: Request, job_id: str) -> dict:
        job = get_job_or_404(request, job_id)
        if job["status"] != "done":
            raise ApiError(409, "NOT_READY", f"el trabajo está en estado {job['status']}")
        cached = store(request).cache_get(job["sha256"])
        if cached is None:
            raise ApiError(404, "NOT_FOUND", "el resultado ya no está disponible")
        files = settings.files_dir / cached["files_path"]
        base = str(request.base_url).rstrip("/")
        stems = {
            "drums": f"{base}/v1/files/{cached['files_path']}/drums.ogg",
            "backing": f"{base}/v1/files/{cached['files_path']}/backing.ogg",
        }
        chart = {**cached["chart"], "stems": stems}
        if job["title"]:
            chart["title"] = job["title"]
        if job["artist"]:
            chart["artist"] = job["artist"]
        peaks = json.loads((files / "peaks.json").read_text())
        return {"chart": chart, "stems": stems, "peaks": peaks}

    @app.get("/v1/files/{path:path}")
    def get_file(path: str) -> FileResponse:
        root = settings.files_dir.resolve()
        target = (root / path).resolve()
        # Solo lo publicado, sin escapar de files/ (../)
        if not target.is_relative_to(root) or target.name not in PUBLISHED_FILES or not target.is_file():
            raise not_found("el archivo")
        media = "application/json" if target.suffix == ".json" else "audio/ogg"
        return FileResponse(target, media_type=media)

    return app


def job_view(job: dict) -> dict:
    """Fila de `jobs` → Job de shared/openapi.yaml."""
    return {
        "jobId": job["id"],
        "status": job["status"],
        "cached": job["cached"],
        "stages": build_stages(job["status"], job["failed_stage"]),
        "summary": job["summary"],
        "error": job["error"],
        "createdAt": job["created_at"],
        "updatedAt": job["updated_at"],
    }


def build_app() -> FastAPI:
    """Fábrica para `uvicorn --factory app.api.main:build_app` (configuración por entorno)."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return create_app()
