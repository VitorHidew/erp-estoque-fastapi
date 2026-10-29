import { api } from "./api.js";
import { state } from "./state.js";
import { fmt, stockLevel, stockTag, escHtml } from "./utils.js";
import { toast, closeModal, openModal } from "./ui.js";
import { confirmDialog } from "./confirm.js";

const selected = new Set();
let _editingProductId = null;

async function renderStockDashboard() {
  try {
    const data = await api("/api/reports/stock-critical");
    const critical = (data.critical || []).slice(0, 5);
    const warning = (data.warning || []).slice(0, 5);
    
    const criticalList = document.getElementById("critical-list");
    const warningList = document.getElementById("warning-list");
    
    if (criticalList) {
      criticalList.innerHTML = critical.length 
        ? critical.map(p => `
            <div class="stock-dashboard-item critical-item">
              <div class="stock-item-header">
                <span class="stock-item-sku mono">${escHtml(p.sku)}</span>
                <span class="stock-item-qty danger">${fmt(p.qty_m3)} m³</span>
              </div>
              <div class="stock-item-name">${escHtml(p.name)}</div>
              <div class="stock-item-footer">
                <span class="stock-item-min">Mínimo: ${fmt(p.min_stock_m3)} m³</span>
                <span class="stock-item-gap danger">Faltam ${fmt(p.min_stock_m3 - p.qty_m3)} m³</span>
              </div>
            </div>
          `).join("")
        : '<div class="stock-dashboard-empty">✓ Nenhum produto em estoque crítico</div>';
    }
    
    if (warningList) {
      warningList.innerHTML = warning.length
        ? warning.map(p => `
            <div class="stock-dashboard-item warning-item">
              <div class="stock-item-header">
                <span class="stock-item-sku mono">${escHtml(p.sku)}</span>
                <span class="stock-item-qty warning">${fmt(p.qty_m3)} m³</span>
              </div>
              <div class="stock-item-name">${escHtml(p.name)}</div>
              <div class="stock-item-footer">
                <span class="stock-item-min">Mínimo: ${fmt(p.min_stock_m3)} m³</span>
                <span class="stock-item-gap warning">Faltam ${fmt(p.min_stock_m3 - p.qty_m3)} m³</span>
              </div>
            </div>
          `).join("")
        : '<div class="stock-dashboard-empty">✓ Nenhum produto próximo do crítico</div>';
    }
  } catch (e) {
    console.error("Error loading stock dashboard:", e);
  }
}

export async function loadProducts() {
  const panel = document.getElementById("panel-products");
  panel?.classList.add("panel-loading");
  try {
    // Load dashboard first
    renderStockDashboard().catch(() => {});
    
    const saved = JSON.parse(localStorage.getItem("rl_filters") || "{}");
    const qEl = document.getElementById("filter-q");
    const categoryEl = document.getElementById("filter-category");
    const stockEl = document.getElementById("filter-stock");
    const q = String(qEl.value || saved.q || "").trim();
    const category = String(categoryEl.value || saved.category || "");
    const stock = String(stockEl.value || saved.stock || "");
    qEl.value = q;
    categoryEl.value = category;
    stockEl.value = stock;
    const params = new URLSearchParams({
      page: String(state.pagination.productPage),
      page_size: String(state.pagination.productPageSize),
    });
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (stock) params.set("stock_status", stock);
    const result = await api(`/api/products?${params.toString()}`);
    state.products = result.items || [];
    state.pagination.productTotal = Number(result.total || 0);
    renderProducts();
    renderProductPagination();
  } finally {
    panel?.classList.remove("panel-loading");
  }
}

