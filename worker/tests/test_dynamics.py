import numpy as np

from app.pipeline.dynamics import (
    BASE_VELOCITY,
    VELOCITY_PER_DB,
    db_to_velocity,
    dynamic_for,
    estimate_velocities,
)

SR = 44100


def _hit(freq: float, amp: float, seconds: float = 0.1) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return amp * np.sin(2 * np.pi * freq * t) * np.exp(-t * 30)


def _place(buf: np.ndarray, sound: np.ndarray, t: float) -> None:
    start = int(t * SR)
    buf[start : start + len(sound)] += sound


def test_median_maps_to_base_velocity_and_scale_is_per_db():
    v = db_to_velocity(np.array([-20.0, -10.0, -14.0]))
    assert v[2] == BASE_VELOCITY
    assert v[1] == round(BASE_VELOCITY + 4 * VELOCITY_PER_DB)
    assert v[0] == round(BASE_VELOCITY - 6 * VELOCITY_PER_DB)


def test_velocity_is_clamped_to_midi_range():
    v = db_to_velocity(np.array([-200.0, 0.0, 0.0, 0.0, 200.0]))
    assert v.min() == 1 and v.max() == 127
    assert db_to_velocity(np.array([])).size == 0


def test_dynamic_thresholds_match_scoring_bonus():
    assert dynamic_for(49) == "ghost"
    assert dynamic_for(50) == "normal"
    assert dynamic_for(100) == "normal"
    assert dynamic_for(101) == "accent"


def test_louder_hits_get_higher_velocity_within_a_piece():
    drums = np.zeros(SR * 2)
    times = [0.2, 0.6, 1.0, 1.4]
    for t, amp in zip(times, [0.1, 0.4, 0.4, 0.8], strict=True):
        _place(drums, _hit(200, amp), t)
    v = estimate_velocities(drums, SR, np.array(times), ["snare"] * 4)
    assert v[0] < v[1] <= v[2] < v[3]
    assert v[0] < 70  # -12 dB respecto a la mediana
    assert all(1 <= x <= 127 for x in v)


def test_band_filter_isolates_pieces_on_the_same_onset():
    """Un bombo fuerte junto a un hi-hat suave no infla la velocity del hi-hat."""
    rng = np.random.default_rng(0)
    drums = np.zeros(SR * 2)
    hat = np.diff(rng.standard_normal(int(0.05 * SR) + 1)) * 0.05
    times = [0.2, 0.7, 1.2]
    for t in times:
        _place(drums, hat, t)
    _place(drums, _hit(60, 0.9, seconds=0.3), 0.7)  # bombo solo en el segundo hi-hat
    v = estimate_velocities(drums, SR, np.array(times), ["hihat_closed"] * 3)
    assert max(v) - min(v) <= 6  # misma intensidad de hi-hat
