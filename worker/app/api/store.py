"""Tablas `jobs` y `analysis_cache` en SQLite (modo local; en B12, Postgres de Supabase)."""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.api.stages import TERMINAL_STATUSES

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    upload_path TEXT,
    cached INTEGER NOT NULL DEFAULT 0,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    failed_stage TEXT,
    summary TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS jobs_sha ON jobs (sha256);
CREATE TABLE IF NOT EXISTS analysis_cache (
    sha256 TEXT PRIMARY KEY,
    chart TEXT NOT NULL,
    files_path TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""

_JSON_COLUMNS = ("summary", "error")
_RUNNING = ("separating", "transcribing", "tempo", "quantizing", "finalizing")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class JobStore:
    """Acceso serializado con un lock: la API y el consumidor corren en hilos distintos."""

    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ─── jobs ────────────────────────────────────────────────────────────────

    def create_job(
        self,
        *,
        sha256: str,
        title: str,
        artist: str,
        file_name: str,
        upload_path: str | None,
        status: str = "queued",
        cached: bool = False,
        summary: dict | None = None,
    ) -> dict:
        job_id = uuid.uuid4().hex
        now = utc_now()
        with self._lock:
            self._db.execute(
                "INSERT INTO jobs (id, status, sha256, title, artist, file_name, upload_path, cached,"
                " summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    job_id,
                    status,
                    sha256,
                    title,
                    artist,
                    file_name,
                    upload_path,
                    int(cached),
                    json.dumps(summary) if summary is not None else None,
                    now,
                    now,
                ),
            )
        job = self.get_job(job_id)
        assert job is not None
        return job

    def get_job(self, job_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return _row(row)

    def find_active(self, sha256: str) -> dict | None:
        """Trabajo en cola o en proceso del mismo audio (no se analiza dos veces a la vez)."""
        marks = ",".join("?" * len(TERMINAL_STATUSES))
        with self._lock:
            row = self._db.execute(
                f"SELECT * FROM jobs WHERE sha256 = ? AND status NOT IN ({marks})"
                " ORDER BY created_at LIMIT 1",
                (sha256, *TERMINAL_STATUSES),
            ).fetchone()
        return _row(row)

    def claim_next(self) -> dict | None:
        """Toma el trabajo en cola más antiguo y lo pasa a `separating`."""
        with self._lock:
            row = self._db.execute(
                "SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            self._db.execute(
                "UPDATE jobs SET status = 'separating', updated_at = ? WHERE id = ?", (utc_now(), row["id"])
            )
        return self.get_job(row["id"])

    def update(self, job_id: str, **fields: object) -> dict | None:
        values = {
            k: (json.dumps(v) if k in _JSON_COLUMNS and v is not None else v) for k, v in fields.items()
        }
        values["updated_at"] = utc_now()
        columns = ", ".join(f"{k} = ?" for k in values)
        with self._lock:
            self._db.execute(f"UPDATE jobs SET {columns} WHERE id = ?", (*values.values(), job_id))
        return self.get_job(job_id)

    def request_cancel(self, job_id: str) -> dict | None:
        """En cola → cancelado al instante; en proceso → marca para que el consumidor lo corte."""
        now = utc_now()
        with self._lock:
            self._db.execute(
                "UPDATE jobs SET status = 'canceled', updated_at = ? WHERE id = ? AND status = 'queued'",
                (now, job_id),
            )
            marks = ",".join("?" * len(_RUNNING))
            self._db.execute(
                f"UPDATE jobs SET cancel_requested = 1, updated_at = ? WHERE id = ? AND status IN ({marks})",
                (now, job_id, *_RUNNING),
            )
        return self.get_job(job_id)

    def requeue_interrupted(self) -> int:
        """Al arrancar: lo que quedó a medias (worker reiniciado) vuelve a la cola."""
        marks = ",".join("?" * len(_RUNNING))
        with self._lock:
            cur = self._db.execute(
                f"UPDATE jobs SET status = 'queued', failed_stage = NULL, updated_at = ?"
                f" WHERE status IN ({marks}) AND cancel_requested = 0",
                (utc_now(), *_RUNNING),
            )
            self._db.execute(
                f"UPDATE jobs SET status = 'canceled', updated_at = ? WHERE status IN ({marks})",
                (utc_now(), *_RUNNING),
            )
        return cur.rowcount

    # ─── analysis_cache ──────────────────────────────────────────────────────

    def cache_get(self, sha256: str) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM analysis_cache WHERE sha256 = ?", (sha256,)).fetchone()
        if row is None:
            return None
        return {"sha256": row["sha256"], "chart": json.loads(row["chart"]), "files_path": row["files_path"]}

    def cache_put(self, sha256: str, chart: dict, files_path: str) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO analysis_cache (sha256, chart, files_path, created_at)"
                " VALUES (?, ?, ?, ?)",
                (sha256, json.dumps(chart, ensure_ascii=False), files_path, utc_now()),
            )


def _row(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    job = dict(row)
    for key in _JSON_COLUMNS:
        job[key] = json.loads(job[key]) if job[key] else None
    job["cached"] = bool(job["cached"])
    job["cancel_requested"] = bool(job["cancel_requested"])
    return job
