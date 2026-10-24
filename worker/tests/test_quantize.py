import numpy as np
import pytest

from app.pipeline.quantize import QuantizeOptions, build_grid, quantize, snap
from app.pipeline.transcribe import Onset

BEATS = np.array([1.0, 1.5, 2.0, 2.5])  # 120 BPM


def test_grid_subdivides_each_beat_in_sixteenths():
    grid = build_grid(BEATS, duration_s=2.5, options=QuantizeOptions())
    inside = grid[(grid >= 1.0) & (grid <= 2.5)]
    np.testing.assert_allclose(inside, np.arange(1.0, 2.5001, 0.125))


def test_grid_follows_tempo_drift():
    beats = np.array([0.0, 0.5, 1.1])  # el segundo intervalo es más lento
    grid = build_grid(beats, duration_s=1.1, options=QuantizeOptions())
    np.testing.assert_allclose(grid[:5], [0.0, 0.125, 0.25, 0.375, 0.5])
    np.testing.assert_allclose(grid[5:], [0.65, 0.8, 0.95, 1.1])


def test_grid_extrapolates_before_first_and_after_last_beat():
    grid = build_grid(BEATS, duration_s=3.0, options=QuantizeOptions())
    assert grid[0] == pytest.approx(0.0)
    assert grid[-1] <= 3.0
    np.testing.assert_allclose(grid[-4:], [2.625, 2.75, 2.875, 3.0])


def test_triplets_add_thirds_of_a_beat():
    grid = build_grid(BEATS, duration_s=2.5, options=QuantizeOptions(triplets=True))
    one_beat = grid[(grid >= 1.0) & (grid < 1.5)]
    np.testing.assert_allclose(one_beat, sorted({1.0, 1.125, 1.25, 1.375, 1.0 + 1 / 6, 1.0 + 2 / 6}))


def test_snap_within_tolerance_and_keep_raw_outside():
    grid = build_grid(BEATS, duration_s=2.5, options=QuantizeOptions())
    times = np.array([1.01, 1.24, 1.30])  # 10 ms tarde, 10 ms antes, 50 ms fuera
    snapped, mask = snap(times, grid, tolerance_s=0.035)
    np.testing.assert_allclose(snapped, [1.0, 1.25, 1.30])
    assert mask.tolist() == [True, True, False]


def test_snap_with_single_point_or_empty_grid():
    snapped, mask = snap(np.array([0.99, 2.0]), np.array([1.0]), 0.035)
    np.testing.assert_allclose(snapped, [1.0, 2.0])
    assert mask.tolist() == [True, False]
    snapped, mask = snap(np.array([0.5]), np.array([]), 0.035)
    assert snapped.tolist() == [0.5] and not mask.any()


def test_collision_same_piece_keeps_highest_confidence():
    grid = build_grid(BEATS, duration_s=2.5, options=QuantizeOptions())
    onsets = [
        Onset(t=1.49, piece="snare", confidence=0.5),
        Onset(t=1.51, piece="snare", confidence=0.9),
        Onset(t=1.50, piece="kick", confidence=0.4),  # otra pieza: no colisiona
    ]
    notes = quantize(onsets, grid, tolerance_s=0.035)
    assert [(n.piece, n.t, n.confidence) for n in notes] == [("kick", 1.5, 0.4), ("snare", 1.5, 0.9)]
    assert notes[1].t_raw == 1.51


def test_quantize_keeps_raw_time_and_snapped_flag():
    grid = build_grid(BEATS, duration_s=2.5, options=QuantizeOptions())
    notes = quantize(
        [Onset(t=1.30, piece="hihat_closed", confidence=0.8), Onset(t=1.02, piece="kick", confidence=0.9)],
        grid,
        tolerance_s=0.035,
    )
    assert [(n.t, n.t_raw, n.snapped) for n in notes] == [(1.0, 1.02, True), (1.30, 1.30, False)]
