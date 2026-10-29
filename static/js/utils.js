export function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function toBRDate(isoDate) {
  if (!isoDate) return "—";
  return String(isoDate).slice(0, 10).split("-").reverse().join("/");
}

export function stockLevel(product) {
  const qty = Number(product.qty_m3 || 0);
  const min = Number(product.min_stock_m3 || 0);
  if (min > 0 && qty < min) return "critical";
  if (min > 0 && qty < min * 1.3) return "warning";
  return "normal";
}

export function stockTag(level) {
  if (level === "critical") return '<span class="tag tag-danger">Crítico</span>';
  if (level === "warning") return '<span class="tag tag-warning">Atenção</span>';
  return '<span class="tag tag-success">Normal</span>';
}

export function escHtml(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}


