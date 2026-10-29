import { api, downloadText } from "./api.js";
import { state } from "./state.js";
import { fmt, toBRDate, escHtml } from "./utils.js";
import { closeModal, openModal, toast } from "./ui.js";
import { fillPartySelectForOrders } from "./parties.js";
import { confirmDialog } from "./confirm.js";

const selOrders = new Set();
let orderSort = { key: "order_date", dir: "desc" };
let _editingOrderId = null;

function statusTag(status) {
  if (status === "Faturado") return '<span class="tag tag-success">Faturado</span>';
  if (status === "Aprovado") return '<span class="tag tag-warning">Aprovado</span>';
  if (status === "Cancelado") return '<span class="tag tag-danger">Cancelado</span>';
  if (status === "Concluído") return '<span class="tag tag-muted">Concluído</span>';
  return `<span class="tag tag-muted">${escHtml(status)}</span>`;
}

function lineSubtotal(vol, price, disc) {
  const d = Math.max(0, Math.min(100, disc || 0));
  return vol * price * (1 - d / 100);
}

export function recalcOrderModalTotals() {
  const rows = document.querySelectorAll("#order-lines-tbody tr");
  let sum = 0;
  for (const row of rows) {
    const vol = Number(row.querySelector(".ol-vol")?.value || 0);
    const price = Number(row.querySelector(".ol-price")?.value || 0);
    const disc = Number(row.querySelector(".ol-disc")?.value || 0);
    const st = lineSubtotal(vol, price, disc);
    sum += st;
    const el = row.querySelector(".ol-subtotal");
    if (el) el.textContent = vol > 0 && price > 0 ? `R$ ${fmt(st)}` : "—";
  }
  const orderDisc = Number(document.getElementById("o-discount-order")?.value || 0);
  const d = Math.max(0, Math.min(100, orderDisc));
  const grand = sum * (1 - d / 100);
  const elSum = document.getElementById("order-sum-lines");
  const elGrand = document.getElementById("order-grand-total");
  if (elSum) elSum.textContent = `R$ ${fmt(sum)}`;
  if (elGrand) elGrand.textContent = `R$ ${fmt(grand)}`;
}

export function ensureOrderLineRow() {
  const tb = document.getElementById("order-lines-tbody");
  if (!tb.querySelector("tr")) addOrderLineRow();
}

