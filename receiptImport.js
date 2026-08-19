import { navigate } from "./router.js";
import {
    listShoppingListItems,
    updateShoppingListItemPrice,
    toggleShoppingListItem,
    addPurchasedShoppingListItem,
} from "./db.js";
import { escapeHtml, formatPrice } from "./utils.js";

const MAX_IMAGES = 3;

async function fileToResizedBase64(file, maxDim = 1600, quality = 0.85) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

  return { base64: btoa(binary), mediaType: "image/jpeg" };
}

function normalizeName(name) {
    return (name || "").trim().toLowerCase();
}

function namesMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));
}

export async function renderReceiptImport(container) {
    container.innerHTML = `
        <a href="#/einkaufsliste" class="back-link">← Zurück zur Einkaufsliste</a>
            <h1>Kassenbon scannen</h1>
                <p class="text-muted">
                      Foto oder mehrere Fotos deines Kassenbons hochladen – Produkte und bezahlte Preise
                            werden automatisch erkannt. Danach kannst du alles noch prüfen, bevor es in die
                                  Einkaufsliste übernommen wird.
                                      </p>

                                          <div class="card stack-md" id="receipt-upload-card">
                                                <label class="field">
                                                        <span>Kassenbon-Foto(s) auswählen (bis zu ${MAX_IMAGES})</span>
                                                                <input type="file" id="receipt-input" accept="image/*" capture="environment" multiple />
                                                                      </label>
                                                                            <div id="receipt-thumbs" class="photo-thumbs"></div>
                                                                                  <button type="button" id="scan-btn" class="btn btn-primary" disabled>Kassenbon erkennen</button>
                                                                                        <p id="receipt-error" class="form-error" hidden></p>
                                                                                              <p id="receipt-status" class="text-muted" hidden></p>
                                                                                                  </div>

                                                                                                      <div class="card stack-md" id="receipt-review" hidden>
                                                                                                            <h2>Erkannte Produkte</h2>
                                                                                                                  <p class="text-muted">Bitte prüfen und bei Bedarf anpassen, bevor du sie übernimmst.</p>
                                                                                                                        <ul id="receipt-items" class="receipt-items"></ul>
                                                                                                                              <p id="receipt-empty" class="text-muted" hidden>Es wurden keine Produkte erkannt.</p>
                                                                                                                                    <div class="week-footer">
                                                                                                                                            <button type="button" id="add-to-list-btn" class="btn btn-primary">
                                                                                                                                                      Ausgewählte zur Einkaufsliste hinzufügen
                                                                                                                                                              </button>
                                                                                                                                                                    </div>
                                                                                                                                                                          <p id="receipt-add-status" class="text-muted" hidden></p>
                                                                                                                                                                              </div>
                                                                                                                                                                                `;

const input = container.querySelector("#receipt-input");
  const thumbsWrap = container.querySelector("#receipt-thumbs");
  const scanBtn = container.querySelector("#scan-btn");
  const errorEl = container.querySelector("#receipt-error");
  const statusEl = container.querySelector("#receipt-status");
  const uploadCard = container.querySelector("#receipt-upload-card");
  const reviewCard = container.querySelector("#receipt-review");
  const itemsList = container.querySelector("#receipt-items");
  const emptyEl = container.querySelector("#receipt-empty");
  const addToListBtn = container.querySelector("#add-to-list-btn");
  const addStatusEl = container.querySelector("#receipt-add-status");

let selectedFiles = [];
  let receiptItems = [];

function renderThumbs() {
  thumbsWrap.innerHTML = selectedFiles
  .map(
    (file, i) => `
    <div class="photo-thumb" data-index="${i}">
    <img src="${URL.createObjectURL(file)}" alt="" />
    <button type="button" class="photo-thumb-remove" data-remove-photo="${i}" aria-label="Foto entfernen">×</button>
    </div>
    `
    )
  .join("");
  scanBtn.disabled = selectedFiles.length === 0;
}

input.addEventListener("change", () => {
  errorEl.hidden = true;
  const newFiles = Array.from(input.files || []);
  for (const file of newFiles) {
    if (selectedFiles.length >= MAX_IMAGES) break;
    selectedFiles.push(file);
  }
  input.value = "";
  renderThumbs();
});

thumbsWrap.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove-photo]");
  if (!btn) return;
  selectedFiles.splice(Number(btn.dataset.removePhoto), 1);
  renderThumbs();
});

