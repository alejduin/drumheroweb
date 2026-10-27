"""Cliente mínimo de Supabase (PostgREST + Storage) con la clave secreta del worker.

Solo lo que usa el consumidor; con httpx para no sumar el SDK completo. Los filtros
van en sintaxis PostgREST: select("jobs", id="eq.123", status="in.(queued,done)").
"""

from __future__ import annotations

from typing import BinaryIO
from urllib.parse import quote

import httpx

CHUNK_BYTES = 1 << 20


class SupabaseError(RuntimeError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"Supabase {status}: {message}")
        self.status = status


class TooLargeError(RuntimeError):
    """La descarga superó el límite pedido."""


def _object_path(path: str) -> str:
    return quote(path, safe="/")


class SupabaseRest:
    def __init__(self, url: str, key: str, transport: httpx.BaseTransport | None = None) -> None:
        self._http = httpx.Client(
            base_url=url.rstrip("/"),
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            transport=transport,
            timeout=httpx.Timeout(60.0, connect=10.0),
        )

    def close(self) -> None:
        self._http.close()

    def _check(self, response: httpx.Response) -> httpx.Response:
        if response.status_code >= 400:
            response.read()
            raise SupabaseError(response.status_code, response.text[:300])
        return response

    # ─── PostgREST ───────────────────────────────────────────────────────────

    def rpc(self, function: str, params: dict) -> list[dict]:
        return self._check(self._http.post(f"/rest/v1/rpc/{function}", json=params)).json()

    def select(self, table: str, **filters: str) -> list[dict]:
        params = {"select": "*", **filters}
        return self._check(self._http.get(f"/rest/v1/{table}", params=params)).json()

    def select_one(self, table: str, **filters: str) -> dict | None:
        rows = self.select(table, **filters)
        return rows[0] if rows else None

    def update(self, table: str, values: dict, **filters: str) -> list[dict]:
        """Filas actualizadas (vacío si no había ninguna que cumpliera el filtro)."""
        response = self._http.patch(
            f"/rest/v1/{table}",
            params=filters,
            json=values,
            headers={"Prefer": "return=representation"},
        )
        return self._check(response).json()

    def upsert(self, table: str, row: dict, on_conflict: str) -> None:
        response = self._http.post(
            f"/rest/v1/{table}",
            params={"on_conflict": on_conflict},
            json=row,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        self._check(response)

    def delete(self, table: str, **filters: str) -> None:
        self._check(self._http.delete(f"/rest/v1/{table}", params=filters))

    # ─── Storage ─────────────────────────────────────────────────────────────

    def download(self, bucket: str, path: str, out: BinaryIO, max_bytes: int) -> int:
        """Escribe el objeto en `out` cortando al pasar `max_bytes`. Retorna los bytes leídos."""
        size = 0
        with self._http.stream("GET", f"/storage/v1/object/{bucket}/{_object_path(path)}") as response:
            self._check(response)
            for chunk in response.iter_bytes(CHUNK_BYTES):
                size += len(chunk)
                if size > max_bytes:
                    raise TooLargeError()
                out.write(chunk)
        return size

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        response = self._http.post(
            f"/storage/v1/object/{bucket}/{_object_path(path)}",
            content=data,
            headers={"Content-Type": content_type, "x-upsert": "true"},
        )
        self._check(response)

    def copy(self, bucket: str, source: str, destination: str) -> None:
        """Copia dentro del bucket; reemplaza el destino si ya existía."""
        self.remove(bucket, [destination])
        response = self._http.post(
            "/storage/v1/object/copy",
            json={"bucketId": bucket, "sourceKey": source, "destinationKey": destination},
        )
        self._check(response)

    def remove(self, bucket: str, paths: list[str]) -> None:
        response = self._http.request("DELETE", f"/storage/v1/object/{bucket}", json={"prefixes": paths})
        self._check(response)
