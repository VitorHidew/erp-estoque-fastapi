from __future__ import annotations

import csv
import io
import logging
import os
import shutil
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field as PField
from sqlmodel import Session, delete, select

from .db import engine, get_session, init_db
from .models import (
    AuditLog,
    ChartAccount,
    CostCenter,
    FinancialEntry,
    FinancialEntryCreate,
    FinancialEntryType,
    FinancialStatus,
    InventoryCount,
    OrderLineIn,
    OrderStatus,
    OrderType,
    Party,
    PartyCreate,
    PartyKind,
    PartyUpdate,
    Product,
    ProductCategory,
    ProductCreate,
    ProductUpdate,
    SalesOrder,
    SalesOrderCreatePayload,
    SalesOrderLine,
    StockMovement,
    StockMovementCreate,
    StockMovementType,
    WarehouseLocation,
    WarehouseLocationCreate,
)
from .seed_bulk import bulk_seed
from .security import API_KEY_HEADER

ADMIN_NAME = "Administrador"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("ERP")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
app = FastAPI(title="Empresa Exemplo ERP API", version="0.2.0")


class AuditLogOut(BaseModel):
    """Resposta estável para OpenAPI (evita `List[Dict[str, Any]]`)."""

    id: int
    entity: str
    entity_id: Optional[str] = None
    action: str
    user_name: Optional[str] = None
    details: Optional[str] = None
    created_at: str


class InventoryCountLineIn(BaseModel):
    product_sku: str
    qty_counted: float
    notes: Optional[str] = None


@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    expected = os.getenv("ERP_API_KEY", "").strip()
    path = request.url.path
    if expected and path.startswith("/api"):
        bypass = (
            path == "/api/auth/status"
            or path.startswith("/docs")
            or path.startswith("/openapi.json")
            or path.startswith("/redoc")
        )
        if bypass:
            return await call_next(request)
        if request.headers.get(API_KEY_HEADER) != expected:
            log.warning("api_blocked missing_key path=%s", path)
            return JSONResponse({"detail": "API key ausente ou inválida"}, status_code=401)
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errs = exc.errors()
    msg = errs[0].get("msg", "Validação falhou") if errs else "Validação falhou"
    log.info("validation_error url=%s err=%s", request.url.path, errs)
    return JSONResponse({"detail": msg, "errors": errs}, status_code=422)


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
def _startup():
    init_db()
    with Session(engine) as session:
        existing = session.exec(select(Product).limit(1)).first()
        if existing:
            return
        bulk_seed(session)
        write_audit(session, entity="system", action="startup_seed", details="Base com volume de demonstração criada")
        session.commit()


def write_audit(
    session: Session,
    *,
    entity: str,
    action: str,
    entity_id: str | None = None,
    details: str | None = None,
) -> None:
    session.add(
        AuditLog(
            entity=entity,
            entity_id=entity_id,
            action=action,
            user_id=None,
            user_name=ADMIN_NAME,
            details=details,
        )
    )


def _line_subtotal(ln: OrderLineIn) -> float:
    d = max(0.0, min(100.0, float(ln.discount_line_pct)))
    return float(ln.volume_m3) * float(ln.unit_price) * (1 - d / 100.0)


def _order_total(lines: List[OrderLineIn], discount_order_pct: float) -> float:
    if not lines:
        return 0.0
    sub = sum(_line_subtotal(ln) for ln in lines)
    d = max(0.0, min(100.0, float(discount_order_pct)))
    return round(sub * (1 - d / 100.0), 2)


def _order_lines_from_db(session: Session, order_id: int) -> List[SalesOrderLine]:
    return list(session.exec(select(SalesOrderLine).where(SalesOrderLine.order_id == order_id)).all())


def _enum_val(v):
    return v.value if hasattr(v, "value") else v


def serialize_order(session: Session, order: SalesOrder) -> Dict[str, Any]:
    lines = _order_lines_from_db(session, order.id)
    lines_out = [
        {
            "id": ln.id,
            "product_sku": ln.product_sku,
            "volume_m3": ln.volume_m3,
            "unit_price": ln.unit_price,
            "discount_line_pct": ln.discount_line_pct,
            "line_total": round(_line_subtotal(OrderLineIn(
                product_sku=ln.product_sku,
                volume_m3=ln.volume_m3,
                unit_price=ln.unit_price,
                discount_line_pct=ln.discount_line_pct,
            )), 2),
        }
        for ln in lines
    ]
    return {
        "id": order.id,
        "order_code": order.order_code,
        "order_date": order.order_date.isoformat(),
        "order_type": _enum_val(order.order_type),
        "status": _enum_val(order.status),
        "party_name": order.party_name,
        "party_id": order.party_id,
        "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
        "discount_order_pct": order.discount_order_pct,
        "notes": order.notes,
        "product_sku": order.product_sku,
        "volume_m3": order.volume_m3,
        "unit_price": order.unit_price,
        "total_value": order.total_value,
        "lines": lines_out,
    }


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/auth/status")
def auth_status():
    required = bool(os.getenv("ERP_API_KEY", "").strip())
    return {"api_key_required": required, "header": API_KEY_HEADER}


