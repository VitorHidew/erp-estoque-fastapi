from __future__ import annotations

import os

from fastapi import Header, HTTPException

API_KEY_HEADER = "X-API-Key"


def require_api_key(x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER)) -> None:
    """
    Se ERP_API_KEY estiver definido (não vazio), todas as rotas que usam esta dependência
    exigem o mesmo valor no header X-API-Key.
    Se vazio ou ausente, desenvolvimento aberto.
    """
    expected = os.getenv("ERP_API_KEY", "").strip()
    if not expected:
        return
    if not x_api_key or x_api_key.strip() != expected:
        raise HTTPException(status_code=401, detail="API key inválida ou ausente")

