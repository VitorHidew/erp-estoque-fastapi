import { api } from "./api.js";
import { fmt } from "./utils.js";
import { toast } from "./ui.js";

export async function loadReports() {
  const panel = document.getElementById("report-kpis");
  panel?.classList.add("panel-loading");
  try {
    const [stockReport, salesReport] = await Promise.all([
      api("/api/reports/stock-critical"),
      api("/api/reports/sales-summary"),
    ]);

    // KPIs
    document.getElementById("rpt-stock-value").textContent = `R$ ${fmt(stockReport.total_stock_value || 0)}`;
    document.getElementById("rpt-critical").textContent = String(stockReport.critical?.length || 0);
    document.getElementById("rpt-warning").textContent = String(stockReport.warning?.length || 0);
    document.getElementById("rpt-sales-value").textContent = `R$ ${fmt(salesReport.faturado_sales_value || 0)}`;
    document.getElementById("rpt-pending").textContent = String(salesReport.pending_count || 0);

    // Stock critical table
    const stockTbody = document.getElementById("rpt-stock-tbody");
    if (stockTbody) {
      stockTbody.innerHTML = "";
      const critItems = [...(stockReport.critical || []), ...(stockReport.warning || [])];
      if (!critItems.length) {
        stockTbody.innerHTML = `<tr><td colspan="7" class="empty-state"><div class="empty-state-inner">✅ Nenhum item com estoque crítico ou em atenção.</div></td></tr>`;
      } else {
        for (const item of critItems) {
          const isCritical = (stockReport.critical || []).includes(item);
          const tag = isCritical
            ? '<span class="tag tag-danger">Crítico</span>'
            : '<span class="tag tag-warning">Atenção</span>';
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${tag}</td>
            <td class="mono">${item.sku}</td>
            <td>${item.name}</td>
            <td>${item.category}</td>
            <td class="mono">${fmt(item.qty_m3)} m³</td>
            <td class="mono">${fmt(item.min_stock_m3)} m³</td>
            <td class="mono">R$ ${fmt(item.stock_value)}</td>
          `;
          stockTbody.appendChild(tr);
        }
      }
    }

    // Top customers table with visual bars (#7)
    const custTbody = document.getElementById("rpt-customers-tbody");
    if (custTbody) {
      custTbody.innerHTML = "";
      const customers = salesReport.top_customers || [];
      if (!customers.length) {
        custTbody.innerHTML = `<tr><td colspan="3" class="empty-state"><div class="empty-state-inner">Nenhuma venda faturada ainda.</div></td></tr>`;
      } else {
        const maxVal = Math.max(...customers.map(c => c.total), 1);
        customers.forEach((c, i) => {
          const pct = Math.round((c.total / maxVal) * 100);
          const medals = ["🥇","🥈","🥉"];
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td style="width:28px;text-align:center">${medals[i] || (i+1)}</td>
            <td>
              <div>${c.name}</div>
              <div class="rpt-bar-wrap"><div class="rpt-bar" style="width:${pct}%"></div></div>
            </td>
            <td class="mono" style="white-space:nowrap">R$ ${fmt(c.total)}</td>
          `;
          custTbody.appendChild(tr);
        });
      }
    }
  } catch (e) {
    toast(`Erro ao carregar relatórios: ${e.message || e}`, null, "error");
  } finally {
    panel?.classList.remove("panel-loading");
  }
}

export async function exportReportsCsv() {
  const { downloadText } = await import("./api.js");
  const csv = await downloadText("/api/reports/export.csv");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "relatorio-estoque-empresa-exemplo.csv";
  a.click();
  URL.revokeObjectURL(url);
}


