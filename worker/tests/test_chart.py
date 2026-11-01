import copy
import json
from datetime import datetime, timezone

import numpy as np
import pytest

from app.pipeline.chart import (
    CleanGrid,
    SongMeta,
    build_chart,
    chart_invariant_issues,
    clean_grid,
    estimate_beats_per_bar,
    estimate_bpm,
    repair_grid,
    shared_dir,
    song_id_from_name,
    validate_chart,
)
from app.pipeline.peaks import compute_peaks
from app.pipeline.quantize import QuantizedOnset

META = SongMeta(
    id="01-rock",
    title="Rock simple",
    artist="",
    duration_s=4.0,
    audio_url="storage://songs/01-rock.mp3",
    stems={"drums": "storage://poc/01-rock/drums.ogg", "backing": "storage://poc/01-rock/backing.ogg"},
    audio_sha256="a" * 64,
)
GRID = CleanGrid(beats=[0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5], downbeats=[0.5, 2.5])


def _note(t, piece, conf=0.9, t_raw=None):
    return QuantizedOnset(
        t=t, t_raw=t if t_raw is None else t_raw, piece=piece, confidence=conf, snapped=True
    )


@pytest.fixture
def chart():
    notes = [_note(1.0, "snare"), _note(0.5, "kick", t_raw=0.512), _note(0.5, "hihat_closed", 0.42)]
    return build_chart(
        META, GRID, notes, [90, 120, 40], model="m", created_at=datetime(2026, 10, 24, tzinfo=timezone.utc)
    )


def test_built_chart_is_valid_against_schema_and_invariants(chart):
    assert validate_chart(chart) == []


def test_notes_sorted_with_derived_fields(chart):
    notes = chart["difficulties"]["full"]["notes"]
    assert [(n["t"], n["piece"]) for n in notes] == [(0.5, "hihat_closed"), (0.5, "kick"), (1.0, "snare")]
    hihat, kick, snare = notes
    assert kick["tRaw"] == 0.512
    assert (hihat["velocity"], hihat["dynamic"], hihat["confidence"]) == (40, "ghost", 0.42)
    assert (kick["velocity"], kick["dynamic"]) == (120, "accent")
    assert snare["dynamic"] == "normal"


def test_only_full_difficulty_is_emitted(chart):
    assert chart["difficulties"]["basic"] == {"notes": []}
    assert chart["difficulties"]["intermediate"] == {"notes": []}
    assert chart["source"] == {"kind": "ai", "model": "m", "createdAt": "2026-10-24T00:00:00Z"}


def test_tempo_and_meter_come_from_grid(chart):
    assert chart["bpm"] == 120.0
    assert chart["timeSignature"] == [4, 4]
    assert estimate_bpm([0.0]) == 120.0
    waltz = CleanGrid(beats=[0, 1, 2, 3, 4, 5, 6], downbeats=[0, 3, 6])
    assert estimate_beats_per_bar(waltz) == 3


def test_notes_after_duration_are_dropped():
    notes = [_note(3.9, "kick"), _note(4.0, "snare", t_raw=4.2)]
    chart = build_chart(META, GRID, notes, [90, 90], model="m")
    assert [n["piece"] for n in chart["difficulties"]["full"]["notes"]] == ["kick"]


def test_clean_grid_snaps_downbeats_and_removes_bad_beats():
    grid = clean_grid(
        beats=np.array([-0.1, 0.5, 1.0, 1.00001, 1.5, 2.0, 9.0]),
        downbeats=np.array([0.52, 1.49, 1.51, 3.0]),  # 3.0 no tiene beat cerca
        duration_s=4.0,
    )
    assert grid.beats == [0.5, 1.0, 1.5, 2.0]
    assert grid.downbeats == [0.5, 1.5]


def test_clean_grid_without_downbeats_starts_measure_one_on_first_beat():
    assert clean_grid(np.array([0.3, 0.8]), np.array([]), 1.0).downbeats == [0.3]
    with pytest.raises(ValueError):
        clean_grid(np.array([5.0]), np.array([]), 1.0)


