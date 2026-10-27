"""Worker en modo nube con un Supabase en memoria (PLAN_V2 B12)."""

from __future__ import annotations

import io
import json
from pathlib import Path

import httpx
import numpy as np
import pytest
import soundfile as sf

from app.api.config import Settings
from app.api.stages import build_stages, song_status
from app.cloud.consumer import CloudConsumer
from app.cloud.supabase import SupabaseError, SupabaseRest, TooLargeError
from app.pipeline.run import PipelineError
from tests.test_api import EXAMPLE, FakeRunner

USER = "11111111-1111-1111-1111-111111111111"
SONG = "22222222-2222-2222-2222-222222222222"
JOB = "33333333-3333-3333-3333-333333333333"


def _matches(row: dict, filters: dict[str, str]) -> bool:
    for column, expr in filters.items():
        if column == "select":
            continue
        op, _, value = expr.partition(".")
        if op == "eq" and str(row.get(column)) != value:
            return False
        if op == "in" and str(row.get(column)) not in value.strip("()").split(","):
            return False
    return True


class FakeSupabase:
    """Mismo contrato que SupabaseRest sobre tablas y buckets en memoria."""

    KEYS = {
        "jobs": "id",
        "songs": "id",
        "charts": "song_id",
        "analysis_cache": "audio_sha256",
        "workers": "id",
    }

    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {name: [] for name in self.KEYS}
        self.objects: dict[tuple[str, str], bytes] = {}
        self.on_select: dict[str, object] = {}

    def rpc(self, function: str, params: dict) -> list[dict]:
        assert function == "claim_next_job"
        for job in self.tables["jobs"]:
            if job["status"] == "queued" and not job["cancel_requested"]:
                job.update(status="separating", worker_id=params["p_worker"])
                return [dict(job)]
        return []

    def select(self, table: str, **filters: str) -> list[dict]:
        hook = self.on_select.get(table)
        if callable(hook):
            hook()
        return [dict(r) for r in self.tables[table] if _matches(r, filters)]

    def select_one(self, table: str, **filters: str) -> dict | None:
        rows = self.select(table, **filters)
        return rows[0] if rows else None

    def update(self, table: str, values: dict, **filters: str) -> list[dict]:
        rows = [r for r in self.tables[table] if _matches(r, filters)]
        for row in rows:
            row.update(json.loads(json.dumps(values)))
        return [dict(r) for r in rows]

    def upsert(self, table: str, row: dict, on_conflict: str) -> None:
        self.delete(table, **{on_conflict: f"eq.{row[on_conflict]}"})
        self.tables[table].append(json.loads(json.dumps(row)))

    def delete(self, table: str, **filters: str) -> None:
        self.tables[table] = [r for r in self.tables[table] if not _matches(r, filters)]

    def download(self, bucket: str, path: str, out, max_bytes: int) -> int:
        data = self.objects.get((bucket, path))
        if data is None:
            raise SupabaseError(400, "Object not found")
        if len(data) > max_bytes:
            raise TooLargeError()
        out.write(data)
        return len(data)

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, path)] = data

    def copy(self, bucket: str, source: str, destination: str) -> None:
        if (bucket, source) not in self.objects:
            raise SupabaseError(400, "Object not found")
        self.objects[(bucket, destination)] = self.objects[(bucket, source)]

    def remove(self, bucket: str, paths: list[str]) -> None:
        for path in paths:
            self.objects.pop((bucket, path), None)

    # ─── datos de prueba ─────────────────────────────────────────────────────

    def add_song(
        self, audio: bytes, song_id: str = SONG, job_id: str = JOB, file_name: str = "tone.wav"
    ) -> None:
        path = f"{USER}/{song_id}/original{Path(file_name).suffix}"
        self.objects[("audio", path)] = audio
        self.tables["songs"].append(
            {
                "id": song_id,
                "user_id": USER,
                "title": "Mi canción",
                "artist": "Yo",
                "file_name": file_name,
                "audio_path": path,
                "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "youtube_offset_ms": 120,
                "status": "analyzing",
                "summary": None,
                "error": None,
            }
        )
        self.tables["jobs"].append(
            {
                "id": job_id,
                "song_id": song_id,
                "user_id": USER,
                "status": "queued",
                "stages": build_stages("queued"),
                "cancel_requested": False,
                "cached": False,
                "worker_id": None,
                "error": None,
                "summary": None,
            }
        )

    def row(self, table: str, key: str) -> dict:
        return next(r for r in self.tables[table] if r[self.KEYS[table]] == key)


@pytest.fixture
def wav_bytes(tmp_path: Path) -> bytes:
    path = tmp_path / "tone.wav"
    t = np.arange(44100) / 44100
    sf.write(path, (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), 44100)
    return path.read_bytes()


