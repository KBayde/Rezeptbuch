import {
    listShoppingListItems,
    addShoppingListItem,
    toggleShoppingListItem,
    deleteShoppingListItem,
    clearCheckedShoppingListItems,
    addInventoryItem,
    updateShoppingListItemPrice,
    getAveragePrice,
} from "./db.js";
import { escapeHtml, formatQuantity, formatPrice, categorizeIngredient, CATEGORY_ORDER, unitOptionsHtml } from "./utils.js";

// Fragt eine grobe Preis-Schätzung fuer eine Zutat per Anthropic API ab (Fallback,
// wenn noch keine eigene Preishistorie fuer diese Zutat existiert). Gibt null
// zurueck statt zu werfen, damit ein Fehlschlag die Eingabe nicht blockiert.
async function estimatePriceViaAI(ingredientName, quantity = null, unit = "") {
        try {
                    const res = await fetch("/api/estimate-price", {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ ingredientName, quantity, unit }),
                    });
                    if (!res.ok) return null;
                    const data = await res.json();
                    return typeof data.price === "number" ? data.price : null;
        } catch {
                    return null;
        }
}

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
                                                                      <input
                                                                              type="number" id="add-item-price" class="price-input-add"
                                                                                      step="0.01" min="0" placeholder="€ geplant"
                                                                                            />
                                                                                                  <button type="submit" class="btn btn-primary">+ Hinzufügen</button>
                                                                                                      </form>
                                                                                                      
                                                                                                    <div class="card shopping-summary-card" id="shopping-summary-card">
                                                                                                              <div>
                                                                                                                          <p class="text-muted">Geplante Summe</p>
                                                                                                                                      <p class="shopping-summary-total" id="shopping-summary-total"></p>
                                                                                                                                                </div>
                                                                                                                                                          <p class="shopping-summary-actual" id="shopping-summary-actual"></p>
                                                                                                                                                                  </div>
                                                                                                                                                                  
                                                                                                                                                                  <div id="shopping-items" class="shopping-list"></div>
                                                                                                              <p id="shopping-empty" class="empty-state" hidden>Deine Einkaufsliste ist leer.</p>
                                                                                                              
                                                                                                                  <div class="week-footer">
                                                                                                                        <a href="#/haushaltskosten" class="btn btn-secondary">💶 Kosten-Tracker</a>
                                                                                                                        <a href="#/einkaufsliste/kassenbon-scan" class="btn btn-secondary">📷 Kassenbon scannen</a>
                                                                                                                              <button id="move-checked-to-inventory-btn" class="btn btn-secondary" type="button">→ Erledigte in Vorrat übernehmen</button>
                                                                                                                                    <button id="clear-checked-btn" class="btn btn-secondary" type="button">Erledigte entfernen</button>
                                                                                                                                        </div>
                                                                                                                                          `;

  const list = container.querySelector("#shopping-items");
    const emptyState = container.querySelector("#shopping-empty");
    const countEl = container.querySelector("#shopping-count");
    const summaryTotalEl = container.querySelector("#shopping-summary-total");
        const summaryActualEl = container.querySelector("#shopping-summary-actual");
    const form = container.querySelector("#add-item-form");
    const input = container.querySelector("#add-item-input");
    const priceInput = container.querySelector("#add-item-price");
    const moveCheckedBtn = container.querySelector("#move-checked-to-inventory-btn");
    const clearCheckedBtn = container.querySelector("#clear-checked-btn");

  let currentItems = [];

input.addEventListener("blur", async () => {
            const name = input.value.trim();
            if (!name || priceInput.value !== "") return;
            try {
                            const avg = await getAveragePrice(name);
                            if (avg !== null) {
                                                priceInput.placeholder = `Ø ${formatPrice(avg)} €`;
                                                return;
                            }
            } catch {
            }
            try {
                            const estimated = await estimatePriceViaAI(name);
                            if (estimated !== null) {
                                                priceInput.placeholder = `≈ ${formatPrice(estimated)} € (KI-Schätzung)`;
                            } else {
                                                priceInput.placeholder = "€ geplant";
                            }
            } catch {
                            priceInput.placeholder = "€ geplant";
            }
});

  function itemHtml(item) {
        const cat = categorizeIngredient(item.name);
        const qtyLabel =
                item.quantity !== null
            ? `${formatQuantity(item.quantity)}${item.unit ? " " + escapeHtml(item.unit) : ""}`
                  : item.unit
            ? escapeHtml(item.unit)
                  : "";
        const toInventoryBtn = item.checked
          ? `<button class="btn btn-secondary btn-small shopping-item-to-inventory" data-item-id="${item.id}" type="button">→ Vorrat</button>`
                : "";
        const prefillQty = item.quantity !== null ? item.quantity : "";
        const prefillUnit = item.quantity !== null && item.unit && !item.unit.includes(" ") ? item.unit : "";

      const actualPriceField = item.checked
          ? `
                  <label class="price-field price-field--actual" title="Tatsächlich bezahlt">
                            <input
                                        type="number" step="0.01" min="0" class="price-input price-input--actual"
                                                    data-item-id="${item.id}" value="${item.actualPrice ?? ""}" placeholder="bezahlt"
                                                              />
                                                                        <span class="price-field-suffix">€</span>
                                                                                </label>`
              : "";

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
                                                                                                                                        <div class="shopping-item-prices">
                                                                                                                                                    <label class="price-field price-field--planned" title="Geplanter Preis">
                                                                                                                                                                  <input
                                                                                                                                                                                  type="number" step="0.01" min="0" class="price-input price-input--planned"
                                                                                                                                                                                                  data-item-id="${item.id}" value="${item.plannedPrice ?? ""}" placeholder="geplant"
                                                                                                                                                                                                                />
                                                                                                                                                                                                                              <span class="price-field-suffix">€</span>
                                                                                                                                                                                                                                          </label>
                                                                                                                                                                                                                                          ${item.plannedPrice === null ? `<button type="button" class="btn-ghost btn-tiny price-ai-btn" data-item-id="${item.id}" data-name="${escapeHtml(item.name)}" title="Preis per KI schätzen">🤖</button>` : ""}
                                                                                                                                                                                                                                                      ${actualPriceField}
                                                                                                                                                                                                                                                                </div>
                                                                                                                                                                                                                                                                          <div class="shopping-item-actions">
                                                                                                                                                                                                                                                                                      ${toInventoryBtn}
                                                                                                                                                                                                                                                                                                  <button class="row-remove shopping-item-remove" data-item-id="${item.id}" title="Entfernen" type="button">×</button>
                                                                                                                                                                                                                                                                                                            </div>
                                                                                                                                                                                                                                                                                                                    </div>
                                                                                                                                                                                                                                                                                                                            <form class="inventory-quick-add" data-item-id="${item.id}" hidden>
                                                                                                                                                                                                                                                                                                                                      <input type="number" step="any" min="0" class="qa-quantity" placeholder="Menge" value="${prefillQty}" />
                                                                                                    <select class="qa-unit">${unitOptionsHtml(prefillUnit || "Stück")}</select>
                                                                                                                                                                                                                                                                                                                                                          <input type="date" class="qa-expiry" title="Mindesthaltbarkeitsdatum (optional)" />
                                                                                                                                                                                                                                                                                                                                                                    <button type="submit" class="btn btn-primary btn-small">Übernehmen</button>
                                                                                                                                                                                                                                                                                                                                                                              <button type="button" class="btn btn-ghost btn-small qa-cancel">Abbrechen</button>
                                                                                                                                                                                                                                                                                                                                                                                      </form>
                                                                                                                                                                                                                                                                                                                                                                                            </li>
                                                                                                                                                                                                                                                                                                                                                                                                `;
  }

  function groupByCategory(items) {
const groups = new Map();
for (const item of items) {
if (item.source === "receipt_spontaneous") continue;
const cat = categorizeIngredient(item.name);
if (!groups.has(cat.key)) groups.set(cat.key, { ...cat, items: [] });
groups.get(cat.key).items.push(item);
}
return CATEGORY_ORDER.filter((key) => groups.has(key)).map((key) => groups.get(key));
}

