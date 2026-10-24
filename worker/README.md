# Worker de análisis — DrumHero AI

Python 3.10 en Docker. Aísla la batería (Demucs `htdemucs`), detecta golpes por clase
(ADTOF Frame_RNN, port PyTorch) y estima la rejilla (beat_this `final0`).
Contratos: `../shared/chart-v2.schema.json` y `../shared/openapi.yaml`.

## Uso (desde `worker/`)

```bash
docker compose build poc                       # primera vez: ~10-20 min
docker compose run --rm poc health             # carga los 3 modelos (descarga pesos la 1.ª vez)
docker compose run --rm --entrypoint pytest poc -m "not models"   # tests rápidos
docker compose run --rm --entrypoint pytest poc                   # todos (incluye modelos)
docker compose run --rm --entrypoint ruff poc check . && docker compose run --rm --entrypoint ruff poc format --check .
```

- Los pesos de Demucs y beat_this se guardan en el volumen `models` (no se descargan otra vez).
- `app/`, `poc/` y `tests/` están montados: los cambios de código no requieren reconstruir.
- GPU (NVIDIA + CUDA en WSL):
  `docker compose build --build-arg TORCH_VARIANT=cu124 poc`
  y ejecutar con `DRUMHERO_DEVICE=cuda` (más `gpus: all` en el compose).

## Estructura

| Ruta | Contenido |
|------|-----------|
| `app/audio.py` | decode/encode con ffmpeg (float32 `[canales, muestras]`, 44.1 kHz) |
| `app/pipeline/separate.py` | Demucs → stems `drums` / `backing` |
| `app/pipeline/transcribe.py` | ADTOF → activaciones `[frames, 5]` a 100 fps |
| `app/pipeline/tempo.py` | beat_this → beats y downbeats en segundos |
| `poc/` | CLI del PoC (Fase A); `songs/` y `references/` son del usuario y no se versionan |

## Licencias de modelos

- **ADTOF** (pesos del port `adtof-pytorch`, commit `85c192e`): CC BY-NC-SA 4.0 — **uso no comercial**.
  Si el producto cobra, hay que reemplazar el modelo o licenciarlo.
- Demucs: MIT. beat_this: MIT.
