"""API del worker con un pipeline falso: estados, 409, 422, cancelación y caché (PLAN_V2 B11)."""

from __future__ import annotations

import json
import subprocess
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.api.config import Settings
from app.api.main import create_app
from app.api.stages import build_stages, chart_summary
from app.pipeline.chart import shared_dir
from app.pipeline.run import AnalysisResult, PipelineError

EXAMPLE = json.loads((shared_dir() / "examples" / "chart-v2.example.json").read_text())
PIPELINE = ["decode", "separate", "transcribe", "tempo", "quantize", "finalize"]


class FakeRunner:
    """Recorre las etapas como analyze() y escribe los archivos de salida."""

    def __init__(self) -> None:
        self.calls: list[Path] = []
        self.hooks: dict[str, Callable[[], None]] = {}
        self.fail: PipelineError | None = None

    def run(self, audio_path: Path, out_root: Path, on_stage: Callable[[str], None]) -> AnalysisResult:
        assert audio_path.is_file(), "el audio subido debe existir mientras se analiza"
        self.calls.append(audio_path)
        for stage in PIPELINE:
            on_stage(stage)
            if stage in self.hooks:
                self.hooks[stage]()
            if self.fail and stage == "transcribe":
                raise self.fail
        out = out_root / "song"
        out.mkdir(parents=True)
        (out / "drums.ogg").write_bytes(b"OggS-drums")
        (out / "backing.ogg").write_bytes(b"OggS-backing")
        (out / "peaks.json").write_text(
            json.dumps({"samplesPerPeak": 441, "sampleRate": 44100, "peaks": [0.5]})
        )
        return AnalysisResult(chart=dict(EXAMPLE), out_dir=out)


@pytest.fixture
def wav_bytes(tmp_path: Path) -> bytes:
    path = tmp_path / "tone.wav"
    t = np.arange(44100) / 44100
    sf.write(path, (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), 44100)
    return path.read_bytes()


@pytest.fixture
def mp3_bytes(tmp_path: Path, wav_bytes: bytes) -> bytes:
    src = tmp_path / "src.wav"
    src.write_bytes(wav_bytes)
    out = tmp_path / "tone.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), str(out)], check=True)
    return out.read_bytes()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data")


@pytest.fixture
def runner() -> FakeRunner:
    return FakeRunner()


@pytest.fixture
def client(settings: Settings, runner: FakeRunner):
    app = create_app(settings, runner, start_consumer=False)
    with TestClient(app) as c:
        c.queue = app.state.queue  # el test mueve la cola a mano
        yield c


def upload(client: TestClient, data: bytes, name: str = "Mi canción.mp3", **form: str):
    return client.post("/v1/jobs", files={"file": (name, data, "application/octet-stream")}, data=form)


def test_health(client: TestClient):
    body = client.get("/v1/health").json()
    assert body["status"] == "ok"
    assert body["device"] in ("cpu", "cuda")
    assert set(body["models"]) == {"demucs", "adtof", "beatThis"}


def test_job_lifecycle(client: TestClient, runner: FakeRunner, mp3_bytes: bytes, settings: Settings):
    res = upload(client, mp3_bytes, title="Mi tema", artist="Yo")
    assert res.status_code == 202
    job_id = res.json()["jobId"]
    assert res.json() == {"jobId": job_id, "status": "queued", "cached": False}

    job = client.get(f"/v1/jobs/{job_id}").json()
    assert job["status"] == "queued"
    assert [s["state"] for s in job["stages"]] == ["pending"] * 5
    assert client.get(f"/v1/jobs/{job_id}/result").status_code == 409
    assert client.get(f"/v1/jobs/{job_id}/result").json()["error"]["code"] == "NOT_READY"

    seen: dict[str, dict] = {}
    for stage in ("transcribe", "quantize"):
        runner.hooks[stage] = lambda stage=stage: seen.setdefault(
            stage, client.get(f"/v1/jobs/{job_id}").json()
        )
    assert client.queue.process_next() is True
    assert seen["transcribe"]["status"] == "transcribing"
    assert [s["state"] for s in seen["transcribe"]["stages"]] == [
        "done",
        "running",
        "pending",
        "pending",
        "pending",
    ]
    assert seen["quantize"]["status"] == "quantizing"

    job = client.get(f"/v1/jobs/{job_id}").json()
    assert job["status"] == "done"
    assert [s["state"] for s in job["stages"]] == ["done"] * 5
    assert job["summary"] == chart_summary(EXAMPLE)
    assert job["error"] is None

    result = client.get(f"/v1/jobs/{job_id}/result").json()
    assert result["chart"]["title"] == "Mi tema" and result["chart"]["artist"] == "Yo"
    assert result["chart"]["difficulties"] == EXAMPLE["difficulties"]
    assert result["stems"] == result["chart"]["stems"]
    assert result["peaks"]["peaks"] == [0.5]
    drums = client.get(result["stems"]["drums"])
    assert drums.status_code == 200 and drums.content == b"OggS-drums"
    assert drums.headers["content-type"] == "audio/ogg"

    # Privacidad: el audio subido no se conserva; tampoco la carpeta de trabajo
    assert not any(settings.uploads_dir.iterdir())
    assert not any(settings.work_dir.iterdir())
    assert client.queue.process_next() is False