function spontaneousGroupHtml(items) {
const spontaneousItems = items.filter((i) => i.source === "receipt_spontaneous");
if (spontaneousItems.length === 0) return "";
return `
<section class="shopping-category shopping-category--spontaneous">
<h2 class="shopping-category-header">
<span class="shopping-category-icon">🎲</span>
Spontankäufe
<span class="shopping-category-count">${spontaneousItems.length}</span>
</h2>
<p class="text-muted text-small">Beim Kassenbon-Scan erkannt, standen aber nicht auf der Liste.</p>
<ul class="shopping-category-items">
${spontaneousItems.map(itemHtml).join("")}
</ul>
</section>
`;
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
        list.querySelectorAll(".price-input--planned").forEach((priceEl) => {
                priceEl.addEventListener("change", async () => {
                          const value = priceEl.value.trim();
                          try {
                                      await updateShoppingListItemPrice(priceEl.dataset.itemId, {
                                                    plannedPrice: value === "" ? null : Number(value),
                                      });
                                      await load();
                          } catch (err) {
                                      alert("Preis konnte nicht gespeichert werden: " + err.message);
                          }
                });
            list.querySelectorAll(".price-ai-btn").forEach((btn) => {
                    btn.addEventListener("click", async () => {
                                btn.disabled = true;
                                btn.textContent = "…";
                                try {
                                                const price = await estimatePriceViaAI(btn.dataset.name);
                                                if (price === null) {
                                                                    alert("Preis konnte nicht geschätzt werden.");
                                                                    btn.disabled = false;
                                                                    btn.textContent = "🤖";
                                                                    return;
                                                }
                                                await updateShoppingListItemPrice(btn.dataset.itemId, { plannedPrice: price });
                                                await load();
                                } catch (err) {
                                                alert("Preis konnte nicht geschätzt werden: " + err.message);
                                                btn.disabled = false;
                                                btn.textContent = "🤖";
                                }
                    });
            });
        });
        list.querySelectorAll(".price-input--actual").forEach((priceEl) => {
                priceEl.addEventListener("change", async () => {
                          const value = priceEl.value.trim();
                          try {
                                      await updateShoppingListItemPrice(priceEl.dataset.itemId, {
                                                    actualPrice: value === "" ? null : Number(value),
                                      });
                                      await load();
                          } catch (err) {
                                      alert("Preis konnte nicht gespeichert werden: " + err.message);
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
                          const unit = qaForm.querySelector(".").value.trim();
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

    function updateCostSummary(items) {
        const plannedSum = items.reduce((sum, i) => sum + (i.plannedPrice || 0), 0);
            const actualSum = items.filter((i) => i.checked).reduce((sum, i) => sum + (i.actualPrice || 0), 0);
            summaryTotalEl.textContent = `${formatPrice(plannedSum)} €`;
            summaryActualEl.textContent = actualSum > 0 ? `bereits bezahlt: ${formatPrice(actualSum)} €` : "";
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
        updateCostSummary(items);

      const groups = groupByCategory(items);
        list.innerHTML = spontaneousGroupHtml(items) + groups.map(groupHtml).join("");
        wireItems();
  }

  form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        const priceRaw = priceInput.value.trim();
        try {
                await addShoppingListItem(name, priceRaw === "" ? null : Number(priceRaw));
                input.value = "";
                priceInput.value = "";
                priceInput.placeholder = "€ geplant";
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

  moveCheckedBtn.addEventListener("click", async () => {
        const checkedItems = currentItems.filter((i) => i.checked);
        if (!checkedItems.length) return;
        moveCheckedBtn.disabled = true;
        try {
                for (const item of checkedItems) {
                          await addInventoryItem({
                                      name: item.name,
                                      quantity: item.quantity,
                                      unit: item.unit || "Stück",
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
