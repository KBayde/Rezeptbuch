import {
  listInventoryItems,
  addInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  markInventoryItemUsed,
  markInventoryItemWasted,
} from "./db.js";
import { escapeHtml, formatQuantity, formatDateDisplayFull, daysUntil, unitOptionsHtml } from "./utils.js";

/** Liefert Anzeigetext + CSS-Modifier für die MHD-Badge eines Inventar-Eintrags. */
function expiryBadge(expiryDate) {
  const days = daysUntil(expiryDate);
  if (days === null) return { text: "Kein MHD", cls: "inventory-badge--none" };
  if (days < 0) {
    const n = Math.abs(days);
    return { text: `Abgelaufen (${n} Tag${n === 1 ? "" : "e"})`, cls: "inventory-badge--expired" };
  }
  if (days === 0) return { text: "Läuft heute ab", cls: "inventory-badge--expired" };
  if (days === 1) return { text: "Läuft morgen ab", cls: "inventory-badge--expired" };
  if (days <= 3) return { text: `Noch ${days} Tage`, cls: "inventory-badge--soon" };
  return { text: `Noch ${days} Tage`, cls: "inventory-badge--ok" };
}

export async function renderInventory(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Vorrat</h1>
        <p class="text-muted" id="inventory-count"></p>
        <p class="text-small text-muted" id="inventory-score-status" aria-live="polite"></p>
      </div>
    </div>

    <form id="add-inventory-form" class="inventory-add-form">
      <input type="text" id="inv-name" class="search-input" placeholder="Name (z. B. Rucola)" required />
      <input type="number" id="inv-quantity" step="any" min="0" placeholder="Menge" />
              <select id="inv-unit" required>${unitOptionsHtml("Stück")}</select>
      <input type="date" id="inv-expiry" title="Mindesthaltbarkeitsdatum (optional)" />
      <button type="submit" class="btn btn-primary">+ Hinzufügen</button>
    </form>

    <div id="inventory-soon-wrap"></div>

    <ul id="inventory-items" class="inventory-list"></ul>
    <p id="inventory-empty" class="empty-state" hidden>Dein Vorrat ist leer.</p>
  `;

  const list = container.querySelector("#inventory-items");
  const emptyState = container.querySelector("#inventory-empty");
  const countEl = container.querySelector("#inventory-count");
  const soonWrap = container.querySelector("#inventory-soon-wrap");
  const scoreStatus = container.querySelector("#inventory-score-status");
  const form = container.querySelector("#add-inventory-form");

  function itemRowHtml(item) {
    const badge = expiryBadge(item.expiryDate);
    return `
      <li class="inventory-item" data-item-id="${item.id}">
        <div class="inventory-item-main">
          <span class="inventory-item-name">${escapeHtml(item.name)}</span>
          <span class="inventory-badge ${badge.cls}" title="${
            item.expiryDate ? escapeHtml(formatDateDisplayFull(item.expiryDate)) : ""
          }">${badge.text}</span>
        </div>
        <div class="inventory-item-controls">
          <input
            type="number" step="any" min="0" class="inventory-qty-input"
            data-item-id="${item.id}" value="${item.quantity ?? ""}" placeholder="Menge"
          />
          <select class="inventory-unit-input" data-item-id="${item.id}">${unitOptionsHtml(item.unit || "Stück")}</select>
          <input
            type="date" class="inventory-expiry-input"
            data-item-id="${item.id}" value="${item.expiryDate || ""}"
          />
          <button class="row-action row-action--used inventory-item-used" data-item-id="${item.id}" title="Aufgebraucht" type="button">✅</button>
          <button class="row-action row-action--wasted inventory-item-wasted" data-item-id="${item.id}" title="Weggeworfen" type="button">🗑️</button>
        </div>
      </li>
    `;
  }

  function wireItems() {
    list.querySelectorAll(".inventory-qty-input").forEach((input) => {
      input.addEventListener("change", async () => {
        const value = input.value === "" ? null : Number(input.value);
        try {
          await updateInventoryItem(input.dataset.itemId, { quantity: value });
        } catch (err) {
          alert("Konnte Menge nicht speichern: " + err.message);
        }
      });
    });
    list.querySelectorAll(".inventory-unit-input").forEach((input) => {
      input.addEventListener("change", async () => {
        try {
          await updateInventoryItem(input.dataset.itemId, { unit: input.value.trim() || null });
        } catch (err) {
          alert("Konnte Einheit nicht speichern: " + err.message);
        }
      });
    });
    list.querySelectorAll(".inventory-expiry-input").forEach((input) => {
      input.addEventListener("change", async () => {
        try {
          await updateInventoryItem(input.dataset.itemId, { expiryDate: input.value || null });
          await load();
        } catch (err) {
          alert("Konnte MHD nicht speichern: " + err.message);
        }
      });
    });
    list.querySelectorAll(".inventory-item-used").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const points = await markInventoryItemUsed(btn.dataset.itemId);
          scoreStatus.textContent = `+${points} 🦫 Aufgebraucht, bevor's schlecht wurde!`;
          setTimeout(() => {
            scoreStatus.textContent = "";
          }, 4000);
          await load();
        } catch (err) {
          alert("Konnte nicht speichern: " + err.message);
          btn.disabled = false;
        }
      });
    });
    list.querySelectorAll(".inventory-item-wasted").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Wirklich als weggeworfen markieren?")) return;
        btn.disabled = true;
        try {
          const points = await markInventoryItemWasted(btn.dataset.itemId);
          scoreStatus.textContent = `${points} 🦫 Autsch, das hat sich der Biber weggezwickert.`;
          setTimeout(() => {
            scoreStatus.textContent = "";
          }, 4000);
          await load();
        } catch (err) {
          alert("Konnte nicht speichern: " + err.message);
          btn.disabled = false;
        }
      });
    });
  }

  async function load() {
    list.innerHTML = `<p class="text-muted">Lade…</p>`;
    let items = [];
    try {
      items = await listInventoryItems();
    } catch (err) {
      list.innerHTML = `<p class="form-error">Vorrat konnte nicht geladen werden: ${escapeHtml(
        err.message
      )}</p>`;
      return;
    }

    countEl.textContent = items.length ? `${items.length} Posten im Vorrat` : "";
    emptyState.hidden = items.length > 0;

    // "Läuft bald ab": alles mit MHD, das schon abgelaufen ist oder in den
    // nächsten 3 Tagen abläuft – bewusst dieselbe Schwelle wie die
    // "soon"-Badge-Farbe, damit die Übersicht und die Liste konsistent sind.
    const soonItems = items.filter((i) => i.expiryDate && daysUntil(i.expiryDate) <= 3);
    soonWrap.innerHTML = soonItems.length
      ? `
        <div class="inventory-soon card">
          <h2>⏰ Läuft bald ab</h2>
          <ul class="inventory-soon-list">
            ${soonItems
              .map((i) => {
                const badge = expiryBadge(i.expiryDate);
                const qty =
                  i.quantity !== null
                    ? ` (${formatQuantity(i.quantity)}${i.unit ? " " + escapeHtml(i.unit) : ""})`
                    : "";
                return `
                  <li>
                    <span class="inventory-badge ${badge.cls}">${badge.text}</span>
                    <span>${escapeHtml(i.name)}${qty}</span>
                  </li>
                `;
              })
              .join("")}
          </ul>
        </div>
      `
      : "";

    list.innerHTML = items.map(itemRowHtml).join("");
    wireItems();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = form.querySelector("#inv-name").value.trim();
    if (!name) return;
    const quantityRaw = form.querySelector("#inv-quantity").value;
    const unit = form.querySelector("#inv-unit").value.trim();
    const expiryDate = form.querySelector("#inv-expiry").value;
    try {
      await addInventoryItem({
        name,
        quantity: quantityRaw === "" ? null : Number(quantityRaw),
        unit: unit || null,
        expiryDate: expiryDate || null,
        source: "manual",
      });
      form.reset();
      await load();
    } catch (err) {
      alert("Konnte nicht hinzufügen: " + err.message);
    }
  });

  await load();
}