export function renderProducts() {
  const tbody = document.getElementById("products-tbody");
  tbody.innerHTML = "";
  const skuList = document.getElementById("sku-list");
  skuList.innerHTML = "";
  selected.clear();
  if (!state.products.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">
      <div class="empty-state-inner"><strong>Nenhum produto nesta página.</strong>
      <p class="muted">Ajuste filtros ou cadastre um novo SKU.</p>
      <button type="button" class="btn btn-primary" id="empty-new-product">Novo produto</button></div></td></tr>`;
    document.getElementById("empty-new-product")?.addEventListener("click", () => {
      document.getElementById("btn-new-product")?.click();
    });
    renderBatchBar();
    return;
  }
  for (const p of state.products) {
    const opt = document.createElement("option");
    opt.value = p.sku;
    skuList.appendChild(opt);
    const tr = document.createElement("tr");
    const level = stockLevel(p);
    tr.innerHTML = `
      <td data-label="Sel."><input type="checkbox" data-id="${p.id}" class="product-check" aria-label="Selecionar ${escHtml(p.sku)}"></td>
      <td data-label="SKU" class="mono">${escHtml(p.sku)}</td>
      <td data-label="Produto">${escHtml(p.name)}</td>
      <td data-label="Categoria">${escHtml(String(p.category))}</td>
      <td data-label="Densidade">${p.density_kg_m3 ? `${fmt(p.density_kg_m3)} kg/m³` : "—"}</td>
      <td data-label="Qtd m³" class="mono">${fmt(p.qty_m3)}</td>
      <td data-label="Preço" class="mono">${p.sell_price_per_m3 ? `R$ ${fmt(p.sell_price_per_m3)}` : "—"}</td>
      <td data-label="Status">${stockTag(level)}</td>
      <td data-label="Ações" class="td-actions">
        <button type="button" class="btn" data-edit="${p.id}" title="Editar produto">Editar</button>
        <button type="button" class="btn btn-danger" data-delete="${p.id}" title="Excluir produto">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  bindProductEvents();
  renderBatchBar();
}

function bindProductEvents() {
  document.querySelectorAll(".product-check").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = Number(checkbox.dataset.id);
      if (checkbox.checked) selected.add(id);
      else selected.delete(id);
      renderBatchBar();
    });
  });
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEditProduct(Number(btn.dataset.edit)));
  });
  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteProduct(Number(btn.dataset.delete)));
  });
}

function openEditProduct(id) {
  const p = (state.products || []).find((x) => x.id === id);
  if (!p) return;
  _editingProductId = id;
  document.getElementById("p-sku").value = p.sku || "";
  document.getElementById("p-name").value = p.name || "";
  document.getElementById("p-category").value = p.category || "";
  document.getElementById("p-density").value = p.density_kg_m3 != null ? String(p.density_kg_m3) : "";
  document.getElementById("p-qty").value = p.qty_m3 != null ? String(p.qty_m3) : "";
  document.getElementById("p-cost").value = p.cost_per_m3 != null ? String(p.cost_per_m3) : "";
  document.getElementById("p-avg-cost").value = p.avg_cost_per_m3 != null ? String(p.avg_cost_per_m3) : "";
  document.getElementById("p-sell").value = p.sell_price_per_m3 != null ? String(p.sell_price_per_m3) : "";
  document.getElementById("p-min").value = p.min_stock_m3 != null ? String(p.min_stock_m3) : "";
  document.getElementById("p-supplier").value = p.supplier_name || "";
  document.getElementById("p-notes").value = p.notes || "";
  const titleEl = document.getElementById("modal-product-title");
  if (titleEl) titleEl.textContent = `Editar Produto — ${p.sku}`;
  openModal("modal-product");
}

function renderBatchBar() {
  const bar = document.getElementById("products-batch-bar");
  if (!bar) return;
  bar.classList.toggle("show", selected.size > 0);
  const count = document.getElementById("products-selected-count");
  if (count) count.textContent = String(selected.size);
}

