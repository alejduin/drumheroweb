import json

import numpy as np
import pytest

from poc.__main__ import main
from poc.evaluate import (
    NONE,
    Event,
    GroupScore,
    chart_events,
    estimate_offset,
    evaluate,
    format_confusion,
    format_scores,
    load_reference,
    summarize,
)

BEAT = 0.5


def groove(seconds: float = 30.0) -> list[Event]:
    """Bombo en 1 y 3, caja en 2 y 4, hi-hat en corcheas (120 BPM)."""
    events = []
    for i, t in enumerate(np.arange(1.0, seconds, BEAT)):
        events.append(Event(float(t), "kick" if i % 2 == 0 else "snare"))
        events.append(Event(float(t), "hihat"))
        events.append(Event(float(t + BEAT / 2), "hihat"))
    return sorted(events, key=lambda e: e.t)


TAKES = [(0.0, 30.0)]


def shifted(events: list[Event], dt: float, jitter: float = 0.0, seed: int = 0) -> list[Event]:
    rng = np.random.default_rng(seed)
    return [Event(e.t + dt + rng.uniform(-jitter, jitter), e.group, e.confidence) for e in events]


def test_perfect_chart_scores_one():
    ref = groove()
    result = evaluate(ref, ref, TAKES)
    assert result.offset_s == 0.0
    for group in ("kick", "snare", "hihat"):
        assert result.scores[group].f1 == 1.0
    assert result.scores["tom"].f1 is None  # no aparece en ninguno
    assert result.confusion["kick"]["kick"] == result.scores["kick"].reference
    assert result.confusion[NONE] == dict.fromkeys(result.confusion[NONE], 0)


def test_global_offset_is_estimated_and_removed():
    ref = groove()
    late = shifted(ref, 0.12, jitter=0.01)  # chart 120 ms tarde, con ruido
    result = evaluate(ref, late, TAKES)
    assert result.offset_s == pytest.approx(-0.12, abs=0.005)
    assert result.scores["kick"].f1 == 1.0
    assert result.timing_ms["medianAbs"] <= 10


def test_offset_beyond_window_without_alignment_would_fail():
    ref = groove()
    late = shifted(ref, 0.12)
    no_search = evaluate(ref, late, TAKES, max_offset_s=0.0)
    assert no_search.scores["kick"].f1 == 0.0


def test_estimate_offset_handles_empty_inputs():
    assert estimate_offset(np.array([]), np.array([1.0])) == 0.0
    assert estimate_offset(np.array([1.0, 2.0]), np.array([])) == 0.0


def test_confusion_snare_detected_as_tom():
    ref = groove()
    est = [Event(e.t, "tom") if e.group == "snare" else e for e in ref]
    result = evaluate(ref, est, TAKES)
    n_snare = result.scores["snare"].reference
    assert result.scores["snare"].f1 == 0.0
    assert result.confusion["snare"]["tom"] == n_snare
    assert result.confusion["snare"][NONE] == 0
    assert result.confusion[NONE]["tom"] == 0
    assert result.scores["kick"].f1 == 1.0


def test_missed_and_extra_hits():
    ref = groove()
    est = [e for e in ref if not (e.group == "hihat" and e.t % 1 == 0.25)]  # faltan hi-hats
    est += [Event(t, "cymbal") for t in (3.1, 7.1)]  # dos platillos inventados
    result = evaluate(ref, est, TAKES)
    hihat = result.scores["hihat"]
    assert hihat.precision == 1.0 and hihat.recall < 1.0
    assert result.confusion["hihat"][NONE] == hihat.reference - hihat.matched
    assert result.confusion[NONE]["cymbal"] == 2
    assert result.scores["cymbal"].f1 == 0.0


def test_only_recorded_takes_are_evaluated():
    ref = [e for e in groove() if e.t <= 10.0]
    result = evaluate(ref, groove(), [(0.0, 10.0)])
    assert result.scores["kick"].f1 == 1.0  # lo del chart después de 10 s no cuenta
    assert result.evaluated_s == 10.0


def test_confidence_buckets_report_precision():
    ref = groove()
    est = list(ref) + [Event(t, "snare", confidence=0.3) for t in (2.3, 4.3, 6.3)]
    result = evaluate(ref, est, TAKES)
    assert result.confidence["high"]["precision"] == 1.0
    assert result.confidence["low"] == {"notes": 3, "precision": 0.0}


