"""Errores de la API con el formato `{ "error": { "code", "message" } }` (shared/openapi.yaml)."""

from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message}}


def not_found(what: str) -> ApiError:
    return ApiError(404, "NOT_FOUND", f"{what} no existe")
