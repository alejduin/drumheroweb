import numpy as np

from app.pipeline.transcribe import ADTOF_CLASSES, ADTOF_FPS, ADTOF_TO_PIECE, pick_onsets

PIECES_V2 = {
    "kick",
    "snare",
    "snare_rim",
    "hihat_closed",
    "hihat_open",
    "hihat_pedal",
    "tom1",
    "tom2",
    "tom3",
    "crash",
    "ride",
}


def _act(frames: int = 200) -> np.ndarray:
    return np.zeros((frames, len(ADTOF_CLASSES)), dtype=np.float32)


def _bump(act: np.ndarray, cls: str, frame: int, peak: float, left: float = 0.5, right: float = 0.5) -> None:
    c = ADTOF_CLASSES.index(cls)
    act[frame - 1, c], act[frame, c], act[frame + 1, c] = peak * left, peak, peak * right


def test_class_mapping_covers_the_five_adtof_classes():
    assert set(ADTOF_TO_PIECE) == set(ADTOF_CLASSES)
    assert set(ADTOF_TO_PIECE.values()) <= PIECES_V2
    assert ADTOF_TO_PIECE == {
        "kick": "kick",
        "snare": "snare",
        "tom": "tom1",
        "hihat": "hihat_closed",
        "cymbal": "crash",
    }


def test_peaks_above_threshold_become_onsets_with_confidence():
    act = _act()
    _bump(act, "kick", 50, 0.9)
    _bump(act, "snare", 100, 0.7)
    _bump(act, "hihat", 150, 0.1)  # bajo el umbral de hi-hat (0.22)
    onsets = pick_onsets(act)
    assert [(o.piece, round(o.t, 3), round(o.confidence, 2)) for o in onsets] == [
        ("kick", 0.5, 0.9),
        ("snare", 1.0, 0.7),
    ]


def test_subframe_refinement_moves_toward_the_bigger_neighbour():
    act = _act()
    _bump(act, "kick", 50, 0.9, left=0.2, right=0.8)
    (onset,) = pick_onsets(act)
    assert 50 / ADTOF_FPS < onset.t < 50.5 / ADTOF_FPS


def test_close_peaks_of_same_class_merge_keeping_the_strongest():
    act = _act()
    _bump(act, "snare", 50, 0.5)
    _bump(act, "snare", 52, 0.8)  # 20 ms después: mismo golpe
    _bump(act, "kick", 52, 0.6)  # otra clase en el mismo frame: se conserva
    onsets = pick_onsets(act)
    assert [(o.piece, round(o.confidence, 2)) for o in onsets] == [("kick", 0.6), ("snare", 0.8)]


def test_plateau_yields_a_single_onset():
    act = _act()
    c = ADTOF_CLASSES.index("kick")
    act[40:44, c] = 0.6
    assert len(pick_onsets(act)) == 1


def test_onsets_are_sorted_by_time():
    act = _act()
    _bump(act, "cymbal", 120, 0.9)
    _bump(act, "kick", 30, 0.9)
    _bump(act, "tom", 80, 0.9)
    assert [o.piece for o in pick_onsets(act)] == ["kick", "tom1", "crash"]
