import { navigate } from "./router.js";
import { addInventoryItemsBulk } from "./db.js";
import { escapeHtml, unitOptionsHtml, estimateExpiryDate, categorizeIngredient, estimateStorageLocation, categoryOptionsHtml, storageLocationOptionsHtml } from "./utils.js";

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

export async function renderInventoryPhotoImport(container) {
container.innerHTML = `
<a href="#/vorrat" class="back-link">← Zurück zum Vorrat</a>
<h1>Vorrat per Foto erfassen</h1>
<p class="text-muted">
Foto oder mehrere Fotos von deinem Kühlschrank/Vorratsschrank hochladen – die KI schlägt eine Liste
möglicher Posten vor. Danach prüfst du alles und ergänzt das Mindesthaltbarkeitsdatum (Pflichtfeld),
bevor es in den Vorrat übernommen wird.
</p>

<div class="card stack-md" id="inv-photo-upload-card">
<label class="field">
<span>Foto(s) auswählen (bis zu ${MAX_IMAGES})</span>
<input type="file" id="inv-photo-input" accept="image/*" capture="environment" multiple />
</label>
<div id="inv-photo-thumbs" class="photo-thumbs"></div>
<button type="button" id="inv-photo-scan-btn" class="btn btn-primary" disabled>Lebensmittel erkennen</button>
<p id="inv-photo-error" class="form-error" hidden></p>
<p id="inv-photo-status" class="text-muted" hidden></p>
</div>

<div class="card stack-md" id="inv-photo-review" hidden>
<h2>Erkannte Posten</h2>
<p class="text-muted">Bitte prüfen und bei Bedarf anpassen. Das MHD ist Pflicht – ohne MHD kann ein Posten nicht übernommen werden.</p>
<ul id="inv-photo-items" class="receipt-items inventory-photo-items"></ul>
<p id="inv-photo-empty" class="text-muted" hidden>Es wurden keine Lebensmittel erkannt.</p>
<div class="week-footer">
<button type="button" id="inv-photo-add-btn" class="btn btn-primary">Ausgewählte in den Vorrat übernehmen</button>
</div>
<p id="inv-photo-add-status" class="text-muted" hidden></p>
</div>
`;

const input = container.querySelector("#inv-photo-input");
const thumbsWrap = container.querySelector("#inv-photo-thumbs");
const scanBtn = container.querySelector("#inv-photo-scan-btn");
const errorEl = container.querySelector("#inv-photo-error");
const statusEl = container.querySelector("#inv-photo-status");
const uploadCard = container.querySelector("#inv-photo-upload-card");
const reviewCard = container.querySelector("#inv-photo-review");
const itemsList = container.querySelector("#inv-photo-items");
const emptyEl = container.querySelector("#inv-photo-empty");
const addBtn = container.querySelector("#inv-photo-add-btn");
const addStatusEl = container.querySelector("#inv-photo-add-status");

let selectedFiles = [];
let photoItems = [];

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
const res = await fetch("/api/extract-inventory-photo", {
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
throw new Error(data.error || "Lebensmittel konnten nicht erkannt werden.");
}

photoItems = (data.items || []).map((it) => ({
  name: it.name,
  quantity: it.quantity,
  unit: it.unit || "Stück",
  expiryDate: it.expiryDate || estimateExpiryDate(it.name),
  category: categorizeIngredient(it.name).key,
  storageLocation: estimateStorageLocation(it.name),
  checked: true,
}));
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
emptyEl.hidden = photoItems.length > 0;
itemsList.innerHTML = photoItems
.map(
(item, i) => `
<li class="receipt-item inventory-photo-item ${!item.expiryDate ? "inventory-photo-item--missing-expiry" : ""}" data-index="${i}">
<input type="checkbox" class="receipt-item-checkbox" data-index="${i}" ${item.checked ? "checked" : ""} />
<input type="text" class="receipt-item-name" data-index="${i}" value="${escapeHtml(item.name)}" />
<input type="number" step="any" min="0" class="inv-photo-item-qty" data-index="${i}" value="${item.quantity ?? ""}" placeholder="Menge" />
<select class="inv-photo-item-unit" data-index="${i}">${unitOptionsHtml(item.unit || "Stück")}</select>
<select class="inv-photo-item-category" data-index="${i}">${categoryOptionsHtml(item.category || "other")}</select>
<select class="inv-photo-item-storage" data-index="${i}">${storageLocationOptionsHtml(item.storageLocation || "vorrat")}</select>
<input type="date" class="inv-photo-item-expiry" data-index="${i}" value="${item.expiryDate || ""}" required />
<button type="button" class="btn-ghost expiry-estimate-btn" data-index="${i}" title="MHD schätzen">🤖</button>
</li>
`
)
.join("");
wireReviewItems();
}

function wireReviewItems() {
itemsList.querySelectorAll(".receipt-item-checkbox").forEach((cb) => {
cb.addEventListener("change", () => {
photoItems[Number(cb.dataset.index)].checked = cb.checked;
});
});
itemsList.querySelectorAll(".receipt-item-name").forEach((nameEl) => {
nameEl.addEventListener("input", () => {
photoItems[Number(nameEl.dataset.index)].name = nameEl.value;
});
});
itemsList.querySelectorAll(".inv-photo-item-qty").forEach((qtyEl) => {
qtyEl.addEventListener("input", () => {
const v = qtyEl.value.trim();
photoItems[Number(qtyEl.dataset.index)].quantity = v === "" ? null : Number(v);
});
});
itemsList.querySelectorAll(".inv-photo-item-unit").forEach((unitEl) => {
unitEl.addEventListener("change", () => {
photoItems[Number(unitEl.dataset.index)].unit = unitEl.value.trim();
});
});
itemsList.querySelectorAll(".inv-photo-item-category").forEach((catEl) => {
catEl.addEventListener("change", () => {
photoItems[Number(catEl.dataset.index)].category = catEl.value;
});
});
itemsList.querySelectorAll(".inv-photo-item-storage").forEach((storageEl) => {
storageEl.addEventListener("change", () => {
photoItems[Number(storageEl.dataset.index)].storageLocation = storageEl.value;
});
});
itemsList.querySelectorAll(".inv-photo-item-expiry").forEach((expEl) => {
    expEl.addEventListener("input", () => {
      const idx = Number(expEl.dataset.index);
      photoItems[idx].expiryDate = expEl.value;
      expEl.closest(".inventory-photo-item").classList.toggle("inventory-photo-item--missing-expiry", !expEl.value);
    });
  });
  itemsList.querySelectorAll(".expiry-estimate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      const item = photoItems[idx];
      const expEl = itemsList.querySelector(`.inv-photo-item-expiry[data-index="${idx}"]`);
      item.expiryDate = estimateExpiryDate(item.name);
      expEl.value = item.expiryDate;
      expEl.closest(".inventory-photo-item").classList.remove("inventory-photo-item--missing-expiry");
    });
  });
}

addBtn.addEventListener("click", async () => {
const selected = photoItems.filter((it) => it.checked && it.name && it.name.trim());
if (selected.length === 0) {
alert("Bitte mindestens einen Posten auswählen.");
return;
}
const missingExpiry = selected.find((it) => !it.expiryDate);
if (missingExpiry) {
alert(`Bitte für "${missingExpiry.name}" ein Mindesthaltbarkeitsdatum eintragen – MHD ist Pflicht.`);
return;
}
addBtn.disabled = true;
addStatusEl.hidden = false;
addStatusEl.textContent = "Wird übernommen…";
try {
await addInventoryItemsBulk(
selected.map((it) => ({
name: it.name.trim(),
quantity: it.quantity,
unit: it.unit || null,
expiryDate: it.expiryDate,
category: it.category || null,
storageLocation: it.storageLocation || null,
source: "photo_import",
}))
);
addStatusEl.textContent = `Fertig: ${selected.length} Posten in den Vorrat übernommen.`;
photoItems = [];
setTimeout(() => navigate("/vorrat"), 900);
} catch (err) {
addStatusEl.textContent = "Fehler: " + err.message;
} finally {
addBtn.disabled = false;
}
});
}
