import { initIcons, navigate, openModal, closeModal, toast, wireGlobalUI } from "./ui.js";

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
import {
  applyProductFilters,
  clearProductSelection,
  deleteSelectedProducts,
  loadProducts,
  resetProductFilters,
  saveProduct,
} from "./products.js";
import { loadMovements, saveMovement, bindMovementFilters } from "./movements.js";
import {
  applyFinanceFilters,
  batchSettleSelected,
  batchReconcileSelected,
  clearFinanceSelection,
  exportFinanceCsv,
  loadFinanceEntries,
  loadFinanceMeta,
  resetFinanceFilters,
  saveFinancialEntry,
  selectFinancePage,
} from "./finance.js";
import {
  loadOrders,
  saveOrder,
  openOrderModalPrep,
  openEditOrder,
  addOrderLineRow,
  batchApproveOrders,
  exportOrdersCsv,
  printOrdersTable,
  recalcOrderModalTotals,
  selectDraftsOnCurrentPage,
  selectAllDraftsMatchingFilter,
  clearOrderSelection,
} from "./orders.js";
import { loadDashboard, refreshDashboardTheme } from "./dashboard.js";
import { api, downloadText, fetchAuthStatus } from "./api.js";
import { loadParties, openNewParty, saveParty } from "./parties.js";
import { loadReports, exportReportsCsv } from "./reports.js";

const tabs = {
  dashboard: "Dashboard",
  estoque: "Estoque",
  movimentacao: "Movimentações",
  financeiro: "Financeiro",
  pedidos: "Pedidos",
  cadastros: "Cadastros",
  relatorios: "Relatórios",
};

async function refreshCurrentTab() {
  const active = document.querySelector(".tab.active")?.id?.replace("tab-", "") || "dashboard";
  if (active === "dashboard") await loadDashboard();
  if (active === "estoque") await loadProducts();
  if (active === "movimentacao") await loadMovements();
  if (active === "financeiro") await loadFinanceEntries();
  if (active === "pedidos") await loadOrders();
  if (active === "relatorios") await loadReports();
}

async function systemHealth() {
  const res = await api("/api/system/health");
  toast(
    "API em funcionamento.",
    `produtos: ${res.products}\nmovimentações: ${res.movements}\nfinanceiro: ${res.financial_entries}\ncadastros: ${res.parties ?? "—"}`,
    "success",
  );
}

async function systemBackup() {
  const res = await api("/api/system/backup", { method: "POST" });
  toast(`Backup criado: ${res.file || res.backup_path || "ok"}`);
}

async function loadDemo() {
  if (!confirm("Recarregar base DEMO em volume alto? Substituir dados atuais.")) return;
  const r = await api("/api/dev/load-mock", { method: "POST" });
  toast(`Demo OK: ${r.products} SKU, ${r.movements} mov., ${r.financial_entries} fin., ${r.orders} pedidos.`);
  await Promise.all([loadDashboard(), loadProducts(), loadParties(), loadOrders(), loadMovements(), loadFinanceEntries()]);
}

async function exportProductsCsv() {
  const csv = await downloadText("/api/products/export.csv");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "estoques-empresa-exemplo.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function applyViewPrefs() {
  const theme = localStorage.getItem("rl_theme") || "light";
  const density = localStorage.getItem("rl_density") || "comfortable";
  document.body.classList.toggle("dark", theme === "dark");
  document.body.classList.toggle("dense", density === "compact");
}

async function toggleTheme() {
  const current = localStorage.getItem("rl_theme") || "light";
  const next = current === "light" ? "dark" : "light";
  localStorage.setItem("rl_theme", next);
  applyViewPrefs();
  refreshDashboardTheme();
  await loadDashboard();
  initIcons();
  toast(next === "dark" ? "Tema escuro ativado." : "Tema claro ativado.");
}

function toggleDensity() {
  const current = localStorage.getItem("rl_density") || "comfortable";
  const next = current === "comfortable" ? "compact" : "comfortable";
  localStorage.setItem("rl_density", next);
  applyViewPrefs();
  toast(next === "compact" ? "Densidade compacta." : "Densidade confortável.");
}

/** Onboarding + dicas rápidas (API key opcional no browser) */
let obStep = 0;
const OB_TOTAL = 4;

