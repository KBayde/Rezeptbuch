import {
  listShoppingListItems,
  addShoppingListItem,
  toggleShoppingListItem,
  deleteShoppingListItem,
  clearCheckedShoppingListItems,
} from "./db.js";
import { escapeHtml, formatQuantity } from "./utils.js";

export async function renderShoppingList(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Einkaufsliste</h1>
        <p class="text-muted" id="shopping-count"></p>
      </div>
      <a href="#/wochenplan" class="btn btn-secondary">← Zum Wochenplan</a>
    </div>

    <form id="add-item-form" class="toolbar">
      <input type="text" id="add-item-input" class="search-input" placeholder="Weiteres Element hinzufügen…" />
      <button type="submit" class="btn btn-primary">+ Hinzufügen</button>
    </form>

    <ul id="shopping-items" class="shopping-list"></ul>
    <p id="shopping-empty" class="empty-state" hidden>Deine Einkaufsliste ist leer.</p>

    <div class="week-footer">
      <button id="clear-checked-btn" class="btn btn-secondary" type="button">Erledigte entfernen</button>
    </div>
  `;

  const list = container.querySelector("#shopping-items");
  const emptyState = container.querySelector("#shopping-empty");
  const countEl = container.querySelector("#shopping-count");
  const form = container.querySelector("#add-item-form");
  const input = container.querySelector("#add-item-input");

  function itemHtml(item) {
    const qtyLabel =
      item.quantity !== null
        ? `${formatQuantity(item.quantity)}${item.unit ? " " + escapeHtml(item.unit) : ""}`
        : item.unit
        ? escapeHtml(item.unit)
        : "";
    return `
      <li class="shopping-item ${item.checked ? "shopping-item--checked" : ""}" data-item-id="${item.id}">
        <label class="shopping-item-label">
          <input
            type="checkbox" class="shopping-item-checkbox"
            data-item-id="${item.id}" ${item.checked ? "checked" : ""}
          />
          <span class="shopping-item-qty">${qtyLabel}</span>
          <span class="shopping-item-name">${escapeHtml(item.name)}</span>
        </label>
        <button class="row-remove shopping-item-remove" data-item-id="${item.id}" title="Entfernen" type="button">×</button>
      </li>
    `;
  }

  function wireItems() {
    list.querySelectorAll(".shopping-item-checkbox").forEach((cb) => {
      cb.addEventListener("change", async () => {
        try {
          await toggleShoppingListItem(cb.dataset.itemId, cb.checked);
          await load();
        } catch (err) {
          alert("Konnte nicht speichern: " + err.message);
        }
      });
    });
    list.querySelectorAll(".shopping-item-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await deleteShoppingListItem(btn.dataset.itemId);
          await load();
        } catch (err) {
          alert("Konnte nicht entfernen: " + err.message);
          btn.disabled = false;
        }
      });
    });
  }

  async function load() {
    list.innerHTML = `<p class="text-muted">Lade…</p>`;
    let items = [];
    try {
      items = await listShoppingListItems();
    } catch (err) {
      list.innerHTML = `<p class="form-error">Liste konnte nicht geladen werden: ${escapeHtml(
        err.message
      )}</p>`;
      return;
    }

    const openCount = items.filter((i) => !i.checked).length;
    countEl.textContent = items.length ? `${openCount} offen von ${items.length}` : "";
    emptyState.hidden = items.length > 0;

    list.innerHTML = items.map(itemHtml).join("");
    wireItems();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    try {
      await addShoppingListItem(name);
      input.value = "";
      await load();
    } catch (err) {
      alert("Konnte nicht hinzufügen: " + err.message);
    }
  });

  container.querySelector("#clear-checked-btn").addEventListener("click", async () => {
    try {
      await clearCheckedShoppingListItems();
      await load();
    } catch (err) {
      alert("Konnte nicht entfernen: " + err.message);
    }
  });

  await load();
}