@pytest.fixture
def db() -> FakeSupabase:
    return FakeSupabase()


@pytest.fixture
def runner() -> FakeRunner:
    return FakeRunner()


@pytest.fixture
def consumer(db: FakeSupabase, runner: FakeRunner, tmp_path: Path) -> CloudConsumer:
    return CloudConsumer(db, runner, Settings(data_dir=tmp_path / "data"), "pc-test")  # type: ignore[arg-type]


def test_sin_trabajos_no_hace_nada(consumer: CloudConsumer) -> None:
    assert consumer.process_next() is False


def test_analiza_y_publica_en_la_carpeta_del_usuario(
    consumer: CloudConsumer, db: FakeSupabase, runner: FakeRunner, wav_bytes: bytes, tmp_path: Path
) -> None:
    db.add_song(wav_bytes)
    assert consumer.process_next() is True
    assert len(runner.calls) == 1

    job = db.row("jobs", JOB)
    assert job["status"] == "done"
    assert job["cached"] is False
    assert all(s["state"] == "done" for s in job["stages"])
    assert job["summary"]["bpm"] == EXAMPLE["bpm"]

    folder = f"{USER}/{SONG}"
    assert db.objects[("stems", f"{folder}/drums.ogg")] == b"OggS-drums"
    assert db.objects[("stems", f"{folder}/backing.ogg")] == b"OggS-backing"

    chart = db.row("charts", SONG)
    assert chart["user_id"] == USER
    assert chart["drums_path"] == f"{folder}/drums.ogg"
    assert chart["peaks"]["peaks"] == [0.5]
    data = chart["data"]
    assert data["title"] == "Mi canción" and data["artist"] == "Yo"
    assert data["stems"] == {
        "drums": f"storage://stems/{folder}/drums.ogg",
        "backing": f"storage://stems/{folder}/backing.ogg",
    }
    assert data["youtubeUrl"].endswith("dQw4w9WgXcQ")
    assert data["youtubeOffsetMs"] == 120

    song = db.row("songs", SONG)
    assert song["status"] == song_status(EXAMPLE)
    assert song["summary"] == job["summary"]
    assert len(song["audio_sha256"]) == 64
    assert db.row("analysis_cache", song["audio_sha256"])["drums_path"] == f"{folder}/drums.ogg"
    # El audio del usuario sigue en su bucket; el trabajo local se borra
    assert ("audio", song["audio_path"]) in db.objects
    assert not (tmp_path / "data" / "work" / JOB).exists()


def test_mismo_audio_usa_la_cache_y_copia_los_stems(
    consumer: CloudConsumer, db: FakeSupabase, runner: FakeRunner, wav_bytes: bytes
) -> None:
    other_song, other_job = "44444444-4444-4444-4444-444444444444", "55555555-5555-5555-5555-555555555555"
    db.add_song(wav_bytes)
    db.add_song(wav_bytes, song_id=other_song, job_id=other_job)
    consumer.process_next()
    consumer.process_next()

    assert len(runner.calls) == 1
    assert db.row("jobs", other_job)["status"] == "done"
    assert db.row("jobs", other_job)["cached"] is True
    assert db.objects[("stems", f"{USER}/{other_song}/drums.ogg")] == b"OggS-drums"
    assert db.row("charts", other_song)["data"]["stems"]["drums"].endswith(f"{other_song}/drums.ogg")


def test_cache_sin_stems_vuelve_a_analizar(
    consumer: CloudConsumer, db: FakeSupabase, runner: FakeRunner, wav_bytes: bytes
) -> None:
    other_song, other_job = "44444444-4444-4444-4444-444444444444", "55555555-5555-5555-5555-555555555555"
    db.add_song(wav_bytes)
    consumer.process_next()
    # La canción original se borró y con ella sus stems
    db.remove("stems", [f"{USER}/{SONG}/drums.ogg", f"{USER}/{SONG}/backing.ogg"])
    db.add_song(wav_bytes, song_id=other_song, job_id=other_job)
    consumer.process_next()

    assert len(runner.calls) == 2
    assert db.row("jobs", other_job)["cached"] is False
    sha = db.row("songs", other_song)["audio_sha256"]
    assert db.row("analysis_cache", sha)["drums_path"] == f"{USER}/{other_song}/drums.ogg"


def test_cancelar_durante_el_analisis(
    consumer: CloudConsumer, db: FakeSupabase, runner: FakeRunner, wav_bytes: bytes
) -> None:
    db.add_song(wav_bytes)
    runner.hooks["transcribe"] = lambda: db.update("jobs", {"cancel_requested": True}, id=f"eq.{JOB}")
    consumer.process_next()

    job = db.row("jobs", JOB)
    assert job["status"] == "canceled"
    assert not any(bucket == "stems" for bucket, _ in db.objects)
    assert db.tables["charts"] == []


