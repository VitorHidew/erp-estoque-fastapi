import { api, downloadText } from "./api.js";
import { state } from "./state.js";
import { fmt, toBRDate } from "./utils.js";
import { closeModal, openModal, toast } from "./ui.js";

const selected = new Set();

function statusTag(status) {
  if (status === "Pago") return '<span class="tag tag-success">Pago</span>';
  if (status === "Vencido") return '<span class="tag tag-danger">Vencido</span>';
  return '<span class="tag tag-warning">Aberto</span>';
}

export async function loadFinanceMeta() {
  const [ac, cc] = await Promise.all([
    api("/api/finance/chart-accounts"),
    api("/api/finance/cost-centers"),
  ]);
  state.chartAccounts = ac;
  state.costCenters = cc;
  const fa = document.getElementById("f-chart-account");
  const fc = document.getElementById("f-cost-center");
  if (fa) {
    fa.innerHTML = '<option value="">—</option>';
    for (const a of ac) {
      const o = document.createElement("option");
      o.value = String(a.id);
      o.textContent = `${a.code} — ${a.name}`;
      fa.appendChild(o);
    }
  }
  if (fc) {
    fc.innerHTML = '<option value="">—</option>';
    for (const c of cc) {
      const o = document.createElement("option");
      o.value = String(c.id);
      o.textContent = `${c.code} — ${c.name}`;
      fc.appendChild(o);
    }
  }
}

export async function loadFinanceEntries(opts = {}) {
  const { resetSelection = false } = opts;
  if (resetSelection) selected.clear();
  const panel = document.getElementById("panel-finance");
  panel?.classList.add("panel-loading");
  try {
    const saved = JSON.parse(localStorage.getItem("rl_finance_filters") || "{}");
    const qEl = document.getElementById("finance-q");
    const typeEl = document.getElementById("finance-type");
    const statusEl = document.getElementById("finance-status");
    const reconciledEl = document.getElementById("finance-reconciled");
    const startEl = document.getElementById("finance-start");
    const endEl = document.getElementById("finance-end");
    const q = String(qEl.value || saved.q || "").trim();
    const type = String(typeEl.value || saved.type || "");
    const status = String(statusEl.value || saved.status || "");
    const reco = String(reconciledEl?.value || saved.reconciled || "");
    const start = String(startEl.value || saved.start || "");
    const end = String(endEl.value || saved.end || "");
    qEl.value = q;
    typeEl.value = type;
    statusEl.value = status;
    if (reconciledEl) reconciledEl.value = reco;
    startEl.value = start;
    endEl.value = end;

    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (type) params.set("entry_type", type);
    if (status) params.set("status", status);
    if (reco === "true") params.set("reconciled", "true");
    if (reco === "false") params.set("reconciled", "false");
    if (start) params.set("start_date", start);
    if (end) params.set("end_date", end);
    params.set("page", String(state.pagination.financePage));
    params.set("page_size", String(state.pagination.financePageSize));

    const data = await api("/api/finance/entries" + (params.toString() ? `?${params.toString()}` : ""));
    state.financeEntries = data.items || [];
    state.pagination.financeTotal = Number(data.total || 0);
    state.financeSummary = await api("/api/finance/summary");
    renderFinance();
    renderFinancePagination();
  } finally {
    panel?.classList.remove("panel-loading");
  }
}

function renderFinancePagination() {
  const container = document.getElementById("finance-pagination");
  if (!container) return;
  const { financePage, financePageSize, financeTotal } = state.pagination;
  const maxPage = Math.max(1, Math.ceil(financeTotal / financePageSize) || 1);
  if (financePage > maxPage) state.pagination.financePage = maxPage;
  const start = financeTotal === 0 ? 0 : (financePage - 1) * financePageSize + 1;
  const end = Math.min(financePage * financePageSize, financeTotal);
  container.innerHTML = `
    <div>Mostrando ${start}-${end} de ${financeTotal}</div>
    <div class="pagination-actions">
      <select id="finance-page-size" title="Itens por página" aria-label="Itens por página">
        <option value="15" ${financePageSize === 15 ? "selected" : ""}>15 / página</option>
        <option value="25" ${financePageSize === 25 ? "selected" : ""}>25 / página</option>
        <option value="50" ${financePageSize === 50 ? "selected" : ""}>50 / página</option>
      </select>
      <button type="button" class="btn" id="finance-prev" ${financePage <= 1 ? "disabled" : ""} title="Página anterior">Anterior</button>
      <span>Página ${financePage} / ${maxPage}</span>
      <button type="button" class="btn" id="finance-next" ${financePage >= maxPage ? "disabled" : ""} title="Próxima página">Próxima</button>
    </div>
  `;
  document.getElementById("finance-page-size")?.addEventListener("change", (e) => {
    state.pagination.financePageSize = Number(e.target.value);
    localStorage.setItem("rl_finance_page_size", String(state.pagination.financePageSize));
    state.pagination.financePage = 1;
    loadFinanceEntries({ resetSelection: false }).catch((err) => toast(String(err)));
  });
  document.getElementById("finance-prev")?.addEventListener("click", () => {
    state.pagination.financePage -= 1;
    loadFinanceEntries({ resetSelection: false }).catch((err) => toast(String(err)));
  });
  document.getElementById("finance-next")?.addEventListener("click", () => {
    state.pagination.financePage += 1;
    loadFinanceEntries({ resetSelection: false }).catch((err) => toast(String(err)));
  });
}