@app.get("/api/products")
def list_products(
    q: str | None = None,
    category: ProductCategory | None = None,
    stock_status: str | None = Query(default=None, pattern="^(critical|warning|normal)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    session: Session = Depends(get_session),
):
    items = session.exec(select(Product).order_by(Product.sku)).all()
    if q:
        q_low = q.lower()
        items = [i for i in items if q_low in (i.sku or "").lower() or q_low in (i.name or "").lower()]
    if category:
        items = [i for i in items if i.category == category]
    if stock_status:

        def _status(p: Product) -> str:
            qty = float(p.qty_m3 or 0)
            min_s = float(p.min_stock_m3 or 0)
            if min_s > 0 and qty < min_s:
                return "critical"
            if min_s > 0 and qty < min_s * 1.3:
                return "warning"
            return "normal"

        items = [i for i in items if _status(i) == stock_status]
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    return {"items": items[start:end], "total": total, "page": page, "page_size": page_size}


@app.post("/api/products", response_model=Product)
def create_product(payload: ProductCreate, session: Session = Depends(get_session)):
    exists = session.exec(select(Product).where(Product.sku == payload.sku)).first()
    if exists:
        raise HTTPException(status_code=409, detail="SKU já existe")
    data = payload.model_dump()
    if data.get("avg_cost_per_m3") is None and data.get("cost_per_m3") is not None:
        data["avg_cost_per_m3"] = data["cost_per_m3"]
    prod = Product(**data)
    session.add(prod)
    write_audit(session, entity="product", action="create", entity_id=payload.sku, details=f"Produto criado: {payload.name}")
    session.commit()
    session.refresh(prod)
    return prod


@app.put("/api/products/{product_id}", response_model=Product)
def update_product(product_id: int, payload: ProductUpdate, session: Session = Depends(get_session)):
    prod = session.get(Product, product_id)
    if not prod:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(prod, k, v)
    prod.updated_at = datetime.utcnow()
    session.add(prod)
    write_audit(session, entity="product", action="update", entity_id=str(prod.id), details="Atualização de produto")
    session.commit()
    session.refresh(prod)
    return prod


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, session: Session = Depends(get_session)):
    prod = session.get(Product, product_id)
    if not prod:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    write_audit(session, entity="product", action="delete", entity_id=str(prod.id), details=f"SKU removido: {prod.sku}")
    session.delete(prod)
    session.commit()
    return {"ok": True}


def _apply_avg_cost(prod: Product, vol_in: float, unit_cost: float | None) -> None:
    if unit_cost is None or vol_in <= 0:
        return
    cur_qty = float(prod.qty_m3 or 0)
    old_avg = float(prod.avg_cost_per_m3 or prod.cost_per_m3 or unit_cost)
    new_qty = cur_qty + vol_in
    if new_qty <= 0:
        return
    prod.avg_cost_per_m3 = round((cur_qty * old_avg + vol_in * unit_cost) / new_qty, 4)


@app.get("/api/movements")
def list_movements(
    q: str | None = None,
    movement_type: StockMovementType | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    session: Session = Depends(get_session),
):
    items = session.exec(select(StockMovement).order_by(StockMovement.id.desc())).all()
    if movement_type:
        items = [m for m in items if m.movement_type == movement_type]
    if start_date:
        items = [m for m in items if m.movement_date >= start_date]
    if end_date:
        items = [m for m in items if m.movement_date <= end_date]
    if q:
        q_low = q.lower()
        items = [m for m in items if q_low in (m.product_sku or "").lower()
                 or q_low in (m.party_name or "").lower()
                 or q_low in (m.document_no or "").lower()
                 or q_low in (m.nf_no or "").lower()]
    total = len(items)
    start = (page - 1) * page_size
    return JSONResponse(content=jsonable_encoder({
        "items": items[start:start + page_size],
        "total": total,
        "page": page,
        "page_size": page_size,
    }))


@app.post("/api/movements", response_model=StockMovement)
def create_movement(payload: StockMovementCreate, session: Session = Depends(get_session)):
    if payload.volume_m3 <= 0 and payload.movement_type != StockMovementType.ajuste:
        raise HTTPException(status_code=400, detail="Volume deve ser maior que zero")
    mv = StockMovement(**payload.model_dump())
    if mv.total_value is None and mv.unit_value is not None and mv.movement_type != StockMovementType.ajuste:
        mv.total_value = mv.unit_value * abs(mv.volume_m3)
    prod = session.exec(select(Product).where(Product.sku == mv.product_sku)).first()
    if prod:
        current = float(prod.qty_m3 or 0)
        if mv.movement_type == StockMovementType.saida:
            if (current - mv.volume_m3) < 0:
                raise HTTPException(status_code=400, detail="Saída geraria estoque negativo")
            prod.qty_m3 = current - mv.volume_m3
        elif mv.movement_type == StockMovementType.entrada:
            _apply_avg_cost(prod, mv.volume_m3, mv.unit_value)
            prod.qty_m3 = current + mv.volume_m3
        else:
            prod.qty_m3 = current + mv.volume_m3
        prod.updated_at = datetime.utcnow()
        session.add(prod)
    session.add(mv)
    write_audit(session, entity="movement", action="create", entity_id=payload.product_sku, details=f"{payload.movement_type} {payload.volume_m3} m³")
    session.commit()
    session.refresh(mv)
    return mv


@app.post("/api/movements/{movement_id}/confirm")
def confirm_movement(movement_id: int, session: Session = Depends(get_session)):
    mv = session.get(StockMovement, movement_id)
    if not mv:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
    mv.confirmed_at = datetime.utcnow()
    session.add(mv)
    write_audit(session, entity="movement", action="confirm_receipt", entity_id=str(mv.id), details=mv.document_no)
    session.commit()
    return {"ok": True}