function syncOnboardingUi() {
  const body = document.getElementById("ob-body");
  const prev = document.getElementById("btn-ob-prev");
  const stepEl = document.getElementById("ob-step");
  prev.disabled = obStep === 0;
  stepEl.textContent = `Passo ${obStep + 1} de ${OB_TOTAL}`;
  if (obStep === 0) {
    body.innerHTML =
      '<p>Use <strong>ERP_API_KEY</strong> no servidor para proteção. Informe aqui apenas se sua instância exigir chave:</p>' +
      '<input id="ob-api-key" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);" placeholder="X-API-Key opcional">';
    document.getElementById("ob-api-key").value = localStorage.getItem("erp_api_key") || "";
  } else if (obStep === 1) {
    body.innerHTML =
      "<p>Os gráficos e tabelas usam filtros salvos neste navegador. Você também pode usar <strong>Demo</strong> no topo para recarregar cenário em volume.</p>";
  } else if (obStep === 2) {
    body.innerHTML =
      "<p><strong>Atalhos:</strong> <kbd>Ctrl+K</kbd> na busca global (com debounce). Tabelas têm cabeçalhos fixos ao rolar, paginação no servidor em pedidos e financeiro, e totais ao vivo no modal de pedido.</p>";
  } else {
    body.innerHTML =
      '<p>Em <strong>Pedidos</strong>, use &quot;Selecionar página&quot; ou &quot;Todos os rascunhos do filtro&quot; para aprovação em lote. No <strong>Financeiro</strong>, seleção persiste entre páginas.</p>' +
      '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;"><input type="checkbox" id="ob-skip-next"> não mostrar de novo</label>';
  }
}

function onboardingNext() {
  if (obStep === 0) {
    const k = document.getElementById("ob-api-key")?.value.trim() || "";
    if (k) localStorage.setItem("erp_api_key", k);
    else localStorage.removeItem("erp_api_key");
  }
  if (obStep === OB_TOTAL - 1) {
    if (document.getElementById("ob-skip-next")?.checked) localStorage.setItem("rl_onboarding_done", "1");
    closeModal("modal-onboarding");
    obStep = 0;
    return;
  }
  obStep++;
  syncOnboardingUi();
}

function maybeOpenOnboarding() {
  if (localStorage.getItem("rl_onboarding_done")) return;
  obStep = 0;
  openModal("modal-onboarding");
  syncOnboardingUi();
}

function bindNav() {
  document.querySelectorAll(".nav-item[data-tab]").forEach((nav) => {
    nav.addEventListener("click", async () => {
      const tab = nav.dataset.tab;
      navigate(tab, tabs);
      await refreshCurrentTab();
      initIcons();
    });
  });
}