def test_song_id_matches_schema_pattern():
    assert song_id_from_name("01 Rock simple (v2).mp3", "x") == "01-Rock-simple-v2"
    assert song_id_from_name("¡¡¡.mp3", "fallback") == "fallback"


def test_schema_rejects_invalid_chart(chart):
    bad = copy.deepcopy(chart)
    bad["difficulties"]["full"]["notes"][0]["piece"] = "cowbell"
    assert validate_chart(bad)


def test_invariants_match_typescript_on_shared_example():
    example = json.loads((shared_dir() / "examples" / "chart-v2.example.json").read_text())
    assert validate_chart(example) == []

    unsorted = copy.deepcopy(example)
    notes = unsorted["difficulties"]["full"]["notes"]
    notes[1]["t"] = notes[0]["t"] - 0.01
    assert any("ordenadas por t" in i for i in chart_invariant_issues(unsorted))

    off_grid = copy.deepcopy(example)
    off_grid["grid"]["downbeats"][1] += 0.01
    assert any("no coincide con ningún beat" in i for i in chart_invariant_issues(off_grid))

    overlap = copy.deepcopy(example)
    overlap["sections"] = [
        {"name": "A", "startMeasure": 2, "endMeasure": 1},
        {"name": "B", "startMeasure": 2, "endMeasure": 2},
    ]
    issues = chart_invariant_issues(overlap)
    assert any("endMeasure debe ser" in i for i in issues)
    assert any("sin solaparse" in i for i in issues)


def test_peaks_are_normalized_blocks():
    audio = np.zeros((2, 1000), dtype=np.float32)
    audio[0, 10] = 0.5
    audio[1, 600] = -0.25
    peaks = compute_peaks(audio, 44100, samples_per_peak=441)
    assert peaks["samplesPerPeak"] == 441 and peaks["sampleRate"] == 44100
    assert peaks["peaks"] == [1.0, 0.5, 0.0]


def _range(start: float, step: float, n: int) -> list[float]:
    return [round(start + i * step, 4) for i in range(n)]


def test_repair_grid_drops_false_intro_beats():
    # Arranque real de "Sonne": mismo caso que tests/chart/gridRepair.test.ts
    grid = CleanGrid(
        beats=[0.12, 0.28, 0.52, 0.66, 0.94, 1.06, 1.34, 1.44, 1.78, 2.62, *_range(3.42, 0.4, 20)],
        downbeats=[0.94, 1.06, 2.62, 4.22, 5.82, 7.42, 9.02],
    )
    repaired = repair_grid(grid)
    assert repaired.beats[:9] == [0.22, 0.62, 1.02, 1.42, 1.82, 2.22, 2.62, 3.02, 3.42]
    assert repaired.downbeats[:4] == [1.02, 2.62, 4.22, 5.82]


def test_repair_grid_removes_duplicate_beats():
    beats = [0, 0.7, 1.4, 2.02, 2.1, 2.8, 3.42, 3.5, 4.2, 4.9, 5.6, 6.3, 7.0]
    repaired = repair_grid(CleanGrid(beats=beats, downbeats=[0, 2.8, 5.6]))
    assert repaired.beats == [0, 0.7, 1.4, 2.1, 2.8, 3.5, 4.2, 4.9, 5.6, 6.3, 7.0]
    assert repaired.downbeats == [0, 2.8, 5.6]


def test_repair_grid_moves_downbeat_off_duplicate():
    beats = [0, 0.7, 1.4, 2.1, 2.72, 2.8, 3.5, 4.2, 4.9, 5.6, 6.3]
    repaired = repair_grid(CleanGrid(beats=beats, downbeats=[0, 2.72, 2.8, 5.6]))
    assert repaired.downbeats == [0, 2.8, 5.6]


def test_repair_grid_removes_short_measures():
    repaired = repair_grid(CleanGrid(beats=_range(0, 0.5, 24), downbeats=[0, 2, 2.5, 4.5, 6.5, 8.5]))
    assert repaired.downbeats == [0, 2, 4.5, 6.5, 8.5]


def test_repair_grid_keeps_regular_grid():
    grid = CleanGrid(beats=_range(2, 0.5, 16), downbeats=[2.0, 4.0, 6.0, 8.0])
    assert repair_grid(grid) == grid
