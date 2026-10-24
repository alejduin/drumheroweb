import pytest

from app.device import resolve_device


def test_cpu_explicit(monkeypatch):
    monkeypatch.setenv("DRUMHERO_DEVICE", "cpu")
    assert resolve_device() == "cpu"


def test_argument_overrides_env(monkeypatch):
    monkeypatch.setenv("DRUMHERO_DEVICE", "cuda")
    assert resolve_device("cpu") == "cpu"


def test_invalid_value():
    with pytest.raises(ValueError):
        resolve_device("tpu")


def test_cuda_falls_back_to_cpu_without_gpu():
    torch = pytest.importorskip("torch")
    if torch.cuda.is_available():
        pytest.skip("hay GPU")
    assert resolve_device("cuda") == "cpu"
    assert resolve_device("auto") == "cpu"