export function addOrderLineRow(data = {}) {
  const tb = document.getElementById("order-lines-tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td data-label="SKU"><input type="text" class="ol-sku" style="width:100%" list="sku-list" placeholder="SKU" value="${escHtml(data.product_sku || "")}"></td>
    <td data-label="Volume"><input type="number" class="ol-vol" step="0.01" placeholder="m³" value="${data.volume_m3 || ""}"></td>
    <td data-label="Preço"><input type="number" class="ol-price" step="0.01" value="${data.unit_price || ""}"></td>
    <td data-label="Desc. %"><input type="number" class="ol-disc" step="0.1" placeholder="%" value="${data.discount_line_pct || ""}"></td>
    <td data-label="Subtotal" class="ol-subtotal mono">—</td>
    <td><button type="button" class="btn btn-danger ol-remove" aria-label="Remover linha">×</button></td>
  `;
  tb.appendChild(tr);
  tr.querySelector(".ol-remove").addEventListener("click", () => {
    tr.remove();
    if (!tb.querySelector("tr")) addOrderLineRow();
    recalcOrderModalTotals();
  });
  ["ol-vol", "ol-price", "ol-disc"].forEach((cls) => {
    tr.querySelector(`.${cls}`)?.addEventListener("input", recalcOrderModalTotals);
  });
  recalcOrderModalTotals();
}

function collectOrderLines() {
  const rows = document.querySelectorAll("#order-lines-tbody tr");
  const lines = [];
  for (const row of rows) {
    const sku = row.querySelector(".ol-sku")?.value.trim();
    const vol = Number(row.querySelector(".ol-vol")?.value || 0);
    const price = Number(row.querySelector(".ol-price")?.value || 0);
    const disc = Number(row.querySelector(".ol-disc")?.value || 0);
    if (!sku || vol <= 0 || price <= 0) continue;
    lines.push({ product_sku: sku, volume_m3: vol, unit_price: price, discount_line_pct: disc || 0 });
  }
  return lines;
}

export async function loadOrders(opts = {}) {
  const { resetSelection = false } = opts;
  if (resetSelection) selOrders.clear();
  const panel = document.getElementById("panel-orders");
  panel?.classList.add("panel-loading");
  try {
    const type = document.getElementById("order-type-filter").value;
    const status = document.getElementById("order-status-filter").value;
    const params = new URLSearchParams();
    if (type) params.set("order_type", type);
    if (status) params.set("status", status);
    params.set("sort_by", orderSort.key);
    params.set("sort_dir", orderSort.dir);
    params.set("page", String(state.pagination.orderPage));
    params.set("page_size", String(state.pagination.orderPageSize));
    const data = await api("/api/orders" + (params.toString() ? `?${params.toString()}` : ""));
    state.pagination.orderTotal = Number(data.total || 0);
    state.orders = data.items || [];
    renderOrders();
    renderOrdersPagination();
  } finally {
    panel?.classList.remove("panel-loading");
  }
}

function renderOrdersPagination() {
  const container = document.getElementById("orders-pagination");
  if (!container) return;
  const { orderPage, orderPageSize, orderTotal } = state.pagination;
  const maxPage = Math.max(1, Math.ceil(orderTotal / orderPageSize) || 1);
  if (orderPage > maxPage) state.pagination.orderPage = maxPage;
  const start = orderTotal === 0 ? 0 : (orderPage - 1) * orderPageSize + 1;
  const end = Math.min(orderPage * orderPageSize, orderTotal);
  container.innerHTML = `
    <div>Mostrando ${start}–${end} de ${orderTotal}</div>
    <div class="pagination-actions">
      <select id="orders-page-size">
        <option value="10" ${orderPageSize === 10 ? "selected" : ""}>10 / página</option>
        <option value="25" ${orderPageSize === 25 ? "selected" : ""}>25 / página</option>
        <option value="50" ${orderPageSize === 50 ? "selected" : ""}>50 / página</option>
      </select>
      <button type="button" class="btn" id="orders-prev" ${orderPage <= 1 ? "disabled" : ""}>Anterior</button>
      <span>Página ${orderPage} / ${maxPage}</span>
      <button type="button" class="btn" id="orders-next" ${orderPage >= maxPage ? "disabled" : ""}>Próxima</button>
    </div>
  `;
  document.getElementById("orders-page-size")?.addEventListener("change", (e) => {
    state.pagination.orderPageSize = Number(e.target.value);
    localStorage.setItem("rl_order_page_size", String(state.pagination.orderPageSize));
    state.pagination.orderPage = 1;
    loadOrders({ resetSelection: false }).catch((err) => toast(String(err)));
  });
  document.getElementById("orders-prev")?.addEventListener("click", () => {
    state.pagination.orderPage -= 1;
    loadOrders({ resetSelection: false }).catch((err) => toast(String(err)));
  });
  document.getElementById("orders-next")?.addEventListener("click", () => {
    state.pagination.orderPage += 1;
    loadOrders({ resetSelection: false }).catch((err) => toast(String(err)));
  });
}

function renderOrdersBatchBar() {
  const bar = document.getElementById("orders-batch-bar");
  if (!bar) return;
  bar.classList.toggle("show", selOrders.size > 0);
  const el = document.getElementById("orders-selected-count");
  if (el) el.textContent = String(selOrders.size);
}

function toggleOrderSort(key) {
  if (orderSort.key === key) orderSort.dir = orderSort.dir === "asc" ? "desc" : "asc";
  else { orderSort.key = key; orderSort.dir = key === "order_code" ? "asc" : "desc"; }
  state.pagination.orderPage = 1;
  loadOrders({ resetSelection: false }).catch((err) => toast(String(err)));
}

function renderOrders() {
  const tbody = document.getElementById("orders-tbody");
  tbody.innerHTML = "";
  if (!state.orders.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">
      <div class="empty-state-inner"><strong>Nenhum pedido nesta página.</strong>
      <p class="muted">Ajuste filtros ou crie um novo pedido.</p>
      <button type="button" class="btn btn-primary" id="empty-new-order">Novo pedido</button></div></td></tr>`;
    document.getElementById("empty-new-order")?.addEventListener("click", () => {
      document.getElementById("btn-new-order")?.click();
    });
    renderOrdersBatchBar();
    wireOrderSortHeaders();
    return;
  }
  for (const order of state.orders) {
    const tr = document.createElement("tr");
    const typeTag = order.order_type === "Venda"
      ? '<span class="tag tag-success">Venda</span>'
      : '<span class="tag tag-muted">Compra</span>';
    const canEdit = order.status === "Rascunho" || order.status === "Aprovado";
    const canCancel = order.status !== "Cancelado" && order.status !== "Faturado";
    const approve = order.status === "Rascunho"
      ? `<button type="button" class="btn" data-approve="${order.id}">Aprovar</button>` : "";
    const bill = (order.status === "Aprovado" || order.status === "Rascunho")
      ? `<button type="button" class="btn btn-primary" data-bill="${order.id}">Faturar</button>` : "";
    const editBtn = canEdit
      ? `<button type="button" class="btn" data-edit-order="${order.id}" title="Editar">Editar</button>` : "";
    const cancelBtn = canCancel
      ? `<button type="button" class="btn btn-danger" data-cancel-order="${order.id}" title="Cancelar">Cancelar</button>` : "";
    const nlines = Array.isArray(order.lines) ? order.lines.length : 0;
    const deliv = order.delivery_date ? toBRDate(order.delivery_date) : "—";
    const canSel = order.status === "Rascunho";
    const checked = selOrders.has(order.id) ? "checked" : "";
    tr.innerHTML = `
      <td data-label="Sel.">${canSel ? `<input type="checkbox" class="order-check" data-id="${order.id}" ${checked}>` : ""}</td>
      <td data-label="Código" class="mono">${escHtml(order.order_code)}</td>
      <td data-label="Data" class="mono">${toBRDate(order.order_date)}</td>
      <td data-label="Entrega" class="mono">${deliv}</td>
      <td data-label="Tipo">${typeTag}</td>
      <td data-label="Status">${statusTag(order.status)}</td>
      <td data-label="Cliente / Fornecedor">${escHtml(order.party_name)}</td>
      <td data-label="Itens" class="mono">${nlines} linha(s)</td>
      <td data-label="Total" class="mono">R$ ${fmt(order.total_value)}</td>
      <td data-label="Ações" class="td-actions">${approve}${bill}${editBtn}${cancelBtn}</td>
    `;
    tbody.appendChild(tr);
  }
  document.querySelectorAll("[data-edit-order]").forEach((btn) => {
    btn.addEventListener("click", () => openEditOrder(Number(btn.dataset.editOrder)));
  });
  document.querySelectorAll("[data-cancel-order]").forEach((btn) => {
    btn.addEventListener("click", () => cancelOrder(Number(btn.dataset.cancelOrder)));
  });
  document.querySelectorAll(".order-check").forEach((c) => {
    c.addEventListener("change", () => {
      const id = Number(c.dataset.id);
      if (c.checked) selOrders.add(id); else selOrders.delete(id);
      renderOrdersBatchBar();
    });
  });
  document.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", () => approveOrder(Number(btn.dataset.approve)));
  });
  document.querySelectorAll("[data-bill]").forEach((btn) => {
    btn.addEventListener("click", () => billOrder(Number(btn.dataset.bill)));
  });
  renderOrdersBatchBar();
  wireOrderSortHeaders();
}

