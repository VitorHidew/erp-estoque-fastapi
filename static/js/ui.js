const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let lastFocusEl = null;
let modalKeyHandler = null;

function getOpenModal() {
  return document.querySelector(".modal-overlay.open .modal");
}

function trapModalKeydown(event) {
  const modal = getOpenModal();
  if (!modal || event.key !== "Tab") return;
  const nodes = Array.from(modal.querySelectorAll(FOCUSABLE)).filter(
    (n) => !n.hasAttribute("disabled") && n.offsetParent !== null,
  );
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey) {
    if (document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  } else if (document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusFirstInModal(modal) {
  const first = modal.querySelector(FOCUSABLE);
  if (first) first.focus();
}

export function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  lastFocusEl = document.activeElement;
  overlay.classList.add("open");
  const modal = overlay.querySelector(".modal");
  if (modal) {
    requestAnimationFrame(() => focusFirstInModal(modal));
  }
  if (!modalKeyHandler) {
    modalKeyHandler = (e) => trapModalKeydown(e);
    document.addEventListener("keydown", modalKeyHandler);
  }
}

export function closeModal(id) {
  const overlay = document.getElementById(id);
  overlay?.classList.remove("open");
  clearModalFocusTrapIfDone();
  if (lastFocusEl && typeof lastFocusEl.focus === "function") {
    lastFocusEl.focus();
    lastFocusEl = null;
  }
}

// ── Toast queue (improvement #4) ────────────────────────────────────
let _toastStack = null;

function _getOrCreateStack() {
  if (_toastStack) return _toastStack;
  _toastStack = document.createElement("div");
  _toastStack.id = "toast-stack";
  _toastStack.className = "toast-stack";
  _toastStack.setAttribute("aria-live", "polite");
  _toastStack.setAttribute("aria-atomic", "false");
  document.body.appendChild(_toastStack);
  return _toastStack;
}

/** @param {string} message @param {string|null} [details] @param {"default"|"success"|"error"} [variant] */
export function toast(message, details = null, variant = "default") {
  const stack = _getOrCreateStack();
  const item = document.createElement("div");
  item.className = "toast-item" + (variant === "success" ? " toast-success" : variant === "error" ? " toast-error" : "");
  item.setAttribute("role", "status");

  const msg = document.createElement("div");
  msg.className = "toast-msg";
  msg.textContent = message;
  item.appendChild(msg);

  if (details) {
    const det = document.createElement("pre");
    det.className = "toast-details";
    det.hidden = true;
    det.textContent = details;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn toast-expand";
    btn.textContent = "Detalhes";
    btn.addEventListener("click", () => {
      det.hidden = !det.hidden;
      btn.textContent = det.hidden ? "Detalhes" : "Ocultar";
    });
    item.appendChild(btn);
    item.appendChild(det);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", "Fechar");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => _dismissToast(item));
  item.appendChild(closeBtn);

  stack.appendChild(item);
  requestAnimationFrame(() => item.classList.add("show"));

  const ttl = details ? 6000 : 3000;
  const timer = setTimeout(() => _dismissToast(item), ttl);
  item._timer = timer;
}

function _dismissToast(item) {
  clearTimeout(item._timer);
  item.classList.remove("show");
  item.addEventListener("transitionend", () => item.remove(), { once: true });
  setTimeout(() => item.remove(), 500);
}

export function navigate(tab, tabMap) {
  document.querySelectorAll(".tab").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".mobile-nav-item").forEach((el) => el.classList.remove("active"));
  document.getElementById(`tab-${tab}`)?.classList.add("active");
  const nav = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  nav?.classList.add("active");
  document.querySelector(`.mobile-nav-item[data-tab="${tab}"]`)?.classList.add("active");
  const title = tabMap[tab] || tab;
  const titleEl = document.getElementById("topbar-title");
  if (titleEl) titleEl.textContent = title;
  const bc = document.getElementById("breadcrumb");
  if (bc) {
    bc.innerHTML = `<a href="#" class="bc-link" data-bc-tab="dashboard" aria-label="Ir para Dashboard">Empresa Exemplo</a><span class="bc-sep" aria-hidden="true"> › </span><span class="bc-current" aria-current="page">${escapeHtml(
      title,
    )}</span>`;
  }
  document.body.classList.remove("sidebar-open");
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function clearModalFocusTrapIfDone() {
  const anyOpen = document.querySelector(".modal-overlay.open");
  if (!anyOpen && modalKeyHandler) {
    document.removeEventListener("keydown", modalKeyHandler);
    modalKeyHandler = null;
  }
}

export function wireGlobalUI() {
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        overlay.classList.remove("open");
        clearModalFocusTrapIfDone();
      }
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".modal-overlay.open").forEach((m) => m.classList.remove("open"));
      clearModalFocusTrapIfDone();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      const input = document.getElementById("global-search");
      input?.focus();
      input?.select();
    }
  });
}

export function initIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

