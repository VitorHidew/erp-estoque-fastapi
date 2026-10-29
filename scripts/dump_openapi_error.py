"""Run from repo root: python scripts/dump_openapi_error.py"""
import traceback
from pathlib import Path

out = Path(__file__).resolve().parent.parent / "_openapi_debug.txt"
buf = []
try:
    from app.main import app

    app.openapi()
    buf.append("OK: openapi generated")
except Exception:
    buf.append(traceback.format_exc())
out.write_text("\n".join(buf), encoding="utf-8")