@app.post("/api/dev/load-mock")
def reload_mock_data(session: Session = Depends(get_session)):
    session.exec(delete(SalesOrderLine))
    session.exec(delete(SalesOrder))
    session.exec(delete(InventoryCount))
    session.exec(delete(StockMovement))
    session.exec(delete(FinancialEntry))
    session.exec(delete(Product))
    session.exec(delete(Party))
    session.exec(delete(WarehouseLocation))
    session.exec(delete(CostCenter))
    session.exec(delete(ChartAccount))
    bulk_seed(session)
    write_audit(session, entity="system", action="load_mock", details="Base mock em volume recarregada")
    session.commit()
    products_count = len(session.exec(select(Product)).all())
    movements_count = len(session.exec(select(StockMovement)).all())
    financial_count = len(session.exec(select(FinancialEntry)).all())
    orders_count = len(session.exec(select(SalesOrder)).all())
    return {"ok": True, "products": products_count, "movements": movements_count, "financial_entries": financial_count, "orders": orders_count}


@app.get("/api/audit", response_model=List[AuditLogOut])
def list_audit_logs(limit: int = Query(default=50, ge=1, le=200), session: Session = Depends(get_session)):
    logs = session.exec(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)).all()
    return [
        AuditLogOut(
            id=l.id,
            entity=l.entity,
            entity_id=l.entity_id,
            action=l.action,
            user_name=l.user_name,
            details=l.details,
            created_at=l.created_at.isoformat(),
        )
        for l in logs
    ]


@app.get("/api/parties")
def list_parties(kind: PartyKind | None = None, q: str | None = None, session: Session = Depends(get_session)):
    items = session.exec(select(Party).order_by(Party.name)).all()
    if kind:
        items = [p for p in items if p.kind == kind]
    if q:
        ql = q.lower()
        items = [p for p in items if ql in p.name.lower() or (p.document or "").lower().find(ql) >= 0]
    return items


@app.post("/api/parties", response_model=Party)
def create_party(payload: PartyCreate, session: Session = Depends(get_session)):
    p = Party(**payload.model_dump())
    session.add(p)
    write_audit(session, entity="party", action="create", details=p.name)
    session.commit()
    session.refresh(p)
    return p


@app.put("/api/parties/{party_id}", response_model=Party)
def update_party(party_id: int, payload: PartyUpdate, session: Session = Depends(get_session)):
    p = session.get(Party, party_id)
    if not p:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    session.add(p)
    write_audit(session, entity="party", action="update", entity_id=str(p.id), details=p.name)
    session.commit()
    session.refresh(p)
    return p


@app.delete("/api/parties/{party_id}")
def delete_party(party_id: int, session: Session = Depends(get_session)):
    p = session.get(Party, party_id)
    if not p:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado")
    session.delete(p)
    write_audit(session, entity="party", action="delete", entity_id=str(party_id))
    session.commit()
    return {"ok": True}


@app.get("/api/warehouses", response_model=List[WarehouseLocation])
def list_warehouses(session: Session = Depends(get_session)):
    return session.exec(select(WarehouseLocation).order_by(WarehouseLocation.code)).all()


@app.post("/api/warehouses", response_model=WarehouseLocation)
def create_warehouse(payload: WarehouseLocationCreate, session: Session = Depends(get_session)):
    w = WarehouseLocation(**payload.model_dump())
    session.add(w)
    session.commit()
    session.refresh(w)
    return w


@app.get("/api/finance/chart-accounts")
def list_chart_accounts(session: Session = Depends(get_session)):
    return session.exec(select(ChartAccount).order_by(ChartAccount.code)).all()


@app.get("/api/finance/cost-centers")
def list_cost_centers(session: Session = Depends(get_session)):
    return session.exec(select(CostCenter).order_by(CostCenter.code)).all()


def _finance_entries_filtered(
    session: Session,
    entry_type: FinancialEntryType | None = None,
    status: FinancialStatus | None = None,
    reconciled: bool | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    q: str | None = None,
) -> List[FinancialEntry]:
    entries = session.exec(select(FinancialEntry).order_by(FinancialEntry.due_date)).all()
    today = date.today()
    dirty = False
    for entry in entries:
        if entry.status == FinancialStatus.aberto and entry.due_date < today:
            entry.status = FinancialStatus.vencido
            entry.updated_at = datetime.utcnow()
            session.add(entry)
            dirty = True
    if dirty:
        session.commit()
        entries = session.exec(select(FinancialEntry).order_by(FinancialEntry.due_date)).all()

    if entry_type:
        entries = [e for e in entries if e.entry_type == entry_type]
    if status:
        entries = [e for e in entries if e.status == status]
    if reconciled is not None:
        entries = [e for e in entries if bool(e.reconciled) == reconciled]
    if start_date:
        entries = [e for e in entries if e.due_date >= start_date]
    if end_date:
        entries = [e for e in entries if e.due_date <= end_date]
    if q:
        q_low = q.lower()
        entries = [
            e
            for e in entries
            if q_low in (e.description or "").lower()
            or q_low in (e.party_name or "").lower()
            or q_low in (e.category or "").lower()
            or q_low in (e.reconcile_ref or "").lower()
        ]
    return entries


@app.get("/api/finance/entries")
def list_financial_entries(
    entry_type: FinancialEntryType | None = None,
    status: FinancialStatus | None = None,
    reconciled: bool | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    q: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    session: Session = Depends(get_session),
):
    entries = _finance_entries_filtered(
        session,
        entry_type=entry_type,
        status=status,
        reconciled=reconciled,
        start_date=start_date,
        end_date=end_date,
        q=q,
    )
    total = len(entries)
    start = (page - 1) * page_size
    page_items = entries[start : start + page_size]
    # JSONResponse: incluir ORM em `dict` quebra a geração do OpenAPI (refs / tabela SQLModel).
    payload = {"items": page_items, "total": total, "page": page, "page_size": page_size}
    return JSONResponse(content=jsonable_encoder(payload))