export async function saveProduct() {
  const payload = {
    sku: document.getElementById("p-sku").value.trim(),
    name: document.getElementById("p-name").value.trim(),
    category: document.getElementById("p-category").value,
    density_kg_m3: Number(document.getElementById("p-density").value || "") || null,
    qty_m3: Number(document.getElementById("p-qty").value || 0),
    cost_per_m3: Number(document.getElementById("p-cost").value || "") || null,
    avg_cost_per_m3: Number(document.getElementById("p-avg-cost").value || "") || null,
    sell_price_per_m3: Number(document.getElementById("p-sell").value || "") || null,
    min_stock_m3: Number(document.getElementById("p-min").value || "") || null,
    supplier_name: document.getElementById("p-supplier").value.trim() || null,
    notes: document.getElementById("p-notes").value.trim() || null,
  };
  if (!payload.sku || !payload.name) {
    document.getElementById("p-sku")?.classList.toggle("input-invalid", !payload.sku);
    document.getElementById("p-name")?.classList.toggle("input-invalid", !payload.name);
    return toast("Preencha SKU e Nome.", null, "error");
  }
  document.getElementById("p-sku")?.classList.remove("input-invalid");
  document.getElementById("p-name")?.classList.remove("input-invalid");

  const saveBtn = document.getElementById("btn-save-product");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvando…"; }
  try {
    if (_editingProductId) {
      await api(`/api/products/${_editingProductId}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Produto atualizado.", null, "success");
    } else {
      await api("/api/products", { method: "POST", body: JSON.stringify(payload) });
      toast("Produto salvo.", null, "success");
    }
    _editingProductId = null;
    const titleEl = document.getElementById("modal-product-title");
    if (titleEl) titleEl.textContent = "Novo Produto";
    closeModal("modal-product");
    await loadProducts();
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i data-lucide="save"></i>Salvar Produto'; }
  }
}

async function deleteProduct(id) {
  const p = (state.products || []).find((x) => x.id === id);
  const ok = await confirmDialog("Excluir produto?", `"${p?.name || id}" será removido permanentemente.`);
  if (!ok) return;
  await api(`/api/products/${id}`, { method: "DELETE" });
  toast("Produto excluído.", null, "success");
  await loadProducts();
}

export async function deleteSelectedProducts() {
  if (selected.size === 0) return;
  const ok = await confirmDialog("Excluir produtos em lote?", `${selected.size} produto(s) serão removidos permanentemente.`);
  if (!ok) return;
  const result = await api("/api/products/batch-delete", {
    method: "POST",
    body: JSON.stringify(Array.from(selected)),
  });
  toast(`${result.deleted || 0} produto(s) removido(s).`, null, "success");
  await loadProducts();
}

export function clearProductSelection() {
  selected.clear();
  document.querySelectorAll(".product-check").forEach((c) => { c.checked = false; });
  renderBatchBar();
}

export function applyProductFilters() {
  const payload = {
    q: document.getElementById("filter-q").value || "",
    category: document.getElementById("filter-category").value || "",
    stock: document.getElementById("filter-stock").value || "",
  };
  localStorage.setItem("rl_filters", JSON.stringify(payload));
  state.pagination.productPage = 1;
  loadProducts().catch((e) => toast(String(e)));
}

export function resetProductFilters() {
  document.getElementById("filter-q").value = "";
  document.getElementById("filter-category").value = "";
  document.getElementById("filter-stock").value = "";
  localStorage.removeItem("rl_filters");
  state.pagination.productPage = 1;
  loadProducts().catch((e) => toast(String(e)));
}

function renderProductPagination() {
  const maxPage = Math.max(1, Math.ceil(state.pagination.productTotal / state.pagination.productPageSize));
  if (state.pagination.productPage > maxPage) state.pagination.productPage = maxPage;
  const start = state.pagination.productTotal === 0 ? 0 : ((state.pagination.productPage - 1) * state.pagination.productPageSize + 1);
  const end = Math.min(state.pagination.productPage * state.pagination.productPageSize, state.pagination.productTotal);
  const container = document.getElementById("products-pagination");
  container.innerHTML = `
    <div>Mostrando ${start}–${end} de ${state.pagination.productTotal}</div>
    <div class="pagination-actions">
      <select id="products-page-size">
        <option value="8" ${state.pagination.productPageSize === 8 ? "selected" : ""}>8 / página</option>
        <option value="12" ${state.pagination.productPageSize === 12 ? "selected" : ""}>12 / página</option>
        <option value="20" ${state.pagination.productPageSize === 20 ? "selected" : ""}>20 / página</option>
      </select>
      <button class="btn" id="products-prev" ${state.pagination.productPage <= 1 ? "disabled" : ""}>Anterior</button>
      <span>Página ${state.pagination.productPage} / ${maxPage}</span>
      <button class="btn" id="products-next" ${state.pagination.productPage >= maxPage ? "disabled" : ""}>Próxima</button>
    </div>
  `;
  document.getElementById("products-page-size").addEventListener("change", (e) => {
    state.pagination.productPageSize = Number(e.target.value);
    localStorage.setItem("rl_page_size", String(state.pagination.productPageSize));
    state.pagination.productPage = 1;
    loadProducts().catch((err) => toast(String(err)));
  });
  document.getElementById("products-prev").addEventListener("click", () => {
    state.pagination.productPage -= 1;
    loadProducts().catch((err) => toast(String(err)));
  });
  document.getElementById("products-next").addEventListener("click", () => {
    state.pagination.productPage += 1;
    loadProducts().catch((err) => toast(String(err)));
  });
}

