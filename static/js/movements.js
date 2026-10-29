import { api } from "./api.js";
import { state } from "./state.js";
import { fmt, toBRDate } from "./utils.js";
import { closeModal, toast } from "./ui.js";
import { buildPagination } from "./pagination.js";

let movPage = 1;
const MOV_PAGE_SIZE = 25;

function getMovFilters() {
  return {
    q: document.getElementById("mov-filter-q")?.value.trim() || "",
    movement_type: document.getElementById("mov-filter-type")?.value || "",
    start_date: document.getElementById("mov-filter-start")?.value || "",
    end_date: document.getElementById("mov-filter-end")?.value || "",
  };
}

export async function loadMovements(page = movPage) {
  movPage = page;
  const panel = document.getElementById("panel-movements");
  panel?.classList.add("panel-loading");
  try {
    const f = getMovFilters();
    const params = new URLSearchParams({ page: String(page), page_size: String(MOV_PAGE_SIZE) });
    if (f.q) params.set("q", f.q);
    if (f.movement_type) params.set("movement_type", f.movement_type);
    if (f.start_date) params.set("start_date", f.start_date);
    if (f.end_date) params.set("end_date", f.end_date);
    const result = await api(`/api/movements?${params.toString()}`);
    const items = result.items ?? result;
    const total = result.total ?? items.length;
    state.movements = items;
    const tbody = document.getElementById("movements-tbody");
    tbody.innerHTML = "";
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="empty-state">
        <div class="empty-state-inner"><strong>Nenhuma movimentação encontrada.</strong>
        <p class="muted">Tente ajustar os filtros ou registre uma nova movimentação.</p>
        <button type="button" class="btn btn-primary" id="empty-new-movement">Nova movimentação</button></div></td></tr>`;
      document.getElementById("empty-new-movement")?.addEventListener("click", () => {
        document.getElementById("btn-new-movement")?.click();
      });
    } else {
      for (const m of items) {
        const tr = document.createElement("tr");
        const typeTag =
          m.movement_type === "Entrada"
            ? '<span class="tag tag-success">Entrada</span>'
            : m.movement_type === "Saída"
              ? '<span class="tag tag-danger">Saída</span>'
              : '<span class="tag tag-muted">Ajuste</span>';
        tr.innerHTML = `
          <td data-label="Data" class="mono">${toBRDate(m.movement_date)}</td>
          <td data-label="Tipo">${typeTag}</td>
          <td data-label="Doc" class="mono">${m.document_no || "—"}</td>
          <td data-label="SKU" class="mono">${m.product_sku}</td>
          <td data-label="Volume">${fmt(m.volume_m3)} m³</td>
          <td data-label="Unit." class="mono">${m.unit_value ? `R$ ${fmt(m.unit_value)}` : "—"}</td>
          <td data-label="Total" class="mono">${m.total_value ? `R$ ${fmt(m.total_value)}` : "—"}</td>
          <td data-label="Parte">${m.party_name || "—"}</td>
          <td data-label="NF">${m.nf_no || "—"}</td>
          <td data-label="Loc." class="mono">${m.warehouse_location_code || "—"}</td>
          <td data-label="Lote" class="mono">${m.batch_lot || "—"}</td>
        `;
        tbody.appendChild(tr);
      }
    }
    buildPagination("movements-pagination", total, page, MOV_PAGE_SIZE, loadMovements);
  } finally {
    panel?.classList.remove("panel-loading");
  }
}

export function bindMovementFilters() {
  document.getElementById("btn-mov-filter")?.addEventListener("click", () => loadMovements(1));
  document.getElementById("btn-mov-reset")?.addEventListener("click", () => {
    ["mov-filter-q", "mov-filter-start", "mov-filter-end"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const typeEl = document.getElementById("mov-filter-type");
    if (typeEl) typeEl.value = "";
    loadMovements(1);
  });
  // Auto-calc total when vol or unit changes
  ["m-vol", "m-unit"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => {
      const vol = parseFloat(document.getElementById("m-vol")?.value || "0") || 0;
      const unit = parseFloat(document.getElementById("m-unit")?.value || "0") || 0;
      const totalEl = document.getElementById("m-total");
      if (totalEl && vol > 0 && unit > 0) totalEl.value = (vol * unit).toFixed(2);
    });
  });
}

export async function saveMovement() {
  const payload = {
    movement_type: document.getElementById("m-type").value,
    movement_date: document.getElementById("m-date").value,
    document_no: document.getElementById("m-doc").value.trim() || null,
    product_sku: document.getElementById("m-sku").value.trim(),
    volume_m3: Number(document.getElementById("m-vol").value || 0),
    unit_value: Number(document.getElementById("m-unit").value || "") || null,
    total_value: Number(document.getElementById("m-total").value || "") || null,
    party_name: document.getElementById("m-party").value.trim() || null,
    nf_no: document.getElementById("m-nf").value.trim() || null,
    warehouse_location_code: document.getElementById("m-loc").value.trim() || null,
    batch_lot: document.getElementById("m-batch").value.trim() || null,
  };
  if (!payload.product_sku || payload.volume_m3 <= 0) {
    document.getElementById("m-sku")?.classList.toggle("input-invalid", !payload.product_sku);
    document.getElementById("m-vol")?.classList.toggle("input-invalid", payload.volume_m3 <= 0);
    return toast("Preencha SKU e volume.", null, "error");
  }
  document.getElementById("m-sku")?.classList.remove("input-invalid");
  document.getElementById("m-vol")?.classList.remove("input-invalid");
  await api("/api/movements", { method: "POST", body: JSON.stringify(payload) });
  closeModal("modal-movement");
  toast("Movimentação salva.");
  await loadMovements(1);
}

