from __future__ import annotations

import os

# Importa modelos para registrar no metadata do SQLModel
from sqlmodel import Session, SQLModel, create_engine

from . import models  # noqa: F401
from .sqlite_migrate import migrate_sqlite

DB_URL = os.getenv("DATABASE_URL", "sqlite:///./erp_estoque.sqlite")
engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    migrate_sqlite(engine)


def get_session():
    with Session(engine) as session:
        yield session