function bindActions() {
  document.getElementById("btn-new-product").addEventListener("click", () => openModal("modal-product"));
  document.getElementById("btn-save-product").addEventListener("click", () => saveProduct().catch((e) => toast(String(e))));
  document.getElementById("btn-product-filter").addEventListener("click", applyProductFilters);
  document.getElementById("btn-product-reset").addEventListener("click", resetProductFilters);
  document.getElementById("btn-products-export").addEventListener("click", () => exportProductsCsv().catch((e) => toast(String(e))));
  document.getElementById("btn-product-delete-selected").addEventListener("click", () => deleteSelectedProducts().catch((e) => toast(String(e))));
  document.getElementById("btn-product-clear-selection").addEventListener("click", clearProductSelection);

  document.getElementById("btn-new-movement").addEventListener("click", () => openModal("modal-movement"));
  document.getElementById("btn-save-movement").addEventListener("click", () => saveMovement().catch((e) => toast(String(e))));
  bindMovementFilters();

  document.getElementById("btn-new-finance").addEventListener("click", () => {
    // reset modal to "new" mode
    const titleEl = document.getElementById("modal-finance-title");
    if (titleEl) titleEl.textContent = "Novo Lançamento Financeiro";
    ["f-type","f-due","f-description","f-party","f-category","f-amount","f-status","f-notes"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = el.tagName === "SELECT" ? el.options[0]?.value || "" : "";
    });
    openModal("modal-finance");
  });
  document.getElementById("btn-save-finance").addEventListener("click", () => saveFinancialEntry().catch((e) => toast(String(e))));
  document.getElementById("btn-finance-filter").addEventListener("click", applyFinanceFilters);
  document.getElementById("btn-finance-reset").addEventListener("click", resetFinanceFilters);
  document.getElementById("btn-finance-batch-pay").addEventListener("click", () => batchSettleSelected().catch((e) => toast(String(e))));
  document.getElementById("btn-finance-batch-reconcile").addEventListener("click", () => batchReconcileSelected().catch((e) => toast(String(e))));
  document.getElementById("btn-finance-clear-selection").addEventListener("click", clearFinanceSelection);
  document.getElementById("btn-finance-select-page")?.addEventListener("click", () => {
    selectFinancePage();
    initIcons();
  });
  document.getElementById("btn-finance-export").addEventListener("click", () => exportFinanceCsv().catch((e) => toast(String(e))));

  document.getElementById("btn-new-order").addEventListener("click", () => {
    // reset edit mode
    const titleEl = document.getElementById("modal-order-title");
    if (titleEl) titleEl.textContent = "Novo Pedido";
    openModal("modal-order");
    openOrderModalPrep().catch((e) => toast(String(e)));
    initIcons();
  });
  document.getElementById("btn-order-line-add").addEventListener("click", () => addOrderLineRow());
  document.getElementById("btn-save-order").addEventListener("click", () => saveOrder().catch((e) => toast(String(e))));
  document.getElementById("btn-order-filter").addEventListener("click", () =>
    loadOrders({ resetSelection: true }).catch((e) => toast(String(e))),
  );
  document.getElementById("btn-orders-select-page")?.addEventListener("click", () => {
    selectDraftsOnCurrentPage();
    initIcons();
  });
  document.getElementById("btn-orders-select-all-filtered")?.addEventListener("click", () =>
    selectAllDraftsMatchingFilter().catch((e) => toast(String(e))),
  );
  document.getElementById("btn-orders-clear-selection")?.addEventListener("click", () => {
    clearOrderSelection();
    initIcons();
  });
  document.getElementById("modal-order")?.addEventListener("input", (e) => {
    if (e.target.closest("#order-lines-tbody") || e.target.id === "o-discount-order") recalcOrderModalTotals();
  });
  document.getElementById("btn-orders-export").addEventListener("click", () => exportOrdersCsv().catch((e) => toast(String(e))));
  document.getElementById("btn-orders-print").addEventListener("click", printOrdersTable);
  document.getElementById("btn-orders-batch-approve").addEventListener("click", () => batchApproveOrders().catch((e) => toast(String(e))));

  document.getElementById("btn-rpt-export")?.addEventListener("click", () => exportReportsCsv().catch((e) => toast(String(e))));
  document.getElementById("btn-new-party").addEventListener("click", openNewParty);
  document.getElementById("btn-save-party").addEventListener("click", () => saveParty().catch((e) => toast(String(e))));
  document.getElementById("btn-party-filter").addEventListener("click", () => loadParties().catch((e) => toast(String(e))));

  document.getElementById("btn-health").addEventListener("click", () => systemHealth().catch((e) => toast(String(e))));
  document.getElementById("btn-backup").addEventListener("click", () => systemBackup().catch((e) => toast(String(e))));
  document.getElementById("btn-demo").addEventListener("click", () => loadDemo().catch((e) => toast(String(e))));
  document.getElementById("btn-theme").addEventListener("click", () => toggleTheme().catch((e) => toast(String(e))));
  document.getElementById("btn-density").addEventListener("click", toggleDensity);
  document.getElementById("btn-refresh").addEventListener("click", () => refreshCurrentTab().catch((e) => toast(String(e))));
  document.getElementById("btn-cashflow-refresh").addEventListener("click", () => loadDashboard().catch((e) => toast(String(e))));
  document.getElementById("cashflow-granularity").addEventListener("change", () => loadDashboard().catch(() => {}));

  document.getElementById("btn-ob-next").addEventListener("click", onboardingNext);
  document.getElementById("btn-ob-prev").addEventListener("click", () => {
    if (obStep > 0) {
      obStep--;
      syncOnboardingUi();
    }
  });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.closeModal;
      closeModal(id);
      // Reset order edit state when modal is dismissed without saving
      if (id === "modal-order") openOrderModalPrep().catch(() => {});
    });
  });

  // ── Global search: filters current tab + calls /api/search for cross-module results (#9)
  let _searchResultsEl = null;
  function _getSearchResults() {
    if (_searchResultsEl) return _searchResultsEl;
    _searchResultsEl = document.createElement("div");
    _searchResultsEl.id = "global-search-results";
    _searchResultsEl.className = "search-results";
    document.querySelector(".search")?.appendChild(_searchResultsEl);
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search")) _searchResultsEl.classList.remove("open");
    });
    return _searchResultsEl;
  }

  const runGlobalSearch = async () => {
    const input = document.getElementById("global-search");
    const text = String(input?.value || "").trim();
    const resultsEl = _getSearchResults();

    // Filter current tab
    if (document.getElementById("tab-estoque").classList.contains("active")) {
      document.getElementById("filter-q").value = text;
      applyProductFilters();
    }
    if (document.getElementById("tab-financeiro").classList.contains("active")) {
      document.getElementById("finance-q").value = text;
      applyFinanceFilters();
    }
    if (document.getElementById("tab-movimentacao").classList.contains("active")) {
      document.getElementById("mov-filter-q").value = text;
      const { loadMovements } = await import("./movements.js");
      loadMovements(1);
    }

    // Cross-module search via API
    if (text.length >= 2) {
      try {
        const results = await api(`/api/search?q=${encodeURIComponent(text)}`);
        resultsEl.innerHTML = "";
        const all = [
          ...(results.products || []).map(r => ({ ...r, _type: "Produto" })),
          ...(results.parties || []).map(r => ({ ...r, _type: "Cadastro" })),
          ...(results.orders || []).map(r => ({ ...r, _type: "Pedido" })),
        ].slice(0, 8);
        if (!all.length) {
          resultsEl.innerHTML = `<div class="search-result-empty">Nenhum resultado para "${text}"</div>`;
        } else {
          all.forEach(r => {
            const div = document.createElement("div");
            div.className = "search-result-item";
            div.innerHTML = `<span class="search-result-type">${r._type}</span><span class="search-result-label">${r.name || r.order_code || r.sku || ""}</span>`;
            div.addEventListener("click", () => {
              resultsEl.classList.remove("open");
              input.value = "";
              const tabMap = { Produto: "estoque", Cadastro: "cadastros", Pedido: "pedidos" };
              const tab = tabMap[r._type] || "dashboard";
              navigate(tab, tabs);
              refreshCurrentTab().then(() => initIcons());
            });
            resultsEl.appendChild(div);
          });
        }
        resultsEl.classList.add("open");
      } catch { /* silently skip search errors */ }
    } else {
      resultsEl.classList.remove("open");
    }
  };
  const debouncedSearch = debounce(runGlobalSearch, 380);
  document.getElementById("global-search").addEventListener("input", debouncedSearch);
  document.getElementById("global-search").addEventListener("focus", () => {
    if (document.getElementById("global-search").value.length >= 2) runGlobalSearch();
  });

  document.getElementById("breadcrumb")?.addEventListener("click", (e) => {
    const a = e.target.closest("[data-bc-tab]");
    if (!a) return;
    e.preventDefault();
    const tab = a.dataset.bcTab;
    if (!tab) return;
    navigate(tab, tabs);
    refreshCurrentTab().then(() => initIcons()).catch((err) => toast(String(err)));
  });

  document.querySelectorAll(".mobile-nav-item[data-tab]").forEach((el) => {
    el.addEventListener("click", async () => {
      const tab = el.dataset.tab;
      navigate(tab, tabs);
      await refreshCurrentTab();
      initIcons();
    });
  });
  document.getElementById("sidebar-toggle")?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });
}

async function boot() {
  applyViewPrefs();
  wireGlobalUI();
  bindNav();
  bindActions();
  fetchAuthStatus().then((s) => {
    localStorage.removeItem("erp_api_key_optional");
    if (s.api_key_required && !localStorage.getItem("erp_api_key")) {
      toast("Configure X-API-Key (onboarding ou localStorage erp_api_key).");
    }
  }).catch(() => {});
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("m-date").value = today;
  document.getElementById("f-due").value = today;
  document.getElementById("o-date").value = today;
  navigate("dashboard", tabs);
  await loadFinanceMeta();
  await Promise.all([loadDashboard(), loadProducts(), loadParties(), loadMovements(), loadFinanceEntries(), loadOrders()]);
  initIcons();
  maybeOpenOnboarding();
}

boot().catch((error) => {
  toast(`Erro ao iniciar: ${error.message || error}`);
});