function wireOrderSortHeaders() {
  document.querySelectorAll("#orders-table thead [data-sort]").forEach((th) => {
    th.replaceWith(th.cloneNode(true));
  });
  document.querySelectorAll("#orders-table thead [data-sort]").forEach((th) => {
    const indicator = orderSort.key === th.dataset.sort
      ? (orderSort.dir === "asc" ? " ↑" : " ↓") : "";
    th.innerHTML = th.textContent.replace(/ [↑↓]$/, "") + indicator;
    th.addEventListener("click", () => toggleOrderSort(th.dataset.sort));
  });
}

export async function openOrderModalPrep() {
  _editingOrderId = null;
  const titleEl = document.getElementById("modal-order-title");
  if (titleEl) titleEl.textContent = "Novo Pedido";  const tb = document.getElementById("order-lines-tbody");
  tb.innerHTML = "";
  addOrderLineRow();
  await fillPartySelectForOrders();
  recalcOrderModalTotals();
}

export async function batchApproveOrders() {
  if (selOrders.size === 0) return;
  const body = Array.from(selOrders);
  const r = await api("/api/orders/batch-approve", { method: "POST", body: JSON.stringify(body) });
  toast(`${r.approved || 0} pedido(s) aprovados.`, null, "success");
  selOrders.clear();
  await loadOrders({ resetSelection: false });
}

