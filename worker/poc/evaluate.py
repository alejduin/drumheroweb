"""A5 — comparar el chart generado con la referencia grabada (A4).

Se agrupan las piezas en las 5 clases que ADTOF puede distinguir. Antes de
comparar se estima el desfase global (latencia del kit + reacción humana); luego,
dentro de los tramos grabados, se emparejan golpes con mir_eval (±window) por grupo.
La matriz de confusión empareja primero por grupo y después, con lo que sobra,
sin mirar la pieza: así una caja detectada como tom aparece como confusión y no
como un fallo más un golpe extra.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

GROUPS = ("kick", "snare", "hihat", "tom", "cymbal")
PIECE_TO_GROUP = {
    "kick": "kick",
    "snare": "snare",
    "snare_rim": "snare",
    "hihat_closed": "hihat",
    "hihat_open": "hihat",
    "hihat_pedal": "hihat",
    "tom1": "tom",
    "tom2": "tom",
    "tom3": "tom",
    "crash": "cymbal",
    "ride": "cymbal",
}
NONE = "—"  # sin pareja: fila = golpe extra del chart, columna = golpe no detectado

DEFAULT_WINDOW_S = 0.05
DEFAULT_MAX_OFFSET_S = 0.3
OFFSET_STEP_S = 0.001
OFFSET_MATCH_S = 0.025
CRITERION_GROUPS = ("kick", "snare", "hihat")
CRITERION_F1 = 0.85
LOW_CONFIDENCE = 0.6  # LOW_CONFIDENCE_THRESHOLD en src/constants/chart.ts


@dataclass(frozen=True)
class Event:
    t: float
    group: str
    confidence: float = 1.0


@dataclass
class GroupScore:
    reference: int
    detected: int
    matched: int

    @property
    def precision(self) -> float | None:
        return self.matched / self.detected if self.detected else None

    @property
    def recall(self) -> float | None:
        return self.matched / self.reference if self.reference else None

    @property
    def f1(self) -> float | None:
        if not self.reference and not self.detected:
            return None  # el grupo no aparece: no cuenta
        total = self.reference + self.detected
        return 2 * self.matched / total


@dataclass
class EvalResult:
    offset_s: float
    window_s: float
    evaluated_s: float
    scores: dict[str, GroupScore]
    confusion: dict[str, dict[str, int]]
    timing_ms: dict[str, float | None] = field(default_factory=dict)
    confidence: dict[str, dict[str, float | int | None]] = field(default_factory=dict)

    def to_json(self) -> dict:
        data = asdict(self)
        for group, score in self.scores.items():
            data["scores"][group].update(precision=score.precision, recall=score.recall, f1=score.f1)
        return data


# ─── Carga ───────────────────────────────────────────────────────────────────


def load_reference(path: Path, include_pedal: bool = False) -> tuple[list[Event], list[tuple[float, float]]]:
    """reference.json (A4) → eventos agrupados y tramos grabados."""
    data = json.loads(Path(path).read_text())
    if data.get("version") != 1:
        raise ValueError(f"{path}: versión de referencia no soportada")
    events = [
        Event(t=float(h["t"]), group=PIECE_TO_GROUP[h["piece"]])
        for h in data["hits"]
        if h["piece"] in PIECE_TO_GROUP and (include_pedal or h["piece"] != "hihat_pedal")
    ]
    takes = [(float(k["startS"]), float(k["endS"])) for k in data["takes"]]
    if not takes and events:  # sin tramos: toda la duración
        takes = [(0.0, float(data.get("durationS", max(e.t for e in events))))]
    return sorted(events, key=lambda e: e.t), takes


def chart_events(chart: dict, use_raw: bool = False, include_pedal: bool = False) -> list[Event]:
    notes = chart["difficulties"]["full"]["notes"]
    return sorted(
        (
            Event(
                t=float(n["tRaw"] if use_raw and "tRaw" in n else n["t"]),
                group=PIECE_TO_GROUP[n["piece"]],
                confidence=float(n["confidence"]),
            )
            for n in notes
            if include_pedal or n["piece"] != "hihat_pedal"
        ),
        key=lambda e: e.t,
    )


# ─── Alineación ──────────────────────────────────────────────────────────────


def _nearest_distance(sorted_ref: np.ndarray, times: np.ndarray) -> np.ndarray:
    """Distancia con signo (ref - t) al evento de referencia más cercano."""
    idx = np.clip(np.searchsorted(sorted_ref, times), 1, len(sorted_ref) - 1)
    left, right = sorted_ref[idx - 1], sorted_ref[idx]
    return np.where(times - left <= right - times, left - times, right - times)


def estimate_offset(
    ref_times: np.ndarray,
    est_times: np.ndarray,
    max_offset_s: float = DEFAULT_MAX_OFFSET_S,
    step_s: float = OFFSET_STEP_S,
    match_s: float = OFFSET_MATCH_S,
) -> float:
    """Desfase a sumar al chart para alinearlo con la referencia.

    Barrido: el desfase con más golpes del chart a <= match_s de algún golpe de
    referencia; luego se refina con la mediana de esas distancias.
    """
    ref = np.sort(np.asarray(ref_times, dtype=np.float64))
    est = np.asarray(est_times, dtype=np.float64)
    if len(ref) < 2 or len(est) == 0:
        return 0.0
    offsets = np.arange(-max_offset_s, max_offset_s + step_s / 2, step_s)
    counts = [int((np.abs(_nearest_distance(ref, est + off)) <= match_s).sum()) for off in offsets]
    best = float(offsets[int(np.argmax(counts))])  # empate → el primero (argmax)
    dist = _nearest_distance(ref, est + best)
    close = dist[np.abs(dist) <= match_s]
    return round(best + float(np.median(close)) if len(close) else best, 4)


def _in_takes(times: np.ndarray, takes: list[tuple[float, float]], margin: float) -> np.ndarray:
    mask = np.zeros(len(times), dtype=bool)
    for start, end in takes:
        mask |= (times >= start - margin) & (times <= end + margin)
    return mask


def _covered(takes: list[tuple[float, float]]) -> float:
    total, cur_start, cur_end = 0.0, None, None
    for start, end in sorted(takes):
        if cur_end is None or start > cur_end:
            if cur_end is not None:
                total += cur_end - cur_start
            cur_start, cur_end = start, end
        else:
            cur_end = max(cur_end, end)
    if cur_end is not None:
        total += cur_end - cur_start
    return round(total, 3)


# ─── Evaluación ──────────────────────────────────────────────────────────────


def _match(ref: np.ndarray, est: np.ndarray, window_s: float) -> list[tuple[int, int]]:
    from mir_eval.util import match_events

    if len(ref) == 0 or len(est) == 0:
        return []
    return match_events(ref, est, window_s)


def evaluate(
    reference: list[Event],
    detected: list[Event],
    takes: list[tuple[float, float]],
    window_s: float = DEFAULT_WINDOW_S,
    max_offset_s: float = DEFAULT_MAX_OFFSET_S,
) -> EvalResult:
    ref_t = np.array([e.t for e in reference])
    offset = estimate_offset(ref_t, np.array([e.t for e in detected]), max_offset_s)

    shifted = [Event(e.t + offset, e.group, e.confidence) for e in detected]
    keep = _in_takes(np.array([e.t for e in shifted]), takes, margin=window_s)
    detected = [e for e, k in zip(shifted, keep, strict=True) if k]

    scores: dict[str, GroupScore] = {}
    confusion = {g: dict.fromkeys((*GROUPS, NONE), 0) for g in (*GROUPS, NONE)}
    leftover_ref: list[Event] = []
    leftover_est: list[Event] = []
    errors_ms: list[float] = []
    est_matched: list[tuple[Event, bool]] = []

    for group in GROUPS:
        ref_g = [e for e in reference if e.group == group]
        est_g = [e for e in detected if e.group == group]
        pairs = _match(np.array([e.t for e in ref_g]), np.array([e.t for e in est_g]), window_s)
        scores[group] = GroupScore(reference=len(ref_g), detected=len(est_g), matched=len(pairs))
        confusion[group][group] = len(pairs)
        matched_ref = {i for i, _ in pairs}
        matched_est = {j for _, j in pairs}
        errors_ms.extend((est_g[j].t - ref_g[i].t) * 1000 for i, j in pairs)
        leftover_ref.extend(e for i, e in enumerate(ref_g) if i not in matched_ref)
        leftover_est.extend(e for j, e in enumerate(est_g) if j not in matched_est)
        est_matched.extend((e, j in matched_est) for j, e in enumerate(est_g))

    # Lo que sobra: emparejar sin mirar la pieza = confusiones entre grupos
    leftover_ref.sort(key=lambda e: e.t)
    leftover_est.sort(key=lambda e: e.t)
    pairs = _match(np.array([e.t for e in leftover_ref]), np.array([e.t for e in leftover_est]), window_s)
    used_ref = {i for i, _ in pairs}
    used_est = {j for _, j in pairs}
    for i, j in pairs:
        confusion[leftover_ref[i].group][leftover_est[j].group] += 1
    for i, e in enumerate(leftover_ref):
        if i not in used_ref:
            confusion[e.group][NONE] += 1
    for j, e in enumerate(leftover_est):
        if j not in used_est:
            confusion[NONE][e.group] += 1

    abs_err = np.abs(errors_ms)
    timing = {
        "medianAbs": round(float(np.median(abs_err)), 1) if len(abs_err) else None,
        "p90Abs": round(float(np.percentile(abs_err, 90)), 1) if len(abs_err) else None,
        "meanSigned": round(float(np.mean(errors_ms)), 1) if errors_ms else None,
    }

    def bucket(low: bool) -> dict[str, float | int | None]:
        items = [ok for e, ok in est_matched if (e.confidence < LOW_CONFIDENCE) == low]
        return {"notes": len(items), "precision": round(sum(items) / len(items), 3) if items else None}

    return EvalResult(
        offset_s=offset,
        window_s=window_s,
        evaluated_s=_covered(takes),
        scores=scores,
        confusion=confusion,
        timing_ms=timing,
        confidence={"high": bucket(low=False), "low": bucket(low=True)},
    )


# ─── Agregado ────────────────────────────────────────────────────────────────


@dataclass
class Summary:
    songs: int
    micro: dict[str, GroupScore]
    mean_f1: dict[str, float | None]
    criterion_met: bool


def summarize(results: list[EvalResult]) -> Summary:
    """Micro (sumando conteos) y media del F1 por canción; criterio de avance de A6."""
    micro = {g: GroupScore(0, 0, 0) for g in GROUPS}
    mean_f1: dict[str, float | None] = {}
    for group in GROUPS:
        f1s = []
        for result in results:
            score = result.scores[group]
            micro[group].reference += score.reference
            micro[group].detected += score.detected
            micro[group].matched += score.matched
            if score.f1 is not None:
                f1s.append(score.f1)
        mean_f1[group] = round(float(np.mean(f1s)), 3) if f1s else None
    met = bool(results) and all((mean_f1[g] or 0.0) > CRITERION_F1 for g in CRITERION_GROUPS)
    return Summary(songs=len(results), micro=micro, mean_f1=mean_f1, criterion_met=met)


# ─── Formato ─────────────────────────────────────────────────────────────────


def _pct(value: float | None) -> str:
    return "  n/a" if value is None else f"{value * 100:5.1f}"


def format_scores(scores: dict[str, GroupScore]) -> str:
    lines = [f"{'grupo':<8} {'ref':>5} {'chart':>5} {'ok':>5} {'P %':>6} {'R %':>6} {'F1 %':>6}"]
    for group in GROUPS:
        s = scores[group]
        lines.append(
            f"{group:<8} {s.reference:>5} {s.detected:>5} {s.matched:>5} "
            f"{_pct(s.precision):>6} {_pct(s.recall):>6} {_pct(s.f1):>6}"
        )
    return "\n".join(lines)


def format_confusion(confusion: dict[str, dict[str, int]]) -> str:
    cols = (*GROUPS, NONE)
    lines = ["ref \\ chart " + " ".join(f"{c:>6}" for c in cols)]
    for row in cols:
        if row == NONE and not any(confusion[NONE].values()):
            continue
        lines.append(f"{row:<11} " + " ".join(f"{confusion[row][c]:>6}" for c in cols))
    return "\n".join(lines)
