"""Adiciona colunas em SQLite quando o arquivo já existe (evolução leve sem Alembic em runtime)."""

from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def _cols(engine: Engine, table: str) -> set[str]:
    insp = inspect(engine)
    try:
        return {c["name"] for c in insp.get_columns(table)}
    except Exception:
        return set()


def _add(engine: Engine, table: str, col: str, ddl: str) -> None:
    if col in _cols(engine, table):
        return
    with engine.connect() as conn:
        conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN {ddl}'))
        conn.commit()


def migrate_sqlite(engine: Engine) -> None:
    dialect = engine.dialect.name
    if dialect != "sqlite":
        return

    mapping = [
        ("product", "avg_cost_per_m3", "avg_cost_per_m3 FLOAT"),
        ("stockmovement", "warehouse_location_code", "warehouse_location_code VARCHAR"),
        ("stockmovement", "batch_lot", "batch_lot VARCHAR"),
        ("stockmovement", "confirmed_at", "confirmed_at DATETIME"),
        ("financialentry", "chart_account_id", "chart_account_id INTEGER"),
        ("financialentry", "cost_center_id", "cost_center_id INTEGER"),
        ("financialentry", "reconciled", "reconciled BOOLEAN DEFAULT 0"),
        ("financialentry", "reconcile_ref", "reconcile_ref VARCHAR"),
        ("salesorder", "party_id", "party_id INTEGER"),
        ("salesorder", "delivery_date", "delivery_date DATE"),
        ("salesorder", "discount_order_pct", 'discount_order_pct FLOAT DEFAULT 0'),
    ]

    for table, col, ddl in mapping:
        try:
            _add(engine, table, col, ddl)
        except Exception:
            continue

