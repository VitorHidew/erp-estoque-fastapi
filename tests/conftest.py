from __future__ import annotations

import os
from pathlib import Path

_db = Path(__file__).resolve().parent / "_pytest.sqlite"
try:
    if _db.exists():
        _db.unlink()
except OSError:
    pass
os.environ["DATABASE_URL"] = "sqlite:///" + str(_db.resolve()).replace("\\", "/")