@app.get("/api/finance/cashflow")
def finance_cashflow(
    granularity: str = Query(default="day", pattern="^(day|week)$"),
    session: Session = Depends(get_session),
):
    entries = session.exec(select(FinancialEntry)).all()
    paid = [e for e in entries if e.status == FinancialStatus.pago and e.paid_at]
    buckets: Dict[str, Dict[str, float]] = {}

    def key_for(dt: datetime) -> str:
        d = dt.date()
        if granularity == "week":
            iso = d.isocalendar()
            return f"{d.isocalendar().year}-W{iso.week:02d}"
        return d.isoformat()

    for e in paid:
        pa = e.paid_at
        if not pa:
            continue
        k = key_for(pa)
        if k not in buckets:
            buckets[k] = {"entrada": 0.0, "saida": 0.0}
        if e.entry_type == FinancialEntryType.receber:
            buckets[k]["entrada"] += float(e.amount)
        else:
            buckets[k]["saida"] += float(e.amount)
    series = [{"period": bk, **vals, "liquido": vals["entrada"] - vals["saida"]} for bk, vals in sorted(buckets.items())]
    return {"granularity": granularity, "series": series}


@app.post("/api/finance/entries", response_model=FinancialEntry)
def create_financial_entry(payload: FinancialEntryCreate, session: Session = Depends(get_session)):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Valor deve ser maior que zero")
    entry = FinancialEntry(**payload.model_dump())
    session.add(entry)
    write_audit(session, entity="finance", action="create_entry", details=f"{payload.description} - R$ {payload.amount}")
    session.commit()
    session.refresh(entry)
    return entry


@app.post("/api/finance/entries/{entry_id}/pay", response_model=FinancialEntry)
def pay_financial_entry(entry_id: int, session: Session = Depends(get_session)):
    entry = session.get(FinancialEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    if entry.status != FinancialStatus.pago:
        entry.status = FinancialStatus.pago
        entry.paid_at = datetime.utcnow()
        entry.updated_at = datetime.utcnow()
        session.add(entry)
        write_audit(session, entity="finance", action="pay_entry", entity_id=str(entry.id), details=f"Baixa financeira: {entry.description}")
        session.commit()
        session.refresh(entry)
    return entry


class BatchReconcileIn(BaseModel):
    entry_ids: List[int] = PField(default_factory=list)
    ref: str = "LOTE"


class ReconcileRefIn(BaseModel):
    ref: str


@app.post("/api/finance/entries/{entry_id}/reconcile")
def reconcile_entry(entry_id: int, body: ReconcileRefIn, session: Session = Depends(get_session)):
    entry = session.get(FinancialEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    entry.reconciled = True
    entry.reconcile_ref = body.ref
    entry.updated_at = datetime.utcnow()
    session.add(entry)
    session.commit()
    return {"ok": True}


@app.post("/api/finance/entries/batch-reconcile")
def batch_reconcile(body: BatchReconcileIn, session: Session = Depends(get_session)):
    n = 0
    for eid in body.entry_ids:
        e = session.get(FinancialEntry, eid)
        if not e:
            continue
        e.reconciled = True
        e.reconcile_ref = body.ref
        e.updated_at = datetime.utcnow()
        session.add(e)
        n += 1
    if n:
        session.commit()
    return {"ok": True, "updated": n}


@app.get("/api/finance/summary")
def finance_summary(session: Session = Depends(get_session)):
    entries = session.exec(select(FinancialEntry)).all()
    today = date.today()
    overdue_entries = [e for e in entries if e.status != FinancialStatus.pago and e.due_date < today]
    pagar_aberto = sum(e.amount for e in entries if e.entry_type == FinancialEntryType.pagar and e.status != FinancialStatus.pago)
    receber_aberto = sum(e.amount for e in entries if e.entry_type == FinancialEntryType.receber and e.status != FinancialStatus.pago)
    pago_mes = sum(
        e.amount
        for e in entries
        if e.status == FinancialStatus.pago and e.paid_at and e.paid_at.month == datetime.utcnow().month
    )
    aging = {"0_30": 0.0, "31_60": 0.0, "61_plus": 0.0}
    for e in overdue_entries:
        days = (today - e.due_date).days
        if days <= 30:
            aging["0_30"] += e.amount
        elif days <= 60:
            aging["31_60"] += e.amount
        else:
            aging["61_plus"] += e.amount
    return {
        "pagar_aberto": pagar_aberto,
        "receber_aberto": receber_aberto,
        "pago_mes": pago_mes,
        "saldo_projetado": receber_aberto - pagar_aberto,
        "inadimplencia_total": sum(e.amount for e in overdue_entries),
        "inadimplencia_qtd": len(overdue_entries),
        "aging": aging,
    }


@app.post("/api/finance/entries/batch-pay")
def batch_pay_financial_entries(
    entry_ids: Optional[List[int]] = Body(default=None),
    session: Session = Depends(get_session),
):
    entry_ids = entry_ids or []
    if not entry_ids:
        return {"ok": True, "updated": 0}
    updated = 0
    for entry_id in entry_ids:
        entry = session.get(FinancialEntry, entry_id)
        if not entry or entry.status == FinancialStatus.pago:
            continue
        entry.status = FinancialStatus.pago
        entry.paid_at = datetime.utcnow()
        entry.updated_at = datetime.utcnow()
        session.add(entry)
        updated += 1
    if updated:
        write_audit(session, entity="finance", action="batch_pay", details=f"Baixas em lote: {updated}")
        session.commit()
    return {"ok": True, "updated": updated}


@app.get("/api/finance/export.csv", response_class=PlainTextResponse)
def export_financial_csv(
    entry_type: FinancialEntryType | None = None,
    status: FinancialStatus | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    q: str | None = None,
    session: Session = Depends(get_session),
):
    entries = _finance_entries_filtered(
        session,
        entry_type=entry_type,
        status=status,
        reconciled=None,
        start_date=start_date,
        end_date=end_date,
        q=q,
    )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["tipo", "vencimento", "descricao", "parte", "categoria", "valor", "status", "pago_em", "conta_id", "cc_id", "conciliado", "ref_conciliacao"])
    for e in entries:
        writer.writerow([
            e.entry_type,
            e.due_date.isoformat(),
            e.description,
            e.party_name or "",
            e.category or "",
            f"{e.amount:.2f}",
            e.status,
            e.paid_at.isoformat() if e.paid_at else "",
            e.chart_account_id or "",
            e.cost_center_id or "",
            "1" if e.reconciled else "0",
            e.reconcile_ref or "",
        ])
    return output.getvalue()


@app.get("/api/products/export.csv", response_class=PlainTextResponse)
def export_products_csv(session: Session = Depends(get_session)):
    items = session.exec(select(Product).order_by(Product.sku)).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["sku", "nome", "categoria", "densidade", "qty_m3", "custo_medio", "preco_venda", "estoque_min"])
    for p in items:
        w.writerow([
            p.sku,
            p.name,
            p.category,
            p.density_kg_m3 or "",
            f"{p.qty_m3 or 0:.3f}",
            f"{p.avg_cost_per_m3 or p.cost_per_m3 or 0:.2f}",
            f"{p.sell_price_per_m3 or 0:.2f}",
            f"{p.min_stock_m3 or 0:.2f}",
        ])
    return buf.getvalue()


