import {
  listShoppingListItems,
  addShoppingListItem,
  toggleShoppingListItem,
  deleteShoppingListItem,
  clearCheckedShoppingListItems,
  addInventoryItem,
} from "./db.js";
import { escapeHtml, formatQuantity, categorizeIngredient, CATEGORY_ORDER } from "./utils.js";

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

    <div id="shopping-items" class="shopping-list"></div>
    <p id="shopping-empty" class="empty-state" hidden>Deine Einkaufsliste ist leer.</p>

    <div class="week-footer">
      <button id="move-checked-to-inventory-btn" class="btn btn-secondary" type="button">→ Erledigte in Vorrat übernehmen</button>
      <button id="clear-checked-btn" class="btn btn-secondary" type="button">Erledigte entfernen</button>
    </div>
  `;

  const list = container.querySelector("#shopping-items");
  const emptyState = container.querySelector("#shopping-empty");
  const countEl = container.querySelector("#shopping-count");
  const form = container.querySelector("#add-item-form");
  const input = container.querySelector("#add-item-input");
  const moveCheckedBtn = container.querySelector("#move-checked-to-inventory-btn");
  const clearCheckedBtn = container.querySelector("#clear-checked-btn");

  // Zuletzt geladene Posten, damit die "In Vorrat übernehmen"-Mini-Formulare
  // ohne erneuten Serverzugriff auf Name/Menge/Einheit des Postens zugreifen
  // können (siehe wireItems()).
  let currentItems = [];

  function itemHtml(item) {
    const cat = categorizeIngredient(item.name);
    const qtyLabel =
      item.quantity !== null
        ? `${formatQuantity(item.quantity)}${item.unit ? " " + escapeHtml(item.unit) : ""}`
        : item.unit
        ? escapeHtml(item.unit)
        : "";
    // Nur bereits abgehakte (= gekaufte) Posten lassen sich in den Vorrat
    // übernehmen. Als Menge/Einheit wird nur eine "echte" Einheit
    // vorbelegt, kein zusammengesetzter Text wie "2 TL + nach Geschmack".
    const toInventoryBtn = item.checked
      ? `<button class="btn btn-secondary btn-small shopping-item-to-inventory" data-item-id="${item.id}" type="button">→ Vorrat</button>`
      : "";
    const prefillQty = item.quantity !== null ? item.quantity : "";
    const prefillUnit = item.quantity !== null && item.unit && !item.unit.includes(" ") ? item.unit : "";

    return `
      <li class="shopping-item ${item.checked ? "shopping-item--checked" : ""}" data-item-id="${item.id}">
        <div class="shopping-item-row">
          <span class="shopping-item-icon" title="${escapeHtml(cat.label)}">${cat.icon}</span>
          <label class="shopping-item-label">
            <input
              type="checkbox" class="shopping-item-checkbox"
              data-item-id="${item.id}" ${item.checked ? "checked" : ""}
            />
            <span class="shopping-item-qty">${qtyLabel}</span>
            <span class="shopping-item-name">${escapeHtml(item.name)}</span>
          </label>
          <div class="shopping-item-actions">
            ${toInventoryBtn}
            <button class="row-remove shopping-item-remove" data-item-id="${item.id}" title="Entfernen" type="button">×</button>
          </div>
        </div>
        <form class="inventory-quick-add" data-item-id="${item.id}" hidden>
          <input type="number" step="any" min="0" class="qa-quantity" placeholder="Menge" value="${prefillQty}" />
          <input type="text" class="qa-unit" placeholder="Einheit" value="${escapeHtml(prefillUnit)}" />
          <input type="date" class="qa-expiry" title="Mindesthaltbarkeitsdatum (optional)" />
          <button type="submit" class="btn btn-primary btn-small">Übernehmen</button>
          <button type="button" class="btn btn-ghost btn-small qa-cancel">Abbrechen</button>
        </form>
      </li>
    `;
  }

  // Gruppiert die Posten nach Kategorie (Obst & Gemüse, Milchprodukte, ...)
  // in fester Anzeigereihenfolge, "Sonstiges" immer zuletzt.
  function groupByCategory(items) {
    const groups = new Map();
    for (const item of items) {
      const cat = categorizeIngredient(item.name);
      if (!groups.has(cat.key)) groups.set(cat.key, { ...cat, items: [] });
      groups.get(cat.key).items.push(item);
    }
    return CATEGORY_ORDER.filter((key) => groups.has(key)).map((key) => groups.get(key));
  }

  function groupHtml(group) {
    return `
      <section class="shopping-category">
        <h2 class="shopping-category-header">
          <span class="shopping-category-icon">${group.icon}</span>
          ${escapeHtml(group.label)}
          <span class="shopping-category-count">${group.items.length}</span>
        </h2>
        <ul class="shopping-category-items">
          ${group.items.map(itemHtml).join("")}
        </ul>
      </section>
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
    list.querySelectorAll(".shopping-item-to-inventory").forEach((btn) => {
      btn.addEventListener("click", () => {
        const li = btn.closest(".shopping-item");
        const qaForm = li.querySelector(".inventory-quick-add");
        qaForm.hidden = !qaForm.hidden;
        if (!qaForm.hidden) qaForm.querySelector(".qa-quantity").focus();
      });
    });
    list.querySelectorAll(".qa-cancel").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.closest(".inventory-quick-add").hidden = true;
      });
    });
    list.querySelectorAll(".inventory-quick-add").forEach((qaForm) => {
      qaForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const itemId = qaForm.dataset.itemId;
        const sourceItem = currentItems.find((i) => i.id === itemId);
        if (!sourceItem) return;

        const quantityRaw = qaForm.querySelector(".qa-quantity").value;
        const unit = qaForm.querySelector(".qa-unit").value.trim();
        const expiryDate = qaForm.querySelector(".qa-expiry").value;
        const submitBtn = qaForm.querySelector("button[type=submit]");
        submitBtn.disabled = true;
        try {
          await addInventoryItem({
            name: sourceItem.name,
            quantity: quantityRaw === "" ? null : Number(quantityRaw),
            unit: unit || null,
            expiryDate: expiryDate || null,
            source: "shopping_list",
          });
          qaForm.hidden = true;
        } catch (err) {
          alert("Konnte nicht in den Vorrat übernehmen: " + err.message);
        } finally {
          submitBtn.disabled = false;
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

    currentItems = items;
    const openCount = items.filter((i) => !i.checked).length;
    const checkedCount = items.length - openCount;
    countEl.textContent = items.length ? `${openCount} offen von ${items.length}` : "";
    emptyState.hidden = items.length > 0;
    moveCheckedBtn.disabled = checkedCount === 0;
    clearCheckedBtn.disabled = checkedCount === 0;

    const groups = groupByCategory(items);
    list.innerHTML = groups.map(groupHtml).join("");
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

  clearCheckedBtn.addEventListener("click", async () => {
    try {
      await clearCheckedShoppingListItems();
      await load();
    } catch (err) {
      alert("Konnte nicht entfernen: " + err.message);
    }
  });

  // Übernimmt alle abgehakten Posten in einem Rutsch in den Vorrat (ohne
  // MHD, das kann man danach direkt im Vorrat nachtragen) und entfernt sie
  // anschließend aus der Einkaufsliste. Für Posten, bei denen man das MHD
  // gleich mit erfassen will, bleibt der Einzel-Button "→ Vorrat" nutzbar.
  moveCheckedBtn.addEventListener("click", async () => {
    const checkedItems = currentItems.filter((i) => i.checked);
    if (!checkedItems.length) return;
    moveCheckedBtn.disabled = true;
    try {
      for (const item of checkedItems) {
        await addInventoryItem({
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          expiryDate: null,
          source: "shopping_list",
        });
      }
      await clearCheckedShoppingListItems();
      await load();
    } catch (err) {
      alert("Konnte nicht in den Vorrat übernehmen: " + err.message);
      moveCheckedBtn.disabled = false;
    }
  });

  await load();
}
