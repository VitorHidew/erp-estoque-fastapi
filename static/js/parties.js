import { api } from "./api.js";
import { state } from "./state.js";
import { toast, closeModal, openModal } from "./ui.js";
import { confirmDialog } from "./confirm.js";

export async function loadParties() {
  const kindEl = document.getElementById("party-filter-kind");
  const qEl = document.getElementById("party-filter-q");
  const params = new URLSearchParams();
  if (kindEl?.value) params.set("kind", kindEl.value);
  if (qEl?.value?.trim()) params.set("q", qEl.value.trim());
  state.parties = await api("/api/parties" + (params.toString() ? `?${params.toString()}` : ""));
  renderParties();
}

function renderParties() {
  const tbody = document.getElementById("parties-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!(state.parties || []).length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">
      <div class="empty-state-inner"><strong>Nenhum cadastro encontrado.</strong>
      <p class="muted">Filtre por tipo ou cadastre clientes e fornecedores.</p>
      <button type="button" class="btn btn-primary" id="empty-new-party">Novo cadastro</button></div></td></tr>`;
    document.getElementById("empty-new-party")?.addEventListener("click", () => {
      document.getElementById("btn-new-party")?.click();
    });
    return;
  }
  for (const p of state.parties || []) {
    const tr = document.createElement("tr");
    const tag =
      p.kind === "Cliente"
        ? '<span class="tag tag-success">Cliente</span>'
        : '<span class="tag tag-muted">Fornecedor</span>';
    tr.innerHTML = `
      <td data-label="Tipo">${tag}</td>
      <td data-label="Nome">${p.name}</td>
      <td data-label="Documento" class="mono">${p.document || "—"}</td>
      <td data-label="Telefone">${p.phone || "—"}</td>
      <td data-label="E-mail">${p.email || "—"}</td>
      <td data-label="">
        <button type="button" class="btn" data-edit-party="${p.id}">Editar</button>
        <button type="button" class="btn btn-danger" data-delete-party="${p.id}" style="margin-left:4px">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  document.querySelectorAll("[data-edit-party]").forEach((btn) => {
    btn.addEventListener("click", () => openEditParty(Number(btn.dataset.editParty)));
  });
  document.querySelectorAll("[data-delete-party]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.deleteParty);
      const p = (state.parties || []).find((x) => x.id === id);
      const ok = await confirmDialog("Excluir cadastro?", `"${p?.name}" será removido permanentemente.`, "danger");
      if (!ok) return;
      await api(`/api/parties/${id}`, { method: "DELETE" });
      toast("Cadastro excluído.");
      await loadParties();
    });
  });
}

function openEditParty(id) {
  const p = (state.parties || []).find((x) => x.id === id);
  if (!p) return;
  document.getElementById("party-edit-id").value = String(p.id);
  document.getElementById("party-kind").value = p.kind;
  document.getElementById("party-name").value = p.name;
  document.getElementById("party-doc").value = p.document || "";
  document.getElementById("party-phone").value = p.phone || "";
  document.getElementById("party-email").value = p.email || "";
  document.getElementById("party-notes").value = p.notes || "";
  document.getElementById("party-modal-title").textContent = "Editar cadastro";
  openModal("modal-party");
}

export function openNewParty() {
  document.getElementById("party-edit-id").value = "";
  document.getElementById("party-kind").value = "Cliente";
  document.getElementById("party-name").value = "";
  document.getElementById("party-doc").value = "";
  document.getElementById("party-phone").value = "";
  document.getElementById("party-email").value = "";
  document.getElementById("party-notes").value = "";
  document.getElementById("party-modal-title").textContent = "Novo cliente / fornecedor";
  openModal("modal-party");
}

export async function saveParty() {
  const id = document.getElementById("party-edit-id").value;
  const payload = {
    kind: document.getElementById("party-kind").value,
    name: document.getElementById("party-name").value.trim(),
    document: document.getElementById("party-doc").value.trim() || null,
    phone: document.getElementById("party-phone").value.trim() || null,
    email: document.getElementById("party-email").value.trim() || null,
    notes: document.getElementById("party-notes").value.trim() || null,
  };
  if (!payload.name) return toast("Informe o nome.");
  if (id) {
    await api(`/api/parties/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    toast("Cadastro atualizado.");
  } else {
    await api("/api/parties", { method: "POST", body: JSON.stringify(payload) });
    toast("Cadastro criado.");
  }
  closeModal("modal-party");
  await loadParties();
}

export async function fillPartySelectForOrders() {
  const sel = document.getElementById("o-party-select");
  if (!sel) return;
  const cur = sel.value;
  const list = await api("/api/parties");
  sel.innerHTML = '<option value="">— digitar manualmente —</option>';
  for (const p of list) {
    const o = document.createElement("option");
    o.value = String(p.id);
    o.textContent = `${p.name} (${p.kind})`;
    o.dataset.name = p.name;
    sel.appendChild(o);
  }
  sel.value = cur;
}

