"""Smoke tests con los modelos reales sobre un groove sintético de 5 s.

Lentos (y descargan pesos la primera vez): `pytest -m models`.
No miden calidad (eso es A5 con canciones reales); verifican que cada modelo
carga, acepta nuestros arrays y devuelve algo con forma y escala coherentes.
"""

import numpy as np
import pytest

from app.audio import SAMPLE_RATE, to_mono
from app.device import resolve_device
from app.pipeline.transcribe import ADTOF_CLASSES, ADTOF_FPS, ADTOF_THRESHOLDS
from tests.synth import make_groove

pytestmark = pytest.mark.models


@pytest.fixture(scope="module")
def groove():
    return make_groove(seconds=5.0)


@pytest.fixture(scope="module")
def device():
    return resolve_device()


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.corrcoef(a, b)[0, 1])


def test_demucs_separates_drums(groove, device):
    from app.pipeline.separate import DrumSeparator

    stems = DrumSeparator(device=device).separate(groove.mix)
    assert stems.drums.shape == groove.mix.shape
    assert stems.backing.shape == groove.mix.shape
    # El stem de batería se parece más a la batería real que al fondo, y viceversa
    true_drums, true_backing = to_mono(groove.drums), to_mono(groove.backing)
    assert _corr(to_mono(stems.drums), true_drums) > 0.8
    assert _corr(to_mono(stems.backing), true_backing) > 0.8
    # La suma reconstruye la mezcla
    np.testing.assert_allclose(stems.drums + stems.backing, groove.mix, atol=1e-3)


def test_adtof_activations(groove, device):
    from app.pipeline.transcribe import DrumTranscriber

    act = DrumTranscriber(device=device).activations(to_mono(groove.drums))
    expected_frames = groove.drums.shape[1] / SAMPLE_RATE * ADTOF_FPS
    assert act.shape[1] == len(ADTOF_CLASSES)
    assert abs(act.shape[0] - expected_frames) <= 2
    assert act.min() >= 0.0 and act.max() <= 1.0

    # Cada bombo sintético activa la clase kick por encima de su umbral (±30 ms)
    kick = ADTOF_CLASSES.index("kick")
    for t in groove.onsets["kick"]:
        frame = int(round(t * ADTOF_FPS))
        assert act[frame - 3 : frame + 4, kick].max() > ADTOF_THRESHOLDS[kick], f"bombo en {t:.2f}s"


def test_beat_this_grid(groove, device):
    from app.pipeline.tempo import BeatTracker

    grid = BeatTracker(device=device).track(to_mono(groove.mix), SAMPLE_RATE)
    assert len(grid.beats) >= 6
    assert np.all(np.diff(grid.beats) > 0)
    assert np.median(np.diff(grid.beats)) == pytest.approx(groove.beat_s, rel=0.1)
    assert len(grid.downbeats) >= 1


def test_analyze_end_to_end(tmp_path, device):
    import json

    import soundfile as sf

    from app.pipeline.run import Models, analyze

    groove = make_groove(seconds=8.0)
    src = tmp_path / "groove sintetico.wav"
    sf.write(src, groove.mix.T, SAMPLE_RATE, subtype="FLOAT")

    result = analyze(src, tmp_path / "out", Models.load(device))

    assert result.out_dir.name == "groove-sintetico"
    for name in ("chart.json", "drums.ogg", "backing.ogg", "peaks.json", "run.json"):
        assert (result.out_dir / name).stat().st_size > 0
    chart = json.loads((result.out_dir / "chart.json").read_text())
    assert chart == result.chart
    assert set(result.timings) == {"decode", "separate", "transcribe", "tempo", "quantize", "finalize"}
    assert 110 <= chart["bpm"] <= 130

    # Cada bombo real tiene una nota de bombo a <= 50 ms
    kicks = np.array([n["tRaw"] for n in chart["difficulties"]["full"]["notes"] if n["piece"] == "kick"])
    for t in groove.onsets["kick"]:
        assert np.abs(kicks - t).min() <= 0.05, f"bombo en {t:.2f}s"
