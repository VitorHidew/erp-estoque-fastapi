import { api } from "./api.js";
import { fmt } from "./utils.js";

let categoriesChart = null;
let financeChart = null;

export async function loadDashboard() {
  const pageSize = 100;
  const [products, movResult, financeSummary, ordersResult] = await Promise.all([
    api(`/api/products?page=1&page_size=${pageSize}`),
    api("/api/movements?page=1&page_size=1"),
    api("/api/finance/summary"),
    api("/api/orders?page=1&page_size=200"),
  ]);
  const productCount =
    products.total !== undefined ? Number(products.total) : (products.items || []).length;
  const movTotal = movResult.total !== undefined ? movResult.total : (movResult || []).length;
  const orders = ordersResult.items ?? ordersResult ?? [];
  const pendentes = orders.filter((o) => o.status === "Rascunho" || o.status === "Aprovado").length;
  const faturados = orders.filter((o) => o.status === "Faturado").length;
  document.getElementById("db-produtos").textContent = String(productCount);
  document.getElementById("db-movimentos").textContent = String(movTotal);
  document.getElementById("db-receber").textContent = `R$ ${fmt(financeSummary.receber_aberto || 0)}`;
  document.getElementById("db-pagar").textContent = `R$ ${fmt(financeSummary.pagar_aberto || 0)}`;
  document.getElementById("db-saldo").textContent = `R$ ${fmt(financeSummary.saldo_projetado || 0)}`;
  const elPendentes = document.getElementById("db-pedidos-pendentes");
  const elFaturados = document.getElementById("db-pedidos-faturados");
  if (elPendentes) elPendentes.textContent = String(pendentes);
  if (elFaturados) elFaturados.textContent = String(faturados);
  renderCharts(products.items || [], financeSummary);
  await renderCashflowTable();
}

let _cashflowChart = null;

async function renderCashflowChart(series) {
  const canvas = document.getElementById("chart-cashflow");
  if (!canvas) return;
  if (_cashflowChart) { _cashflowChart.destroy(); _cashflowChart = null; }
  const labels = series.map(s => s.period);
  const inData = series.map(s => s.entrada || 0);
  const outData = series.map(s => s.saida || 0);
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--chart-grid").trim() || "#eaecf4";
  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim() || "#6b7280";
  _cashflowChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Entradas", data: inData, borderColor: "#16a34a", backgroundColor: "rgba(22,163,74,.12)", tension: 0.35, fill: true, pointRadius: 3 },
        { label: "Saídas",   data: outData, borderColor: "#dc2626", backgroundColor: "rgba(220,38,38,.08)", tension: 0.35, fill: true, pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: textColor, usePointStyle: true, pointStyleWidth: 10 } },
        tooltip: { callbacks: { label: ctx => ` R$ ${Number(ctx.raw).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}` } },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor, maxRotation: 45 } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => "R$" + Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) } },
      },
    },
  });
}

export async function renderCashflowTable() {
  const box = document.getElementById("cashflow-body");
  if (!box) return;
  const g = document.getElementById("cashflow-granularity")?.value || "week";
  const data = await api(`/api/finance/cashflow?granularity=${encodeURIComponent(g)}`);
  renderCashflowChart(data.series || []).catch(() => {});
  const rows = (data.series || []).slice(-16);
  box.innerHTML =
    "<table><thead><tr><th>Período</th><th>Entradas</th><th>Saídas</th><th>Líquido</th></tr></thead><tbody>" +
    rows
      .map(
        (r) =>
          `<tr><td class="mono">${r.period}</td><td>R$ ${fmt(r.entrada)}</td><td>R$ ${fmt(r.saida)}</td><td>R$ ${fmt(r.liquido)}</td></tr>`,
      )
      .join("") +
    "</tbody></table>";
}

function chartPalette() {
  const dark = document.body.classList.contains("dark");
  return {
    text: dark ? "#dbe6ff" : "#223049",
    grid: dark ? "#2a3347" : "#eceff6",
    primary: "#5b4dff",
    ok: "#16a34a",
    warn: "#d97706",
    bad: "#dc2626",
  };
}

function renderCharts(products, financeSummary) {
  if (!window.Chart) return;
  const palette = chartPalette();
  const byCategory = {};
  for (const p of products) {
    const key = p.category || "Sem categoria";
    byCategory[key] = (byCategory[key] || 0) + 1;
  }
  const categoryLabels = Object.keys(byCategory);
  const categoryValues = Object.values(byCategory);

  if (categoriesChart) categoriesChart.destroy();
  categoriesChart = new window.Chart(document.getElementById("chart-categories"), {
    type: "doughnut",
    data: {
      labels: categoryLabels.length ? categoryLabels : ["Sem dados"],
      datasets: [{
        data: categoryValues.length ? categoryValues : [1],
        backgroundColor: ["#5b4dff", "#16a34a", "#d97706", "#dc2626", "#0ea5e9", "#a855f7"],
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: palette.text } } },
    },
  });

  if (financeChart) financeChart.destroy();
  financeChart = new window.Chart(document.getElementById("chart-finance"), {
    type: "bar",
    data: {
      labels: ["A Pagar", "A Receber", "Pago no Mês", "Inadimplência"],
      datasets: [{
        label: "R$",
        data: [
          Number(financeSummary.pagar_aberto || 0),
          Number(financeSummary.receber_aberto || 0),
          Number(financeSummary.pago_mes || 0),
          Number(financeSummary.inadimplencia_total || 0),
        ],
        backgroundColor: [palette.bad, palette.ok, palette.primary, palette.warn],
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { ticks: { color: palette.text }, grid: { color: palette.grid } },
        x: { ticks: { color: palette.text }, grid: { color: palette.grid } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

export function refreshDashboardTheme() {
  if (!categoriesChart || !financeChart) return;
  categoriesChart.destroy();
  financeChart.destroy();
  categoriesChart = null;
  financeChart = null;
  if (_cashflowChart) { _cashflowChart.destroy(); _cashflowChart = null; }
  renderCashflowTable().catch(() => {});
}