def test_summary_mean_f1_and_criterion():
    good = evaluate(groove(), groove(), TAKES)
    weak_est = [e for e in groove() if e.group != "hihat"]
    weak = evaluate(groove(), weak_est, TAKES)
    summary = summarize([good, weak])
    assert summary.mean_f1["kick"] == 1.0
    assert summary.mean_f1["hihat"] == 0.5
    assert summary.mean_f1["tom"] is None
    assert not summary.criterion_met
    assert summarize([good]).criterion_met
    assert summary.micro["kick"].reference == 2 * good.scores["kick"].reference


def test_group_score_edge_cases():
    assert GroupScore(0, 0, 0).f1 is None
    assert GroupScore(10, 0, 0).f1 == 0.0
    assert GroupScore(0, 5, 0).precision == 0.0 and GroupScore(0, 5, 0).recall is None


def _write_reference(path, hits, takes):
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "songId": "x",
                "audioFile": "x.mp3",
                "audioSha256": None,
                "durationS": 30,
                "recordedAt": "2026-10-24T00:00:00Z",
                "device": "TD-02",
                "outputLatencyMs": 20,
                "takes": takes,
                "hits": hits,
            }
        )
    )


def test_load_reference_groups_pieces_and_skips_pedal(tmp_path):
    path = tmp_path / "x.json"
    hits = [
        {"t": 1.0, "piece": "snare_rim", "note": 40, "velocity": 80},
        {"t": 0.5, "piece": "ride", "note": 59, "velocity": 80},
        {"t": 1.5, "piece": "hihat_pedal", "note": 44, "velocity": 60},
        {"t": 2.0, "piece": "tom3", "note": 43, "velocity": 90},
    ]
    _write_reference(path, hits, [{"startS": 0, "endS": 3}])
    events, takes = load_reference(path)
    assert [(e.t, e.group) for e in events] == [(0.5, "cymbal"), (1.0, "snare"), (2.0, "tom")]
    assert takes == [(0.0, 3.0)]
    assert len(load_reference(path, include_pedal=True)[0]) == 4


def test_chart_events_use_t_or_raw():
    chart = {
        "difficulties": {
            "full": {
                "notes": [
                    {"t": 1.0, "tRaw": 1.02, "piece": "crash", "velocity": 90, "confidence": 0.7},
                    {"t": 1.5, "piece": "hihat_pedal", "velocity": 90, "confidence": 0.7},
                ]
            }
        }
    }
    assert [(e.t, e.group) for e in chart_events(chart)] == [(1.0, "cymbal")]
    assert chart_events(chart, use_raw=True)[0].t == 1.02


def test_formatting_has_all_groups():
    result = evaluate(groove(), groove(), TAKES)
    table = format_scores(result.scores)
    assert all(g in table for g in ("kick", "snare", "hihat", "tom", "cymbal"))
    assert "n/a" in table
    assert format_confusion(result.confusion).count("\n") == 5  # cabecera + 5 grupos (sin fila de extras)


def test_cli_evaluate_end_to_end(tmp_path, capsys):
    out, refs = tmp_path / "out", tmp_path / "refs"
    (out / "Mi-cancion").mkdir(parents=True)
    refs.mkdir()
    ref_events = groove(10.0)
    notes = [
        {
            "t": round(e.t + 0.08, 4),
            "piece": {"hihat": "hihat_closed"}.get(e.group, e.group),
            "velocity": 90,
            "confidence": 0.9,
        }
        for e in ref_events
    ]
    (out / "Mi-cancion" / "chart.json").write_text(json.dumps({"difficulties": {"full": {"notes": notes}}}))
    piece = {"hihat": "hihat_closed"}
    hits = [{"t": e.t, "piece": piece.get(e.group, e.group), "note": 36, "velocity": 90} for e in ref_events]
    _write_reference(refs / "Mi-cancion.json", hits, [{"startS": 0, "endS": 10}])

    code = main(["evaluate", "Mi-cancion", "--out", str(out), "--references", str(refs)])
    printed = capsys.readouterr().out
    assert code == 0
    assert "desfase -80 ms" in printed
    assert "CUMPLE" in printed and "NO CUMPLE" not in printed
    saved = json.loads((out / "Mi-cancion" / "eval.json").read_text())
    assert saved["scores"]["kick"]["f1"] == 1.0


def test_cli_evaluate_without_data_fails(tmp_path):
    assert main(["evaluate", "nada", "--out", str(tmp_path), "--references", str(tmp_path)]) == 1
