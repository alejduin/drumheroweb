import subprocess

import numpy as np
import pytest
import soundfile as sf

from app.audio import SAMPLE_RATE, AudioDecodeError, decode, encode_opus, probe_duration_s, to_mono
from tests.synth import make_groove


@pytest.fixture
def groove_wav(tmp_path):
    groove = make_groove(seconds=3.0)
    path = tmp_path / "groove.wav"
    sf.write(path, groove.mix.T, SAMPLE_RATE, subtype="FLOAT")
    return path, groove.mix


def test_decode_wav_roundtrip(groove_wav):
    path, original = groove_wav
    audio = decode(path)
    assert audio.dtype == np.float32
    assert audio.shape == original.shape
    np.testing.assert_allclose(audio, original, atol=1e-6)


def test_decode_resamples_and_upmixes(tmp_path):
    mono = (0.5 * np.sin(2 * np.pi * 440 * np.arange(22050) / 22050)).astype(np.float32)
    path = tmp_path / "mono22k.wav"
    sf.write(path, mono, 22050)
    audio = decode(path)
    assert audio.shape[0] == 2
    assert abs(audio.shape[1] - SAMPLE_RATE) <= 2  # 1 s
    np.testing.assert_allclose(audio[0], audio[1])


def test_decode_rejects_garbage(tmp_path):
    path = tmp_path / "fake.mp3"
    path.write_bytes(b"esto no es audio" * 100)
    with pytest.raises(AudioDecodeError):
        decode(path)


def test_probe_duration(groove_wav):
    path, original = groove_wav
    assert probe_duration_s(path) == pytest.approx(original.shape[1] / SAMPLE_RATE, abs=0.01)


def best_lag_samples(reference: np.ndarray, other: np.ndarray, max_lag: int = SAMPLE_RATE // 100) -> int:
    """Desfase (muestras) que maximiza la correlación de `other` contra `reference`."""
    a, b = to_mono(reference), to_mono(other)
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    lags = range(-max_lag, max_lag + 1)
    scores = [np.dot(a[max_lag:-max_lag], np.roll(b, -lag)[max_lag:-max_lag]) for lag in lags]
    return list(lags)[int(np.argmax(scores))]


def _encode_mp3(audio: np.ndarray, path) -> None:
    wav = path.with_suffix(".wav")
    sf.write(wav, audio.T, SAMPLE_RATE, subtype="FLOAT")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "192k", str(path)],
        check=True,
    )


def test_stems_from_mp3_align_with_original(tmp_path):
    """B4/D14: stems (Opus) de un MP3 quedan alineados ≤ 1 ms con el MP3 decodificado y con la fuente.

    El navegador reproduce el MP3 original (fallback) o los stems: ambos deben empezar en la
    misma muestra. ffmpeg recorta el encoder delay del MP3 con la cabecera LAME, como Chrome.
    """
    groove = make_groove(seconds=4.0)
    mp3 = tmp_path / "song.mp3"
    _encode_mp3(groove.mix, mp3)

    decoded = decode(mp3)
    # Duración: el MP3 no agrega silencio inicial (encoder delay recortado)
    assert abs(decoded.shape[1] - groove.mix.shape[1]) <= SAMPLE_RATE // 1000
    assert abs(best_lag_samples(groove.mix, decoded)) <= SAMPLE_RATE // 1000

    # Separación simulada como en separate.py: backing = mezcla − batería (residual)
    drums = groove.drums[:, : decoded.shape[1]]
    backing = decoded[:, : drums.shape[1]] - drums
    for name, stem in (("drums", drums), ("backing", backing)):
        stem_back = decode(encode_opus(stem, tmp_path / f"{name}.ogg"))
        lag = best_lag_samples(stem, stem_back)
        assert abs(lag) <= SAMPLE_RATE // 1000, f"{name}: desfase de {lag} muestras"

    # Batería + backing en Opus reconstruyen el MP3 sin desfase
    summed = (
        decode(tmp_path / "drums.ogg")[:, : drums.shape[1]]
        + decode(tmp_path / "backing.ogg")[:, : drums.shape[1]]
    )
    assert abs(best_lag_samples(decoded, summed)) <= SAMPLE_RATE // 1000


def test_opus_stem_stays_aligned(tmp_path, groove_wav):
    """D14: un stem en Opus decodificado debe quedar alineado (≤ 1 ms) y con la misma duración."""
    _path, original = groove_wav
    stem = encode_opus(original, tmp_path / "stem.ogg")
    decoded = decode(stem)

    assert abs(decoded.shape[1] - original.shape[1]) <= SAMPLE_RATE // 1000

    a, b = to_mono(original), to_mono(decoded)[: original.shape[1]]
    window = SAMPLE_RATE // 100  # buscar desfases de hasta ±10 ms
    lags = range(-window, window + 1)
    scores = [np.dot(a[window:-window], np.roll(b, -lag)[window:-window]) for lag in lags]
    best_lag = list(lags)[int(np.argmax(scores))]
    assert abs(best_lag) <= SAMPLE_RATE // 1000, f"desfase de {best_lag} muestras"
