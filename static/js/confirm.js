/**
 * confirm.js — modal de confirmação reutilizável.
 * Substitui window.confirm() nativo.
 */

let _resolveConfirm = null;

function getOrCreateOverlay() {
  let el = document.getElementById("confirm-overlay");
  if (el) return el;
  el = document.createElement("div");
  el.id = "confirm-overlay";
  el.className = "modal-overlay";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "confirm-title");
  el.innerHTML = `
    <div class="modal confirm-modal">
      <div class="modal-head">
        <div class="modal-title" id="confirm-title"></div>
      </div>
      <p id="confirm-body" class="confirm-body"></p>
      <div class="modal-actions">
        <button class="btn" id="confirm-cancel">Cancelar</button>
        <button class="btn btn-danger" id="confirm-ok">Confirmar</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  document.getElementById("confirm-cancel").addEventListener("click", () => _resolve(false));
  document.getElementById("confirm-ok").addEventListener("click", () => _resolve(true));
  el.addEventListener("click", (e) => { if (e.target === el) _resolve(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.classList.contains("open")) _resolve(false);
  });
  return el;
}

function _resolve(result) {
  const el = document.getElementById("confirm-overlay");
  el?.classList.remove("open");
  if (_resolveConfirm) {
    _resolveConfirm(result);
    _resolveConfirm = null;
  }
}

/**
 * @param {string} title
 * @param {string} body
 * @param {"danger"|"warning"} [variant]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(title, body, variant = "danger") {
  return new Promise((resolve) => {
    _resolveConfirm = resolve;
    const el = getOrCreateOverlay();
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-body").textContent = body;
    const okBtn = document.getElementById("confirm-ok");
    okBtn.className = `btn ${variant === "warning" ? "btn-warning" : "btn-danger"}`;
    okBtn.textContent = variant === "warning" ? "Confirmar" : "Excluir";
    el.classList.add("open");
    // Focus the cancel button by default (safer UX)
    setTimeout(() => document.getElementById("confirm-cancel")?.focus(), 50);
  });
}