def test_cache_by_sha256(client: TestClient, runner: FakeRunner, mp3_bytes: bytes):
    first = upload(client, mp3_bytes).json()["jobId"]
    client.queue.process_next()

    res = upload(client, mp3_bytes, name="otro nombre.mp3", title="Otro título")
    assert res.status_code == 200
    body = res.json()
    assert body["cached"] is True and body["status"] == "done" and body["jobId"] != first
    assert client.queue.process_next() is False
    assert len(runner.calls) == 1
    job = client.get(f"/v1/jobs/{body['jobId']}").json()
    assert job["cached"] is True and job["summary"] is not None
    assert client.get(f"/v1/jobs/{body['jobId']}/result").json()["chart"]["title"] == "Otro título"


def test_same_audio_in_progress_reuses_job(client: TestClient, mp3_bytes: bytes):
    first = upload(client, mp3_bytes).json()
    second = upload(client, mp3_bytes)
    assert second.status_code == 202
    assert second.json()["jobId"] == first["jobId"]


def test_cancel_queued(client: TestClient, runner: FakeRunner, mp3_bytes: bytes):
    job_id = upload(client, mp3_bytes).json()["jobId"]
    assert client.delete(f"/v1/jobs/{job_id}").status_code == 204
    assert client.get(f"/v1/jobs/{job_id}").json()["status"] == "canceled"
    assert client.queue.process_next() is False
    assert runner.calls == []


def test_cancel_running_stops_at_next_stage(client: TestClient, runner: FakeRunner, mp3_bytes: bytes):
    job_id = upload(client, mp3_bytes).json()["jobId"]
    runner.hooks["transcribe"] = lambda: client.delete(f"/v1/jobs/{job_id}")
    client.queue.process_next()
    job = client.get(f"/v1/jobs/{job_id}").json()
    assert job["status"] == "canceled"
    # Se corta al empezar `tempo`; `transcribe` (la que corría) queda sin terminar
    assert [s["state"] for s in job["stages"]] == ["done", "pending", "pending", "pending", "pending"]
    assert client.get(f"/v1/jobs/{job_id}/result").status_code == 409
    # Cancelado no entra en la caché: subirlo otra vez analiza de nuevo
    assert upload(client, mp3_bytes).status_code == 202


def test_pipeline_failure(client: TestClient, runner: FakeRunner, mp3_bytes: bytes):
    runner.fail = PipelineError("NO_DRUMS_DETECTED", "no se detectaron golpes de batería")
    job_id = upload(client, mp3_bytes).json()["jobId"]
    client.queue.process_next()
    job = client.get(f"/v1/jobs/{job_id}").json()
    assert job["status"] == "failed"
    assert job["error"] == {"code": "NO_DRUMS_DETECTED", "message": "no se detectaron golpes de batería"}
    assert [s["state"] for s in job["stages"]] == ["done", "failed", "pending", "pending", "pending"]


def test_unknown_job_404(client: TestClient):
    for res in (
        client.get("/v1/jobs/nope"),
        client.get("/v1/jobs/nope/result"),
        client.delete("/v1/jobs/nope"),
    ):
        assert res.status_code == 404
        assert res.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize(
    ("name", "content", "code"),
    [
        ("tema.ogg", b"OggS", "UNSUPPORTED_FORMAT"),
        ("tema", b"abc", "UNSUPPORTED_FORMAT"),
        ("tema.mp3", b"esto no es audio", "DECODE_FAILED"),
        ("tema.mp3", b"", "DECODE_FAILED"),
    ],
)
def test_input_validation(client: TestClient, settings: Settings, name: str, content: bytes, code: str):
    res = upload(client, content, name=name)
    assert res.status_code == 422
    assert res.json()["error"]["code"] == code
    assert not settings.uploads_dir.exists() or not any(settings.uploads_dir.iterdir())


