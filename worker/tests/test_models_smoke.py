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