def test_cancion_borrada_durante_el_analisis(
    consumer: CloudConsumer, db: FakeSupabase, runner: FakeRunner, wav_bytes: bytes
) -> None:
    db.add_song(wav_bytes)
    # Borrar la canción borra su trabajo en cascada
    runner.hooks["tempo"] = lambda: db.delete("jobs", id=f"eq.{JOB}")
    consumer.process_next()
    assert db.tables["charts"] == []


def test_fallo_del_pipeline_marca_cancion_y_trabajo(
    consumer: CloudConsumer, db: FakeSupabase, runner: FakeRunner, wav_bytes: bytes
) -> None:
    db.add_song(wav_bytes)
    runner.fail = PipelineError("NO_DRUMS", "no se detectó batería")
    consumer.process_next()

    job = db.row("jobs", JOB)
    assert job["status"] == "failed"
    assert job["error"]["code"] == "NO_DRUMS"
    assert [s["state"] for s in job["stages"]][:2] == ["done", "failed"]
    song = db.row("songs", SONG)
    assert song["status"] == "failed" and song["error"]["code"] == "NO_DRUMS"


def test_audio_invalido_o_ausente(consumer: CloudConsumer, db: FakeSupabase, runner: FakeRunner) -> None:
    db.add_song(b"esto no es audio")
    consumer.process_next()
    assert db.row("jobs", JOB)["error"]["code"] == "DECODE_FAILED"

    other_song, other_job = "44444444-4444-4444-4444-444444444444", "55555555-5555-5555-5555-555555555555"
    db.add_song(b"x", song_id=other_song, job_id=other_job)
    db.objects.pop(("audio", f"{USER}/{other_song}/original.wav"))
    consumer.process_next()
    assert db.row("jobs", other_job)["error"]["code"] == "NOT_FOUND"
    assert runner.calls == []


def test_reintento_vuelve_a_analizando(consumer: CloudConsumer, db: FakeSupabase, wav_bytes: bytes) -> None:
    db.add_song(wav_bytes)
    db.update("songs", {"status": "failed", "error": {"code": "X"}}, id=f"eq.{SONG}")
    seen: list[str] = []
    db.on_select["jobs"] = lambda: seen.append(db.row("songs", SONG)["status"])
    consumer.process_next()
    assert seen and seen[0] == "analyzing"
    assert db.row("songs", SONG)["error"] is None


def test_reencola_lo_interrumpido_y_late(consumer: CloudConsumer, db: FakeSupabase, wav_bytes: bytes) -> None:
    db.add_song(wav_bytes)
    db.update("jobs", {"status": "transcribing", "worker_id": "pc-test"}, id=f"eq.{JOB}")
    assert consumer.requeue_interrupted() == 1
    assert db.row("jobs", JOB)["status"] == "queued"
    assert db.row("jobs", JOB)["worker_id"] is None

    consumer.heartbeat("cpu", {"demucs": "htdemucs"})
    consumer.heartbeat("cpu", {"demucs": "htdemucs"})
    assert len(db.tables["workers"]) == 1
    assert db.row("workers", "pc-test")["device"] == "cpu"


# ─── Cliente HTTP ────────────────────────────────────────────────────────────


def test_cliente_rest_envia_clave_y_filtros() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/rest/v1/jobs" and request.method == "PATCH":
            return httpx.Response(200, json=[{"id": JOB}])
        if request.url.path.startswith("/storage/v1/object/audio/"):
            return httpx.Response(200, content=b"x" * 10)
        return httpx.Response(404, json={"message": "no"})

    client = SupabaseRest("https://demo.supabase.co/", "sb_secret_x", httpx.MockTransport(handler))
    assert client.update("jobs", {"status": "done"}, id=f"eq.{JOB}") == [{"id": JOB}]
    patch = seen[0]
    assert patch.headers["apikey"] == "sb_secret_x"
    assert patch.headers["authorization"] == "Bearer sb_secret_x"
    assert patch.url.params["id"] == f"eq.{JOB}"
    assert patch.headers["prefer"] == "return=representation"

    out = io.BytesIO()
    assert client.download("audio", f"{USER}/{SONG}/mi canción.mp3", out, 100) == 10
    assert seen[1].url.raw_path.decode().endswith("mi%20canci%C3%B3n.mp3")
    with pytest.raises(TooLargeError):
        client.download("audio", f"{USER}/{SONG}/a.mp3", io.BytesIO(), 5)
    with pytest.raises(SupabaseError) as err:
        client.select("songs")
    assert err.value.status == 404