def test_content_must_match_extension(client: TestClient, wav_bytes: bytes):
    res = upload(client, wav_bytes, name="disfrazado.mp3")
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "UNSUPPORTED_FORMAT"
    assert upload(client, wav_bytes, name="tono.wav").status_code == 202


def test_missing_file_and_json_body(client: TestClient):
    assert client.post("/v1/jobs", data={"title": "x"}).json()["error"]["code"] == "UNSUPPORTED_FORMAT"
    res = client.post("/v1/jobs", json={"audioPath": "a", "sha256": "0" * 64})
    assert res.status_code == 422


def test_limits(settings: Settings, runner: FakeRunner, mp3_bytes: bytes):
    for limits, status, code in (
        ({"max_upload_bytes": 1000}, 413, "TOO_LARGE"),
        ({"max_duration_s": 0.5}, 422, "TOO_LONG"),
    ):
        app = create_app(replace(settings, **limits), runner, start_consumer=False)
        with TestClient(app) as client:
            res = upload(client, mp3_bytes)
            assert res.status_code == status
            assert res.json()["error"]["code"] == code


def test_files_endpoint_only_serves_published(client: TestClient, settings: Settings):
    (settings.files_dir / "abc").mkdir(parents=True)
    (settings.files_dir / "abc" / "peaks.json").write_text("{}")
    (settings.data_dir / "secret.ogg").write_text("x")
    assert client.get("/v1/files/abc/peaks.json").status_code == 200
    assert client.get("/v1/files/abc/../../secret.ogg").status_code == 404
    assert client.get("/v1/files/%2E%2E/secret.ogg").status_code == 404
    assert client.get("/v1/files/abc/chart.json").status_code == 404


def test_restart_requeues_interrupted(settings: Settings, runner: FakeRunner, mp3_bytes: bytes):
    app = create_app(settings, runner, start_consumer=False)
    with TestClient(app) as client:
        job_id = upload(client, mp3_bytes).json()["jobId"]
        app.state.store.claim_next()  # quedó "separating" y el worker se cayó
    app2 = create_app(settings, runner, start_consumer=False)
    with TestClient(app2) as client:
        assert client.get(f"/v1/jobs/{job_id}").json()["status"] == "queued"
        app2.state.queue.process_next()
        assert client.get(f"/v1/jobs/{job_id}").json()["status"] == "done"


def test_consumer_thread_processes_jobs(settings: Settings, runner: FakeRunner, mp3_bytes: bytes):
    import time

    app = create_app(settings, runner)
    with TestClient(app) as client:
        job_id = upload(client, mp3_bytes).json()["jobId"]
        deadline = time.monotonic() + 5
        while client.get(f"/v1/jobs/{job_id}").json()["status"] != "done":
            assert time.monotonic() < deadline, "el consumidor no procesó el trabajo"
            time.sleep(0.02)


def test_build_stages_edges():
    assert [s["state"] for s in build_stages("finalizing")] == ["done"] * 4 + ["running"]
    assert [s["state"] for s in build_stages("failed", None)] == ["pending"] * 5
    assert [s["progress"] for s in build_stages("done")] == [1.0] * 5


def test_summary_counts_low_confidence():
    chart = {
        **EXAMPLE,
        "difficulties": {
            "basic": {"notes": []},
            "intermediate": {"notes": []},
            "full": {
                "notes": [
                    {"t": 0, "piece": "snare", "velocity": 90, "confidence": 0.5},
                    {"t": 1, "piece": "kick", "velocity": 90, "confidence": 0.9},
                    {"t": 2, "piece": "snare", "velocity": 90, "confidence": 0.59},
                ]
            },
        },
    }
    summary = chart_summary(chart)
    assert summary["pieces"] == ["kick", "snare"]
    assert summary["lowConfidenceCount"] == 2
    assert summary["lowConfidenceByPiece"] == {"snare": 2}