export function selectDraftsOnCurrentPage() {
  for (const order of state.orders) {
    if (order.status === "Rascunho") selOrders.add(order.id);
  }
  renderOrders();
}

export async function selectAllDraftsMatchingFilter() {
  const type = document.getElementById("order-type-filter").value;
  const params = new URLSearchParams();
  if (type) params.set("order_type", type);
  const r = await api(`/api/orders/draft-ids?${params.toString()}`);
  for (const id of r.ids || []) selOrders.add(id);
  if (r.capped) {
    toast("Seleção limitada a 5000 rascunhos.", `Total no filtro: ${r.total}.`, "default");
  }
  await loadOrders({ resetSelection: false });
}

export function clearOrderSelection() {
  selOrders.clear();
  renderOrders();
}

export async function exportOrdersCsv() {
  const csv = await downloadText("/api/orders/export.csv");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "pedidos-empresa-exemplo.csv"; a.click();
  URL.revokeObjectURL(url);
}

export function printOrdersTable() {
  const w = window.open("", "_blank");
  if (!w) return toast("Permita pop-ups para imprimir.");
  const html = `<html><head><title>Pedidos Empresa Exemplo</title>
    <style>body{font-family:system-ui,sans-serif;padding:24px;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ccc;padding:6px;font-size:12px;}</style></head><body>
    <h1>Pedidos — Empresa Exemplo ERP</h1>
    <table><thead><tr><th>Código</th><th>Data</th><th>Tipo</th><th>Status</th><th>Cliente/Forn.</th><th>Total</th><th>Linhas</th></tr></thead><tbody>
    ${(state.orders || []).map((o) => `<tr><td>${escHtml(o.order_code)}</td><td>${toBRDate(o.order_date)}</td><td>${escHtml(o.order_type)}</td><td>${escHtml(o.status)}</td><td>${escHtml(o.party_name)}</td><td>R$ ${fmt(o.total_value)}</td><td>${(o.lines || []).length}</td></tr>`).join("")}
    </tbody></table>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;
  w.document.write(html);
  w.document.close();
}

function validateOrderForm() {
  let ok = true;
  const code = document.getElementById("o-code");
  const date = document.getElementById("o-date");
  [code, date].forEach((el) => el?.classList.remove("input-invalid"));
  if (!code?.value.trim()) { code?.classList.add("input-invalid"); ok = false; }
  if (!date?.value) { date?.classList.add("input-invalid"); ok = false; }
  return ok;
}

export async function openEditOrder(id) {
  const order = (state.orders || []).find(o => o.id === id);
  if (!order) return;
  _editingOrderId = id;
  document.getElementById("o-code").value = order.order_code || "";
  document.getElementById("o-date").value = order.order_date || "";
  document.getElementById("o-type").value = order.order_type || "Venda";
  document.getElementById("o-status").value = order.status || "Rascunho";
  document.getElementById("o-party").value = order.party_name || "";
  document.getElementById("o-delivery").value = order.delivery_date || "";
  document.getElementById("o-discount-order").value = order.discount_order_pct != null ? String(order.discount_order_pct) : "0";
  document.getElementById("o-notes").value = order.notes || "";
  const titleEl = document.getElementById("modal-order-title");
  if (titleEl) titleEl.textContent = `Editar Pedido — ${order.order_code}`;
  // Populate lines
  const tb = document.getElementById("order-lines-tbody");
  tb.innerHTML = "";
  await fillPartySelectForOrders();
  const lines = order.lines || [];
  if (!lines.length) { addOrderLineRow(); }
  else {
    for (const ln of lines) {
      addOrderLineRow();
      const rows = tb.querySelectorAll("tr");
      const last = rows[rows.length - 1];
      last.querySelector(".ol-sku").value = ln.product_sku || "";
      last.querySelector(".ol-vol").value = ln.volume_m3 != null ? String(ln.volume_m3) : "";
      last.querySelector(".ol-price").value = ln.unit_price != null ? String(ln.unit_price) : "";
      last.querySelector(".ol-disc").value = ln.discount_line_pct != null ? String(ln.discount_line_pct) : "0";
    }
  }
  recalcOrderModalTotals();
  openModal("modal-order");
}

export async function saveOrder() {
  if (!validateOrderForm()) {
    return toast("Corrija os campos destacados (código e data).", null, "error");
  }
  const partySelect = document.getElementById("o-party-select");
  const partyManual = document.getElementById("o-party").value.trim();
  let party_name = partyManual;
  let party_id = null;
  const opt = partySelect?.selectedOptions?.[0];
  if (partySelect?.value && opt?.dataset?.name) {
    party_name = opt.dataset.name;
    party_id = Number(partySelect.value);
  }
  if (!party_name) return toast("Informe a parte (cliente/fornecedor).", null, "error");
  const lines = collectOrderLines();
  if (!lines.length) return toast("Adicione ao menos uma linha com SKU, volume e preço.", null, "error");
  const payload = {
    order_code: document.getElementById("o-code").value.trim(),
    order_date: document.getElementById("o-date").value,
    order_type: document.getElementById("o-type").value,
    status: document.getElementById("o-status").value,
    party_name, party_id,
    delivery_date: document.getElementById("o-delivery").value || null,
    discount_order_pct: Number(document.getElementById("o-discount-order").value || 0),
    notes: document.getElementById("o-notes").value.trim() || null,
    lines,
  };
  const saveBtn = document.getElementById("btn-save-order");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvando…"; }
  try {
    if (_editingOrderId) {
      await api(`/api/orders/${_editingOrderId}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Pedido atualizado.", null, "success");
    } else {
      await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
      toast("Pedido salvo.", null, "success");
    }
    _editingOrderId = null;
    closeModal("modal-order");
    state.pagination.orderPage = 1;
    await loadOrders({ resetSelection: true });
  } catch (e) {
    toast(e.message || String(e), null, "error");
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i data-lucide="save"></i>Salvar Pedido'; }
  }
}

async function approveOrder(orderId) {
  await api(`/api/orders/${orderId}/approve`, { method: "POST" });
  toast("Pedido aprovado.", null, "success");
  await loadOrders({ resetSelection: false });
}

async function billOrder(orderId) {
  const ok = await confirmDialog("Faturar pedido?", "Isso gera movimentação de estoque e lançamento financeiro automaticamente.", "warning");
  if (!ok) return;
  try {
    await api(`/api/orders/${orderId}/bill`, { method: "POST" });
    toast("Pedido faturado com sucesso.", null, "success");
    await loadOrders({ resetSelection: false });
  } catch (e) {
    toast(e.message || String(e), null, "error");
  }
}

async function cancelOrder(orderId) {
  const order = (state.orders || []).find((o) => o.id === orderId);
  const ok = await confirmDialog("Cancelar pedido?", `"${order?.order_code || orderId}" será marcado como cancelado.`);
  if (!ok) return;
  try {
    await api(`/api/orders/${orderId}/cancel`, { method: "POST" });
    toast("Pedido cancelado.", null, "success");
    await loadOrders({ resetSelection: false });
  } catch (e) {
    toast(e.message || String(e), null, "error");
  }
}


