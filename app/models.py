from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import List, Optional

from sqlmodel import Field, SQLModel


class ProductCategory(str, Enum):
    espuma_raw = "Espuma Raw"
    espuma_premium = "Espuma Premium"
    mobilia = "Mobília"
    objetos = "Objetos"


class StockMovementType(str, Enum):
    entrada = "Entrada"
    saida = "Saída"
    ajuste = "Ajuste"


class FinancialEntryType(str, Enum):
    pagar = "Pagar"
    receber = "Receber"


class FinancialStatus(str, Enum):
    aberto = "Aberto"
    pago = "Pago"
    vencido = "Vencido"


class OrderType(str, Enum):
    venda = "Venda"
    compra = "Compra"


class OrderStatus(str, Enum):
    rascunho = "Rascunho"
    aprovado = "Aprovado"
    faturado = "Faturado"
    concluido = "Concluído"
    cancelado = "Cancelado"


class PartyKind(str, Enum):
    cliente = "Cliente"
    fornecedor = "Fornecedor"


# --- Cadastros ---


class PartyBase(SQLModel):
    name: str = Field(index=True)
    kind: PartyKind = Field(index=True)
    document: Optional[str] = Field(default=None, index=True)
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


class Party(PartyBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PartyCreate(PartyBase):
    pass


class PartyUpdate(SQLModel):
    name: Optional[str] = None
    kind: Optional[PartyKind] = None
    document: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


class WarehouseLocationBase(SQLModel):
    code: str = Field(index=True, unique=True)
    name: str
    notes: Optional[str] = None


class WarehouseLocation(WarehouseLocationBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class WarehouseLocationCreate(WarehouseLocationBase):
    pass


# --- Produtos ---


class ProductBase(SQLModel):
    sku: str = Field(index=True)
    name: str
    category: ProductCategory = ProductCategory.espuma_raw
    density_kg_m3: Optional[float] = None
    qty_m3: Optional[float] = 0
    sell_price_per_m3: Optional[float] = None
    cost_per_m3: Optional[float] = None
    avg_cost_per_m3: Optional[float] = None
    min_stock_m3: Optional[float] = None
    supplier_name: Optional[str] = None
    notes: Optional[str] = None


class Product(ProductBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ProductCreate(ProductBase):
    pass


class ProductUpdate(SQLModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    category: Optional[ProductCategory] = None
    density_kg_m3: Optional[float] = None
    qty_m3: Optional[float] = None
    sell_price_per_m3: Optional[float] = None
    cost_per_m3: Optional[float] = None
    avg_cost_per_m3: Optional[float] = None
    min_stock_m3: Optional[float] = None
    supplier_name: Optional[str] = None
    notes: Optional[str] = None


class StockMovementBase(SQLModel):
    movement_date: date = Field(default_factory=date.today, index=True)
    movement_type: StockMovementType
    document_no: Optional[str] = None
    product_sku: str = Field(index=True)
    volume_m3: float
    unit_value: Optional[float] = None
    total_value: Optional[float] = None
    party_name: Optional[str] = None
    nf_no: Optional[str] = None
    warehouse_location_code: Optional[str] = Field(default=None, index=True)
    batch_lot: Optional[str] = None
    confirmed_at: Optional[datetime] = None


class StockMovement(StockMovementBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StockMovementCreate(StockMovementBase):
    pass


# --- Plano de contas / centro de custo ---


class ChartAccount(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    name: str
    nature: str = Field(description="Receita | Despesa | Ativo | Passivo | Outros")


class CostCenter(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    name: str


# --- Financeiro ---


class FinancialEntryBase(SQLModel):
    entry_type: FinancialEntryType = Field(index=True)
    due_date: date = Field(index=True)
    description: str
    party_name: Optional[str] = None
    category: Optional[str] = None
    amount: float
    status: FinancialStatus = FinancialStatus.aberto
    paid_at: Optional[datetime] = None
    notes: Optional[str] = None
    chart_account_id: Optional[int] = Field(default=None, foreign_key="chartaccount.id")
    cost_center_id: Optional[int] = Field(default=None, foreign_key="costcenter.id")
    reconciled: bool = False
    reconcile_ref: Optional[str] = None


class FinancialEntry(FinancialEntryBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FinancialEntryCreate(FinancialEntryBase):
    pass


class FinancialEntryUpdate(SQLModel):
    due_date: Optional[date] = None
    description: Optional[str] = None
    party_name: Optional[str] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    status: Optional[FinancialStatus] = None
    paid_at: Optional[datetime] = None
    notes: Optional[str] = None
    chart_account_id: Optional[int] = None
    cost_center_id: Optional[int] = None
    reconciled: Optional[bool] = None
    reconcile_ref: Optional[str] = None


# --- Pedidos ---


class SalesOrderBase(SQLModel):
    order_code: str = Field(index=True)
    order_date: date = Field(default_factory=date.today, index=True)
    order_type: OrderType = Field(index=True)
    status: OrderStatus = Field(default=OrderStatus.rascunho, index=True)
    party_name: str
    party_id: Optional[int] = Field(default=None, foreign_key="party.id")
    product_sku: str = Field(index=True)
    volume_m3: float
    unit_price: float
    total_value: float
    delivery_date: Optional[date] = None
    discount_order_pct: float = 0
    notes: Optional[str] = None


class SalesOrder(SalesOrderBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SalesOrderLine(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="salesorder.id", index=True)
    product_sku: str = Field(index=True)
    volume_m3: float
    unit_price: float
    discount_line_pct: float = 0


class OrderLineIn(SQLModel):
    product_sku: str
    volume_m3: float
    unit_price: float
    discount_line_pct: float = 0


class SalesOrderCreatePayload(SQLModel):
    """Cria pedido com uma ou mais linhas (linhas têm prioridade sobre o cabeçalho legado)."""

    order_code: str
    order_date: date
    order_type: OrderType
    status: OrderStatus = OrderStatus.rascunho
    party_name: str
    party_id: Optional[int] = None
    delivery_date: Optional[date] = None
    discount_order_pct: float = 0
    notes: Optional[str] = None
    lines: List[OrderLineIn] = Field(default_factory=list)
    # legado — usado se lines vazio
    product_sku: Optional[str] = None
    volume_m3: Optional[float] = None
    unit_price: Optional[float] = None
    total_value: Optional[float] = None


# Compat: schema antigo do front
class SalesOrderCreate(SalesOrderBase):
    pass


class InventoryCount(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    counted_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    product_sku: str = Field(index=True)
    qty_system: float
    qty_counted: float
    variance: float
    notes: Optional[str] = None


class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entity: str = Field(index=True)
    entity_id: Optional[str] = None
    action: str = Field(index=True)
    user_id: Optional[int] = Field(default=None, index=True)
    user_name: Optional[str] = None
    details: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)