function renderFinance() {
  const tbody = document.getElementById("finance-tbody");
  tbody.innerHTML = "";

  if (!state.financeEntries.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">
      <div class="empty-state-inner"><strong>Nenhum lançamento nesta página.</strong>
      <p class="muted">Ajuste filtros ou registre um novo lançamento.</p>
      <button type="button" class="btn btn-primary" id="empty-new-finance">Novo lançamento</button></div></td></tr>`;
    document.getElementById("empty-new-finance")?.addEventListener("click", () => {
      document.getElementById("btn-new-finance")?.click();
    });
    renderBatchBar();
    renderSummary();
    return;
  }

  for (const e of state.financeEntries) {
    const tr = document.createElement("tr");
    const typeTag =
      e.entry_type === "Pagar"
        ? '<span class="tag tag-danger">Pagar</span>'
        : '<span class="tag tag-success">Receber</span>';
    const payable = e.status !== "Pago" ? `<button type="button" class="btn" data-pay="${e.id}">Baixar</button>` : "";
    const recTag = e.reconciled ? '<span class="tag tag-muted">Sim</span>' : '<span class="tag tag-warning">Não</span>';
    const recoBtn = !e.reconciled ? `<button type="button" class="btn" data-reco="${e.id}">Conciliar</button>` : "";
    const editBtn = `<button type="button" class="btn" data-edit-finance="${e.id}" title="Editar"><i data-lucide="pencil"></i></button>`;
    const delBtn = `<button type="button" class="btn btn-danger" data-del-finance="${e.id}" title="Excluir"><i data-lucide="trash-2"></i></button>`;
    const checked = selected.has(e.id) ? "checked" : "";
    tr.innerHTML = `
      <td data-label="Sel."><input type="checkbox" class="finance-check" data-id="${e.id}" ${checked} aria-label="Selecionar lançamento ${e.description?.slice(0, 40) || e.id}"></td>
      <td data-label="Tipo">${typeTag}</td>
      <td data-label="Venc." class="mono">${toBRDate(e.due_date)}</td>
      <td data-label="Descrição">${e.description}</td>
      <td data-label="Parte">${e.party_name || "—"}</td>
      <td data-label="Categoria">${e.category || "—"}</td>
      <td data-label="Valor" class="mono">R$ ${fmt(e.amount)}</td>
      <td data-label="Status">${statusTag(e.status)}</td>
      <td data-label="Conc.">${recTag}</td>
      <td data-label="Ações" class="td-actions finance-td-actions">${payable} ${recoBtn} ${editBtn} ${delBtn}</td>
    `;
    tbody.appendChild(tr);
  }
  document.querySelectorAll("[data-pay]").forEach((btn) => {
    btn.addEventListener("click", () => settleEntry(Number(btn.dataset.pay)));
  });
  document.querySelectorAll("[data-reco]").forEach((btn) => {
    btn.addEventListener("click", () => reconcileOne(Number(btn.dataset.reco)));
  });
  document.querySelectorAll("[data-edit-finance]").forEach((btn) => {
    btn.addEventListener("click", () => openEditFinance(Number(btn.dataset.editFinance)));
  });
  document.querySelectorAll("[data-del-finance]").forEach((btn) => {
    btn.addEventListener("click", () => deleteFinanceEntry(Number(btn.dataset.delFinance)));
  });
  document.querySelectorAll(".finance-check").forEach((check) => {
    check.addEventListener("change", () => {
      const id = Number(check.dataset.id);
      if (check.checked) selected.add(id);
      else selected.delete(id);
      renderBatchBar();
    });
  });
  renderBatchBar();
  renderSummary();
}

async function reconcileOne(id) {
  const ref = prompt("Referência da conciliação (ex.: linha do extrato):", "EXT-001");
  if (ref === null) return;
  await api(`/api/finance/entries/${id}/reconcile`, { method: "POST", body: JSON.stringify({ ref }) });
  toast("Conciliação registrada.", null, "success");
  await loadFinanceEntries({ resetSelection: false });
}

function renderSummary() {
  const s = state.financeSummary || {};
  document.getElementById("kpi-pagar").textContent = `R$ ${fmt(s.pagar_aberto || 0)}`;
  document.getElementById("kpi-receber").textContent = `R$ ${fmt(s.receber_aberto || 0)}`;
  document.getElementById("kpi-pago-mes").textContent = `R$ ${fmt(s.pago_mes || 0)}`;
  document.getElementById("kpi-saldo-projetado").textContent = `R$ ${fmt(s.saldo_projetado || 0)}`;
  document.getElementById("kpi-inadimplencia").textContent = `R$ ${fmt(s.inadimplencia_total || 0)}`;
  document.getElementById("kpi-inadimplencia-qtd").textContent = `${s.inadimplencia_qtd || 0} títulos vencidos`;
  document.getElementById("aging-0-30").textContent = `R$ ${fmt((s.aging || {})["0_30"] || 0)}`;
  document.getElementById("aging-31-60").textContent = `R$ ${fmt((s.aging || {})["31_60"] || 0)}`;
  document.getElementById("aging-61-plus").textContent = `R$ ${fmt((s.aging || {})["61_plus"] || 0)}`;
}

function renderBatchBar() {
  const bar = document.getElementById("finance-batch-bar");
  bar.classList.toggle("show", selected.size > 0);
  document.getElementById("finance-selected-count").textContent = String(selected.size);
}

function validateFinanceForm() {
  const due = document.getElementById("f-due");
  const desc = document.getElementById("f-description");
  const amt = document.getElementById("f-amount");
  [due, desc, amt].forEach((el) => el?.classList.remove("input-invalid"));
  let ok = true;
  if (!due?.value) {
    due?.classList.add("input-invalid");
    ok = false;
  }
  if (!desc?.value.trim()) {
    desc?.classList.add("input-invalid");
    ok = false;
  }
  if (Number(amt?.value || 0) <= 0) {
    amt?.classList.add("input-invalid");
    ok = false;
  }
  return ok;
}

let _editingFinanceId = null;

function openEditFinance(id) {
  const entry = (state.financeEntries || []).find((e) => e.id === id);
  if (!entry) return;
  _editingFinanceId = id;
  document.getElementById("f-type").value = entry.entry_type || "Pagar";
  document.getElementById("f-due").value = entry.due_date || "";
  document.getElementById("f-description").value = entry.description || "";
  document.getElementById("f-party").value = entry.party_name || "";
  document.getElementById("f-category").value = entry.category || "";
  document.getElementById("f-amount").value = String(entry.amount || "");
  document.getElementById("f-status").value = entry.status || "Aberto";
  document.getElementById("f-notes").value = entry.notes || "";
  const caEl = document.getElementById("f-chart-account");
  if (caEl && entry.chart_account_id) caEl.value = String(entry.chart_account_id);
  const ccEl = document.getElementById("f-cost-center");
  if (ccEl && entry.cost_center_id) ccEl.value = String(entry.cost_center_id);
  const titleEl = document.getElementById("modal-finance-title");
  if (titleEl) titleEl.textContent = "Editar Lançamento";
  openModal("modal-finance");
}

async function deleteFinanceEntry(id) {
  const entry = (state.financeEntries || []).find((e) => e.id === id);
  if (!confirm(`Excluir lançamento "${entry?.description || id}"? Essa ação não pode ser desfeita.`)) return;
  await api(`/api/finance/entries/${id}`, { method: "DELETE" });
  toast("Lançamento excluído.", null, "success");
  await loadFinanceEntries({ resetSelection: false });
}

export async function saveFinancialEntry() {
  if (!validateFinanceForm()) {
    return toast("Preencha vencimento, descrição e valor maior que zero.", null, "error");
  }
  const ca = document.getElementById("f-chart-account")?.value;
  const cc = document.getElementById("f-cost-center")?.value;
  const payload = {
    entry_type: document.getElementById("f-type").value,
    due_date: document.getElementById("f-due").value,
    description: document.getElementById("f-description").value.trim(),
    party_name: document.getElementById("f-party").value.trim() || null,
    category: document.getElementById("f-category").value.trim() || null,
    amount: Number(document.getElementById("f-amount").value || 0),
    status: document.getElementById("f-status").value,
    notes: document.getElementById("f-notes").value.trim() || null,
    paid_at: null,
    chart_account_id: ca ? Number(ca) : null,
    cost_center_id: cc ? Number(cc) : null,
    reconciled: false,
    reconcile_ref: null,
  };
  if (payload.status === "Pago") payload.paid_at = new Date().toISOString();

  if (_editingFinanceId) {
    await api(`/api/finance/entries/${_editingFinanceId}`, { method: "PUT", body: JSON.stringify(payload) });
    toast("Lançamento atualizado.", null, "success");
    _editingFinanceId = null;
  } else {
    await api("/api/finance/entries", { method: "POST", body: JSON.stringify(payload) });
    toast("Lançamento financeiro salvo.", null, "success");
    state.pagination.financePage = 1;
  }

  // Reset modal title
  const titleEl = document.getElementById("modal-finance-title");
  if (titleEl) titleEl.textContent = "Novo Lançamento Financeiro";

  closeModal("modal-finance");
  await loadFinanceEntries({ resetSelection: false });
}

async function settleEntry(id) {
  if (!confirm("Confirmar baixa financeira?")) return;
  await api(`/api/finance/entries/${id}/pay`, { method: "POST" });
  toast("Baixa registrada.", null, "success");
  await loadFinanceEntries({ resetSelection: false });
}

export async function batchSettleSelected() {
  if (selected.size === 0) return;
  if (!confirm(`Baixar ${selected.size} lançamento(s) selecionado(s)?`)) return;
  const result = await api("/api/finance/entries/batch-pay", {
    method: "POST",
    body: JSON.stringify(Array.from(selected)),
  });
  toast(`${result.updated || 0} baixa(s) aplicada(s).`, null, "success");
  selected.clear();
  await loadFinanceEntries({ resetSelection: false });
}

export async function batchReconcileSelected() {
  if (selected.size === 0) return;
  const ref = prompt("Referência para o lote:", "LOTE-CSV");
  if (ref === null) return;
  const result = await api("/api/finance/entries/batch-reconcile", {
    method: "POST",
    body: JSON.stringify({ entry_ids: Array.from(selected), ref }),
  });
  toast(`${result.updated || 0} conciliação(ões).`, null, "success");
  selected.clear();
  await loadFinanceEntries({ resetSelection: false });
}

export function clearFinanceSelection() {
  selected.clear();
  document.querySelectorAll(".finance-check").forEach((c) => {
    c.checked = false;
  });
  renderBatchBar();
}

export function applyFinanceFilters() {
  const payload = {
    q: document.getElementById("finance-q").value || "",
    type: document.getElementById("finance-type").value || "",
    status: document.getElementById("finance-status").value || "",
    reconciled: document.getElementById("finance-reconciled")?.value || "",
    start: document.getElementById("finance-start").value || "",
    end: document.getElementById("finance-end").value || "",
  };
  localStorage.setItem("rl_finance_filters", JSON.stringify(payload));
  state.pagination.financePage = 1;
  loadFinanceEntries({ resetSelection: true }).catch((e) => toast(String(e)));
}

export function resetFinanceFilters() {
  document.getElementById("finance-q").value = "";
  document.getElementById("finance-type").value = "";
  document.getElementById("finance-status").value = "";
  const reco = document.getElementById("finance-reconciled");
  if (reco) reco.value = "";
  document.getElementById("finance-start").value = "";
  document.getElementById("finance-end").value = "";
  localStorage.removeItem("rl_finance_filters");
  state.pagination.financePage = 1;
  loadFinanceEntries({ resetSelection: true }).catch((e) => toast(String(e)));
}

export async function exportFinanceCsv() {
  const saved = JSON.parse(localStorage.getItem("rl_finance_filters") || "{}");
  const params = new URLSearchParams();
  if (saved.q) params.set("q", saved.q);
  if (saved.type) params.set("entry_type", saved.type);
  if (saved.status) params.set("status", saved.status);
  if (saved.reconciled === "true") params.set("reconciled", "true");
  if (saved.reconciled === "false") params.set("reconciled", "false");
  if (saved.start) params.set("start_date", saved.start);
  if (saved.end) params.set("end_date", saved.end);
  const csv = await downloadText("/api/finance/export.csv" + (params.toString() ? `?${params.toString()}` : ""));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "financeiro-empresa-exemplo.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function selectFinancePage() {
  for (const e of state.financeEntries) {
    selected.add(e.id);
  }
  renderFinance();
}