@app.put("/api/finance/entries/{entry_id}", response_model=FinancialEntry)
def update_financial_entry(entry_id: int, payload: FinancialEntryCreate, session: Session = Depends(get_session)):
    entry = session.get(FinancialEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(entry, k, v)
    entry.updated_at = datetime.utcnow()
    session.add(entry)
    write_audit(session, entity="finance", action="update_entry", entity_id=str(entry_id), details=payload.description)
    session.commit()
    session.refresh(entry)
    return entry


@app.delete("/api/finance/entries/{entry_id}")
def delete_financial_entry(entry_id: int, session: Session = Depends(get_session)):
    entry = session.get(FinancialEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    write_audit(session, entity="finance", action="delete_entry", entity_id=str(entry_id), details=entry.description)
    session.delete(entry)
    session.commit()
    return {"ok": True}


@app.get("/api/reports/stock-critical")
def report_stock_critical(session: Session = Depends(get_session)):
    products = session.exec(select(Product)).all()
    critical, warning, normal = [], [], []
    for p in products:
        qty = float(p.qty_m3 or 0)
        min_s = float(p.min_stock_m3 or 0)
        value = round(qty * float(p.avg_cost_per_m3 or p.cost_per_m3 or 0), 2)
        item = {
            "sku": p.sku, "name": p.name, "category": str(p.category),
            "qty_m3": qty, "min_stock_m3": min_s, "stock_value": value,
            "sell_price_per_m3": float(p.sell_price_per_m3 or 0),
        }
        if min_s > 0 and qty < min_s:
            critical.append(item)
        elif min_s > 0 and qty < min_s * 1.3:
            warning.append(item)
        else:
            normal.append(item)
    total_value = sum(float(p.qty_m3 or 0) * float(p.avg_cost_per_m3 or p.cost_per_m3 or 0) for p in products)
    return {
        "critical": critical,
        "warning": warning,
        "normal_count": len(normal),
        "total_products": len(products),
        "total_stock_value": round(total_value, 2),
    }


@app.get("/api/reports/sales-summary")
def report_sales_summary(session: Session = Depends(get_session)):
    orders = session.exec(select(SalesOrder)).all()
    sales = [o for o in orders if str(o.order_type) in ("Venda", "OrderType.venda")]
    purchases = [o for o in orders if str(o.order_type) in ("Compra", "OrderType.compra")]
    faturado_sales = [o for o in sales if str(o.status) in ("Faturado", "OrderStatus.faturado")]
    faturado_purchases = [o for o in purchases if str(o.status) in ("Faturado", "OrderStatus.faturado")]
    # Top customers
    from collections import Counter
    customer_totals: dict = {}
    for o in faturado_sales:
        k = o.party_name or "—"
        customer_totals[k] = customer_totals.get(k, 0) + float(o.total_value or 0)
    top_customers = sorted(customer_totals.items(), key=lambda x: x[1], reverse=True)[:5]
    return {
        "total_orders": len(orders),
        "sales_count": len(sales),
        "purchases_count": len(purchases),
        "faturado_sales_value": round(sum(float(o.total_value or 0) for o in faturado_sales), 2),
        "faturado_purchases_value": round(sum(float(o.total_value or 0) for o in faturado_purchases), 2),
        "pending_count": len([o for o in orders if str(o.status) in ("Rascunho", "Aprovado", "OrderStatus.rascunho", "OrderStatus.aprovado")]),
        "top_customers": [{"name": n, "total": round(v, 2)} for n, v in top_customers],
    }



@app.get("/api/system/health")
def system_health(session: Session = Depends(get_session)):
    products = len(session.exec(select(Product)).all())
    movements = len(session.exec(select(StockMovement)).all())
    finances = len(session.exec(select(FinancialEntry)).all())
    parties = len(session.exec(select(Party)).all())
    return {"ok": True, "products": products, "movements": movements, "financial_entries": finances, "parties": parties}


@app.post("/api/system/backup")
def create_backup():
    db_file = Path("erp_estoque.sqlite")
    backup_dir = Path("backups")
    backup_dir.mkdir(exist_ok=True)
    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    backup_target = backup_dir / f"erp_estoque-{ts}.sqlite"
    if db_file.exists():
        shutil.copy2(db_file, backup_target)
        return {"ok": True, "file": str(backup_target), "backup_path": str(backup_target)}
    return {"ok": False, "detail": "Banco não encontrado para backup"}


def _orders_filtered(
    session: Session,
    status: OrderStatus | None = None,
    order_type: OrderType | None = None,
) -> List[SalesOrder]:
    orders = session.exec(select(SalesOrder).order_by(SalesOrder.id.desc())).all()
    if status:
        orders = [o for o in orders if o.status == status]
    if order_type:
        orders = [o for o in orders if o.order_type == order_type]
    return orders


@app.post("/api/orders/{order_id}/cancel")
def cancel_order(order_id: int, session: Session = Depends(get_session)):
    order = session.get(SalesOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if order.status == OrderStatus.faturado:
        raise HTTPException(status_code=400, detail="Pedido faturado não pode ser cancelado")
    order.status = OrderStatus.cancelado
    order.updated_at = datetime.utcnow()
    session.add(order)
    write_audit(session, entity="order", action="cancel", entity_id=str(order_id), details=order.order_code)
    session.commit()
    return {"ok": True}


@app.put("/api/orders/{order_id}")
def update_order(order_id: int, payload: SalesOrderCreatePayload, session: Session = Depends(get_session)):
    order = session.get(SalesOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if order.status not in (OrderStatus.rascunho, OrderStatus.aprovado):
        raise HTTPException(status_code=400, detail="Apenas rascunhos e aprovados podem ser editados")
    lines_in: List[OrderLineIn] = [OrderLineIn(**ln.model_dump()) for ln in payload.lines]
    total = _order_total(lines_in, float(payload.discount_order_pct or 0))
    order.order_code = payload.order_code
    order.order_date = payload.order_date
    order.order_type = payload.order_type
    order.status = payload.status
    order.party_name = payload.party_name
    order.party_id = payload.party_id
    order.delivery_date = payload.delivery_date
    order.discount_order_pct = payload.discount_order_pct
    order.notes = payload.notes
    order.total_value = total
    order.updated_at = datetime.utcnow()
    session.exec(delete(SalesOrderLine).where(SalesOrderLine.order_id == order_id))
    for ln in lines_in:
        session.add(SalesOrderLine(
            order_id=order_id,
            product_sku=ln.product_sku,
            volume_m3=ln.volume_m3,
            unit_price=ln.unit_price,
            discount_line_pct=float(ln.discount_line_pct or 0),
        ))
    write_audit(session, entity="order", action="update", entity_id=str(order_id), details=order.order_code)
    session.commit()
    session.refresh(order)
    return JSONResponse(content=jsonable_encoder(serialize_order(session, order)))


@app.get("/api/search")
def global_search(q: str = Query(min_length=2), session: Session = Depends(get_session)):
    ql = q.lower()
    results: List[Dict[str, Any]] = []
    for p in session.exec(select(Product)).all():
        if ql in (p.sku or "").lower() or ql in (p.name or "").lower():
            results.append({"type": "produto", "id": p.id, "label": f"{p.sku} — {p.name}", "tab": "estoque"})
    for p in session.exec(select(Party)).all():
        if ql in p.name.lower() or ql in (p.document or "").lower():
            results.append({"type": "cadastro", "id": p.id, "label": p.name, "tab": "cadastros"})
    for o in session.exec(select(SalesOrder)).all():
        if ql in (o.order_code or "").lower() or ql in (o.party_name or "").lower():
            results.append({"type": "pedido", "id": o.id, "label": f"{o.order_code} — {o.party_name}", "tab": "pedidos"})
    for e in session.exec(select(FinancialEntry)).all():
        if ql in (e.description or "").lower() or ql in (e.party_name or "").lower():
            results.append({"type": "financeiro", "id": e.id, "label": e.description, "tab": "financeiro"})
    return {"q": q, "results": results[:40]}


@app.get("/api/reports/export.csv", response_class=PlainTextResponse)
def export_reports_csv(session: Session = Depends(get_session)):
    products = session.exec(select(Product)).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["=== ESTOQUE CRÍTICO ==="])
    w.writerow(["sku", "nome", "categoria", "qty_m3", "min_stock_m3", "valor_estoque", "status"])
    for p in products:
        qty = float(p.qty_m3 or 0)
        min_s = float(p.min_stock_m3 or 0)
        val = round(qty * float(p.avg_cost_per_m3 or p.cost_per_m3 or 0), 2)
        if min_s > 0 and qty < min_s * 1.3:
            st = "critico" if qty < min_s else "atencao"
            w.writerow([p.sku, p.name, p.category, f"{qty:.3f}", f"{min_s:.3f}", f"{val:.2f}", st])
    w.writerow([])
    orders = session.exec(select(SalesOrder)).all()
    faturados = [o for o in orders if str(o.status) in ("Faturado", "OrderStatus.faturado")]
    from collections import Counter
    customer_totals: dict = {}
    for o in faturados:
        k = o.party_name or "—"
        customer_totals[k] = customer_totals.get(k, 0) + float(o.total_value or 0)
    w.writerow(["=== TOP CLIENTES ==="])
    w.writerow(["cliente", "total_faturado"])
    for name, total in sorted(customer_totals.items(), key=lambda x: x[1], reverse=True):
        w.writerow([name, f"{total:.2f}"])
    return buf.getvalue()




@app.get("/api/orders")
def list_orders(
    status: OrderStatus | None = None,
    order_type: OrderType | None = None,
    q: str | None = None,
    sort_by: str = Query(default="order_date", pattern="^(order_code|order_date|total_value|party_name|status)$"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    session: Session = Depends(get_session),
):
    orders = _orders_filtered(session, status=status, order_type=order_type)
    if q:
        ql = q.lower()
        orders = [o for o in orders if ql in (o.order_code or "").lower() or ql in (o.party_name or "").lower()]
    rev = sort_dir == "desc"
    if sort_by == "order_code":
        orders = sorted(orders, key=lambda o: o.order_code or "", reverse=rev)
    elif sort_by == "total_value":
        orders = sorted(orders, key=lambda o: float(o.total_value or 0), reverse=rev)
    elif sort_by == "party_name":
        orders = sorted(orders, key=lambda o: o.party_name or "", reverse=rev)
    elif sort_by == "status":
        orders = sorted(orders, key=lambda o: str(o.status), reverse=rev)
    else:
        orders = sorted(orders, key=lambda o: str(o.order_date), reverse=rev)
    total = len(orders)
    start = (page - 1) * page_size
    slice_orders = orders[start : start + page_size]
    payload = {
        "items": [serialize_order(session, o) for o in slice_orders],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return JSONResponse(content=jsonable_encoder(payload))


@app.get("/api/orders/draft-ids")
def list_draft_order_ids(
    order_type: OrderType | None = None,
    session: Session = Depends(get_session),
):
    """IDs de rascunho para seleção em lote respeitando o filtro de tipo (sem paginar)."""
    orders = _orders_filtered(session, status=OrderStatus.rascunho, order_type=order_type)
    all_ids = [o.id for o in orders]
    cap = 5000
    return {"ids": all_ids[:cap], "total": len(all_ids), "capped": len(all_ids) > cap}


@app.post("/api/orders")
def create_order(payload: SalesOrderCreatePayload, session: Session = Depends(get_session)):
    lines_in: List[OrderLineIn] = []
    if payload.lines:
        lines_in = [OrderLineIn.model_validate(ln.model_dump()) for ln in payload.lines]
    else:
        if not payload.product_sku or payload.volume_m3 is None or payload.unit_price is None:
            raise HTTPException(status_code=400, detail="Informe linhas ou campos produto/volume/preço legados")
        lines_in = [
            OrderLineIn(
                product_sku=payload.product_sku,
                volume_m3=float(payload.volume_m3),
                unit_price=float(payload.unit_price),
            )
        ]
    total_val = _order_total(lines_in, payload.discount_order_pct or 0)
    if total_val <= 0 or any(l.volume_m3 <= 0 or l.unit_price <= 0 for l in lines_in):
        raise HTTPException(status_code=400, detail="Volume e valores devem ser positivos")
    exists = session.exec(select(SalesOrder).where(SalesOrder.order_code == payload.order_code)).first()
    if exists:
        raise HTTPException(status_code=409, detail="Código de pedido já existe")
    first = lines_in[0]
    order = SalesOrder(
        order_code=payload.order_code,
        order_date=payload.order_date,
        order_type=payload.order_type,
        status=payload.status,
        party_name=payload.party_name,
        party_id=payload.party_id,
        product_sku=first.product_sku,
        volume_m3=first.volume_m3,
        unit_price=first.unit_price,
        total_value=_order_total(lines_in, payload.discount_order_pct),
        delivery_date=payload.delivery_date,
        discount_order_pct=payload.discount_order_pct or 0,
        notes=payload.notes,
    )
    session.add(order)
    session.flush()
    for ln in lines_in:
        session.add(
            SalesOrderLine(
                order_id=order.id,
                product_sku=ln.product_sku,
                volume_m3=ln.volume_m3,
                unit_price=ln.unit_price,
                discount_line_pct=ln.discount_line_pct,
            )
        )
    write_audit(session, entity="order", action="create", entity_id=payload.order_code, details=f"{payload.order_type} — {len(lines_in)} linha(s)")
    session.commit()
    session.refresh(order)
    return serialize_order(session, order)


@app.post("/api/orders/{order_id}/approve")
def approve_order(order_id: int, session: Session = Depends(get_session)):
    order = session.get(SalesOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if order.status == OrderStatus.cancelado:
        raise HTTPException(status_code=400, detail="Pedido cancelado não pode ser aprovado")
    order.status = OrderStatus.aprovado
    order.updated_at = datetime.utcnow()
    session.add(order)
    write_audit(session, entity="order", action="approve", entity_id=str(order.id), details=order.order_code)
    session.commit()
    session.refresh(order)
    return serialize_order(session, order)


@app.post("/api/orders/batch-approve")
def batch_approve_orders(
    order_ids: Optional[List[int]] = Body(default=None),
    session: Session = Depends(get_session),
):
    order_ids = order_ids or []
    n = 0
    for oid in order_ids:
        order = session.get(SalesOrder, oid)
        if not order or order.status in (OrderStatus.cancelado, OrderStatus.faturado):
            continue
        if order.status == OrderStatus.rascunho:
            order.status = OrderStatus.aprovado
            order.updated_at = datetime.utcnow()
            session.add(order)
            n += 1
    if n:
        write_audit(session, entity="order", action="batch_approve", details=f"{n} pedidos")
        session.commit()
    return {"ok": True, "approved": n}


@app.post("/api/orders/{order_id}/bill")
def bill_order(order_id: int, session: Session = Depends(get_session)):
    order = session.get(SalesOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if order.status not in [OrderStatus.aprovado, OrderStatus.rascunho]:
        raise HTTPException(status_code=400, detail="Status inválido para faturamento")

    lines_db = _order_lines_from_db(session, order.id)
    if not lines_db:
        line_pairs: List[tuple[str, float, float, float]] = [
            (order.product_sku, float(order.volume_m3), float(order.unit_price), 0.0)
        ]
    else:
        line_pairs = [
            (ln.product_sku, float(ln.volume_m3), float(ln.unit_price), float(ln.discount_line_pct or 0))
            for ln in lines_db
        ]
    move_type = StockMovementType.saida if order.order_type == OrderType.venda else StockMovementType.entrada
    for sku, vol, unit, dlp in line_pairs:
        sub = _line_subtotal(OrderLineIn(product_sku=sku, volume_m3=vol, unit_price=unit, discount_line_pct=dlp))
        movement = StockMovement(
            movement_date=date.today(),
            movement_type=move_type,
            document_no=f"{order.order_code}/{sku}",
            product_sku=sku,
            volume_m3=vol,
            unit_value=unit,
            total_value=round(sub, 2),
            party_name=order.party_name,
            nf_no=None,
        )
        session.add(movement)
        product = session.exec(select(Product).where(Product.sku == sku)).first()
        if product:
            cur = float(product.qty_m3 or 0)
            if move_type == StockMovementType.saida and cur - vol < 0:
                raise HTTPException(status_code=400, detail=f"Estoque insuficiente para SKU {sku}")
            if move_type == StockMovementType.saida:
                product.qty_m3 = cur - vol
            else:
                _apply_avg_cost(product, vol, unit)
                product.qty_m3 = cur + vol
            product.updated_at = datetime.utcnow()
            session.add(product)

    fin_type = FinancialEntryType.receber if order.order_type == OrderType.venda else FinancialEntryType.pagar
    fin = FinancialEntry(
        entry_type=fin_type,
        due_date=order.delivery_date or date.today(),
        description=f"Pedido {order.order_code}",
        party_name=order.party_name,
        category="Pedido",
        amount=order.total_value,
        status=FinancialStatus.aberto,
        notes=order.notes,
    )
    session.add(fin)

    order.status = OrderStatus.faturado
    order.updated_at = datetime.utcnow()
    session.add(order)
    write_audit(session, entity="order", action="bill", entity_id=str(order.id), details=order.order_code)
    session.commit()
    session.refresh(order)
    return serialize_order(session, order)


@app.get("/api/orders/export.csv", response_class=PlainTextResponse)
def export_orders_csv(session: Session = Depends(get_session)):
    orders = session.exec(select(SalesOrder).order_by(SalesOrder.id.desc())).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["codigo", "data", "tipo", "status", "parte", "entrega", "sku_resumo", "valor_total", "linhas"])
    for o in orders:
        lines = _order_lines_from_db(session, o.id)
        w.writerow([
            o.order_code,
            o.order_date.isoformat(),
            o.order_type,
            o.status,
            o.party_name,
            o.delivery_date.isoformat() if o.delivery_date else "",
            o.product_sku,
            f"{o.total_value:.2f}",
            len(lines),
        ])
    return buf.getvalue()


@app.post("/api/inventory/count")
def post_inventory_count(
    lines: Optional[List[InventoryCountLineIn]] = Body(default=None),
    session: Session = Depends(get_session),
):
    lines = lines or []
    if not lines:
        raise HTTPException(status_code=400, detail="Envie linhas com product_sku e qty_counted")
    n = 0
    for row in lines:
        sku = row.product_sku
        qc = float(row.qty_counted)
        if not sku:
            continue
        prod = session.exec(select(Product).where(Product.sku == sku)).first()
        sys_q = float(prod.qty_m3 or 0) if prod else 0.0
        session.add(
            InventoryCount(
                product_sku=sku,
                qty_system=sys_q,
                qty_counted=qc,
                variance=round(qc - sys_q, 3),
                notes=row.notes,
            )
        )
        n += 1
    if n:
        write_audit(session, entity="inventory", action="count_cycle", details=f"{n} SKUs contados")
        session.commit()
    return {"ok": True, "recorded": n}


@app.get("/api/inventory/counts")
def list_inventory_counts(limit: int = Query(default=100, ge=1, le=500), session: Session = Depends(get_session)):
    rows = session.exec(select(InventoryCount).order_by(InventoryCount.id.desc()).limit(limit)).all()
    return JSONResponse(content=jsonable_encoder(rows))


@app.post("/api/products/batch-delete")
def batch_delete_products(
    product_ids: Optional[List[int]] = Body(default=None),
    session: Session = Depends(get_session),
):
    product_ids = product_ids or []
    if not product_ids:
        return {"ok": True, "deleted": 0}
    deleted = 0
    for product_id in product_ids:
        prod = session.get(Product, product_id)
        if not prod:
            continue
        session.delete(prod)
        deleted += 1
    if deleted:
        write_audit(session, entity="product", action="batch_delete", details=f"Registros removidos: {deleted}")
        session.commit()
    return {"ok": True, "deleted": deleted}



