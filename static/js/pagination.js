/**
 * Renders a simple pagination control into a container element.
 * @param {string} containerId - ID of the container element
 * @param {number} total - Total number of records
 * @param {number} page - Current page (1-indexed)
 * @param {number} pageSize - Records per page
 * @param {function} onPage - Callback called with the new page number
 */
export function buildPagination(containerId, total, page, pageSize, onPage) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  if (maxPage <= 1 && total === 0) { container.innerHTML = ""; return; }
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  container.innerHTML = `
    <div class="pagination-actions">
      <span class="pagination-info">${start}–${end} de ${total}</span>
      <button class="btn" id="${containerId}-prev" ${page <= 1 ? "disabled" : ""}>‹ Anterior</button>
      <span class="pagination-info">Página ${page} / ${maxPage}</span>
      <button class="btn" id="${containerId}-next" ${page >= maxPage ? "disabled" : ""}>Próximo ›</button>
    </div>
  `;
  document.getElementById(`${containerId}-prev`)?.addEventListener("click", () => onPage(page - 1));
  document.getElementById(`${containerId}-next`)?.addEventListener("click", () => onPage(page + 1));
}