scanBtn.addEventListener("click", async () => {
  if (selectedFiles.length === 0) return;
  errorEl.hidden = true;
  statusEl.hidden = false;
  statusEl.textContent =
    selectedFiles.length > 1
  ? "Fotos werden analysiert – das kann einen Moment dauern…"
    : "Foto wird analysiert – das kann einen Moment dauern…";
  scanBtn.disabled = true;
  input.disabled = true;

                         try {
                           const images = await Promise.all(selectedFiles.map((file) => fileToResizedBase64(file)));
                           const res = await fetch("/api/extract-receipt", {
                             method: "POST",
                             headers: { "content-type": "application/json" },
                             body: JSON.stringify({ images }),
                           });

  let data;
                           try {
                             data = await res.json();
                           } catch {
                             throw new Error(
                               "Der Server hat keine gültige Antwort geliefert (evtl. Zeitüberschreitung). Bitte mit weniger oder kleineren Fotos erneut versuchen."
                               );
                           }
                           if (!res.ok) {
                             throw new Error(data.error || "Kassenbon konnte nicht erkannt werden.");
                           }

  receiptItems = (data.items || []).map((it) => ({ name: it.name, price: it.price, checked: true }));
                           uploadCard.hidden = true;
                           reviewCard.hidden = false;
                           renderReviewItems();
                         } catch (err) {
                           errorEl.textContent = err.message;
                           errorEl.hidden = false;
                           statusEl.hidden = true;
                           scanBtn.disabled = false;
                           input.disabled = false;
                         }
});

function renderReviewItems() {
  emptyEl.hidden = receiptItems.length > 0;
  itemsList.innerHTML = receiptItems
  .map(
    (item, i) => `
    <li class="receipt-item" data-index="${i}">
    <input type="checkbox" class="receipt-item-checkbox" data-index="${i}" ${item.checked ? "checked" : ""} />
    <input type="text" class="receipt-item-name" data-index="${i}" value="${escapeHtml(item.name)}" />
    <input type="number" step="0.01" min="0" class="receipt-item-price" data-index="${i}" value="${item.price}" />
    <span class="receipt-item-suffix">€</span>
    </li>
    `
    )
  .join("");
  wireReviewItems();
}

function wireReviewItems() {
  itemsList.querySelectorAll(".receipt-item-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      receiptItems[Number(cb.dataset.index)].checked = cb.checked;
    });
  });
  itemsList.querySelectorAll(".receipt-item-name").forEach((nameEl) => {
    nameEl.addEventListener("input", () => {
      receiptItems[Number(nameEl.dataset.index)].name = nameEl.value;
    });
  });
  itemsList.querySelectorAll(".receipt-item-price").forEach((priceEl) => {
    priceEl.addEventListener("input", () => {
      const v = priceEl.value.trim();
      receiptItems[Number(priceEl.dataset.index)].price = v === "" ? null : Number(v);
    });
  });
}

addToListBtn.addEventListener("click", async () => {
  const selected = receiptItems.filter(
    (it) => it.checked && it.name && it.name.trim() && it.price !== null && Number.isFinite(it.price)
    );
  if (selected.length === 0) {
    alert("Bitte mindestens ein Produkt mit Name und Preis auswählen.");
    return;
  }
  addToListBtn.disabled = true;
  addStatusEl.hidden = false;
  addStatusEl.textContent = "Wird hinzugefügt…";
  let addedCount = 0;
  let updatedCount = 0;
  try {
    const existing = await listShoppingListItems();
    const usedIds = new Set();
    for (const item of selected) {
      const nameNorm = normalizeName(item.name);
      const match = existing.find(
        (e) => !e.checked && !usedIds.has(e.id) && namesMatch(normalizeName(e.name), nameNorm)
        );
      if (match) {
        usedIds.add(match.id);
        await updateShoppingListItemPrice(match.id, { actualPrice: item.price });
        await toggleShoppingListItem(match.id, true);
        updatedCount++;
      } else {
        await addPurchasedShoppingListItem(item.name.trim(), item.price);
        addedCount++;
      }
    }
    addStatusEl.textContent = `Fertig: ${addedCount} neu hinzugefügt, ${updatedCount} vorhandene aktualisiert.`;
    receiptItems = [];
    renderReviewItems();
  } catch (err) {
    addStatusEl.textContent = "Fehler: " + err.message;
  } finally {
    addToListBtn.disabled = false;
  }
});
}

