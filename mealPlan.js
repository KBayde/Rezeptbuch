import {
listRecipes,
listMealPlanEntries,
addMealPlanEntryForDays,
removeMealPlanEntry,
updateMealPlanEntryServings,
copyMealPlanWeek,
clearMealPlanWeek,
addCustomMealPlanEntry, listRecentCustomMealTitles, addCustomComponentToPlannedMeal,
generateShoppingList,
suggestRecipesFromInventory,
listMealCombinations,
addComponentToPlannedMeal,
renamePlannedMeal,
saveMealAsCombination,
applyCombinationToSlot,
getSetting,
markMealPlanEntryCooked,
} from "./db.js";
import {
escapeHtml,
getWeekStart,
addDays,
formatDateISO,
formatDateDisplay,
WEEKDAY_LABELS_DE,
MEAL_TYPES,
formatPrice,
} from "./utils.js";
import { navigate } from "./router.js";

const VIEW_STORAGE_KEY = "cookcook-wochenplan-view";

export async function renderMealPlan(container) {
const today = new Date();
let currentWeekStart = getWeekStart(today);
let weekStartDay = 1;
let armTwoDays = false;
let currentEntries = [];
let allCombinations = []; let recentCustomMeals = []; let dailyCalorieTarget = null;
let viewMode =
localStorage.getItem(VIEW_STORAGE_KEY) ||
(window.matchMedia("(max-width: 720px)").matches ? "list" : "grid");

container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Wochenplan</h1>
        <p class="text-muted" id="week-range-label"></p>
<p class="text-small text-muted" id="cooked-status" aria-live="polite"></p>
      </div>
      <div class="detail-actions">
        <button id="prev-week-btn" class="btn btn-secondary btn-small" type="button">← Vorige</button>
        <button id="today-week-btn" class="btn btn-secondary btn-small" type="button">Diese Woche</button>
        <button id="next-week-btn" class="btn btn-secondary btn-small" type="button">Nächste →</button>
        <button id="copy-week-btn" class="btn btn-secondary btn-small" type="button">📋 Woche kopieren</button>
<button id="clear-week-btn" class="btn btn-secondary btn-small" type="button">🗑️ Woche leeren</button>
      </div>
    </div>

    <div class="view-toggle-row">
      <div class="view-toggle" role="group" aria-label="Ansicht wählen">
        <button id="view-grid-btn" class="btn btn-secondary btn-small view-toggle-btn" type="button">🗓️ Raster</button>
        <button id="view-list-btn" class="btn btn-secondary btn-small view-toggle-btn" type="button">📋 Liste</button>
      </div>
    </div>

    <div class="week-copy-row" id="week-copy-row" hidden>
      <label class="text-small text-muted" for="week-copy-target">Zielwoche (beliebiger Tag der Woche):</label>
      <input type="date" id="week-copy-target" />
      <button id="week-copy-confirm-btn" class="btn btn-small btn-primary" type="button">Kopieren</button>
      <button id="week-copy-cancel-btn" class="btn btn-small btn-secondary" type="button">Abbrechen</button>
      <span id="week-copy-status" class="text-small text-muted"></span>
    </div>

    <div class="two-day-toggle-row">
      <button id="two-day-toggle" class="chip chip-toggle" type="button" title="Bei der nächsten Rezeptauswahl auch für den Folgetag einplanen">
        🗓️ Nächste Auswahl auch für Folgetag planen
      </button>
      <span id="two-day-hint" class="text-small text-muted" hidden>Aktiv – wähle jetzt ein Rezept aus.</span>
    </div>

    <div class="card suggestion-card" id="suggestion-card" hidden>
      <h2>Vorschläge aus deinem Vorrat</h2>
      <p class="text-muted text-small">Rezepte, deren Zutaten größtenteils vorhanden sind – bald ablaufende Posten werden bevorzugt.</p>
      <div id="suggestion-list" class="suggestion-list"></div>
    </div>

    <div class="plan-wrap timetable-scroll" id="plan-wrap">
      <div id="plan-el" class="timetable"></div>
    </div>

    <div class="week-footer">
      <a href="#/einkaufsliste" class="btn btn-secondary">Einkaufsliste ansehen</a>
      <button id="make-shopping-list-btn" class="btn btn-primary" type="button">
        Einkaufsliste aus dieser Woche erstellen
      </button>
    </div>
  `;

  const planWrap = container.querySelector("#plan-wrap");
const planEl = container.querySelector("#plan-el");
const rangeLabel = container.querySelector("#week-range-label");
const cookedStatus = container.querySelector("#cooked-status");
const shoppingBtn = container.querySelector("#make-shopping-list-btn");
const twoDayToggle = container.querySelector("#two-day-toggle");
const twoDayHint = container.querySelector("#two-day-hint");
const suggestionCard = container.querySelector("#suggestion-card");
const suggestionList = container.querySelector("#suggestion-list");
const copyWeekBtn = container.querySelector("#copy-week-btn");
const clearWeekBtn = container.querySelector("#clear-week-btn");
const weekCopyRow = container.querySelector("#week-copy-row");
const weekCopyTarget = container.querySelector("#week-copy-target");
const weekCopyConfirmBtn = container.querySelector("#week-copy-confirm-btn");
const weekCopyCancelBtn = container.querySelector("#week-copy-cancel-btn");
const weekCopyStatus = container.querySelector("#week-copy-status");
const viewGridBtn = container.querySelector("#view-grid-btn");
const viewListBtn = container.querySelector("#view-list-btn");

let allRecipes = [];
try {
allRecipes = await listRecipes();
} catch (err) {
planEl.innerHTML = `<p class="form-error">Rezepte konnten nicht geladen werden: ${escapeHtml(
err.message
)}</p>`;
return;
}

try {
allCombinations = await listMealCombinations(); } catch { allCombinations = []; } try { recentCustomMeals = await listRecentCustomMealTitles(); } catch { recentCustomMeals = []; } try { dailyCalorieTarget = await getSetting("daily_calorie_target"); } catch { dailyCalorieTarget = null; } try { const rawWeekStartDay = await getSetting("week_start_day"); weekStartDay = rawWeekStartDay !== null && rawWeekStartDay !== undefined && rawWeekStartDay !== "" ? Number(rawWeekStartDay) : 1; } catch { weekStartDay = 1; } currentWeekStart = getWeekStart(today, weekStartDay);

function setArmTwoDays(value) {
armTwoDays = value;
twoDayToggle.classList.toggle("chip-toggle--active", value);
twoDayHint.hidden = !value;
}

twoDayToggle.addEventListener("click", () => setArmTwoDays(!armTwoDays));

// Kalorien-Summe eines Tages aus den bereits geladenen currentEntries.
// hasUnknown = true, wenn mind. ein Eintrag (z. B. "Anderes ohne Rezept" oder
// ein Rezept ohne Kalorien-Schätzung) nicht mitgezaehlt werden konnte.
function caloriesForDate(iso) {
  const dayEntries = currentEntries.filter((e) => e.date === iso);
  let sum = 0;
  let hasUnknown = false;
  for (const e of dayEntries) {
    if (e.caloriesPerServing === null || e.caloriesPerServing === undefined) {
      hasUnknown = true;
      continue;
    }
    sum += e.caloriesPerServing * e.servings;
  }
  return { sum, hasUnknown, hasAny: dayEntries.length > 0 };
}

function dayCaloriesHtml(iso) {
  const { sum, hasUnknown, hasAny } = caloriesForDate(iso);
  if (!hasAny || sum <= 0) return "";
  const rounded = Math.round(sum);
  const over = dailyCalorieTarget && sum > dailyCalorieTarget;
  const label = `${hasUnknown ? "≈ " : ""}${rounded} kcal`;
  const title = hasUnknown ? "Enthält Einträge ohne Kalorienangabe (nicht mitgerechnet)" : "";
  return `<span class="day-calories${over ? " day-calories--over" : ""}" title="${title}">🔥 ${label}${over ? " ⚠️" : ""}</span>`;
}

function syncViewToggleButtons() {
viewGridBtn.classList.toggle("view-toggle-btn--active", viewMode === "grid");
viewListBtn.classList.toggle("view-toggle-btn--active", viewMode === "list");
}

function setViewMode(mode) {
if (mode === viewMode) return;
viewMode = mode;
localStorage.setItem(VIEW_STORAGE_KEY, mode);
syncViewToggleButtons();
renderPlan();
}

viewGridBtn.addEventListener("click", () => setViewMode("grid"));
viewListBtn.addEventListener("click", () => setViewMode("list"));
syncViewToggleButtons();

function recipeOptionsHtml(mealTypeKey) { const matching = []; const others = []; for (const r of allRecipes) { if (r.mealTypes && r.mealTypes.includes(mealTypeKey)) matching.push(r); else others.push(r); } const sortByTitle = (a, b) => a.title.localeCompare(b.title, "de"); matching.sort(sortByTitle); others.sort(sortByTitle); const optHtml = (list) => list.map((r) => `<option value="${r.id}">${escapeHtml(r.title)}</option>`).join(""); if (matching.length === 0) { return `<optgroup label="Alle Rezepte">${optHtml(others)}</optgroup>`; } const mealLabel = MEAL_TYPES.find((mt) => mt.key === mealTypeKey)?.label || mealTypeKey; return `<optgroup label="✓ Passend für ${mealLabel}">${optHtml(matching)}</optgroup><optgroup label="Weitere Rezepte">${optHtml(others)}</optgroup>`; } function quickCustomOptionsHtml() { if (!recentCustomMeals || recentCustomMeals.length === 0) return ""; const opts = recentCustomMeals.map((m, i) => `<option value="quick:${i}">🥪 ${escapeHtml(m.title)}${m.price !== null && m.price !== undefined ? ` (${formatPrice(m.price)} €)` : ""}</option>`).join(""); return `<optgroup label="Ohne Rezept (zuletzt verwendet)">${opts}</optgroup>`; }

// Optgroup mit gespeicherten Essens-Kombinationen ("Unser Raclette" usw.) fuer
// den Haupt-Rezept-Select jedes Zeitfensters - Ein-Klick-Uebernahme einer
// ganzen mehrteiligen Essens-Vorlage, ohne die einzelnen Rezepte einzeln zu suchen.
function comboOptionsHtml() {
if (!allCombinations || allCombinations.length === 0) return "";
const opts = allCombinations
.map((c) => `<option value="combo:${c.id}">🧩 ${escapeHtml(c.title)}</option>`)
.join("");
return `<optgroup label="Kombination einfügen">${opts}</optgroup>`;
}

  function entryThumbHtml(entry) {
if (entry.imageUrl) {
return `<img src="${escapeHtml(entry.imageUrl)}" alt="" class="meal-entry-thumb" />`;
}
const icon = entry.recipeId ? "🍽️" : "✏️";
return `<div class="meal-entry-thumb meal-entry-thumb--empty" aria-hidden="true">${icon}</div>`;
}

function entryChipHtml(entry) {
const isCustom = !entry.recipeId;
const priceLabel =
isCustom && entry.customPrice !== null && entry.customPrice !== undefined
? `<span class="meal-entry-price">${formatPrice(entry.customPrice)} €</span>`
: "";
const titleHtml = isCustom
? `<span class="meal-entry-title">${escapeHtml(entry.recipeTitle)}</span>`
: `<a href="#/rezepte/${entry.recipeId}" class="meal-entry-title">${escapeHtml(entry.recipeTitle)}</a>`;
const metaHtml = isCustom
? priceLabel
: `<input
type="number" min="1" step="1" class="meal-entry-servings"
data-entry-id="${entry.id}" value="${entry.servings}"
/>`;
  const cookedBtnHtml = isCustom
? ""
: `<button class="meal-entry-cooked${entry.cookedAt ? " meal-entry-cooked--active" : ""}" data-entry-id="${entry.id}" title="${entry.cookedAt ? "Als gekocht markiert – erneut klicken zum Zurücksetzen" : "Als gekocht markieren"}" type="button">${entry.cookedAt ? "✅" : "☐"}</button>`;
return `
<div class="meal-entry${isCustom ? " meal-entry--custom" : ""}${entry.cookedAt ? " meal-entry--cooked" : ""}" data-entry-id="${entry.id}">
${entryThumbHtml(entry)}
<div class="meal-entry-body">
${titleHtml}
<div class="meal-entry-meta">
${metaHtml}
${cookedBtnHtml}
<button class="meal-entry-remove" data-entry-id="${entry.id}" title="Entfernen" type="button">×</button>
</div>
</div>
</div>
`;
}

// Gruppiert die flache Eintragsliste eines Zeitfensters nach ihrem
// gemeinsamen "geplanten Essen" (plannedMealId). Ein einzelnes Rezept bleibt
// dabei einfach eine Gruppe mit genau einem Eintrag - der einfache Fall sieht
// optisch weiterhin genauso aus wie zuvor.
function groupEntriesByMeal(entries) {
const order = [];
const byMeal = new Map();
for (const e of entries) {
const key = e.plannedMealId || `solo:${e.id}`;
if (!byMeal.has(key)) {
byMeal.set(key, { plannedMealId: e.plannedMealId || null, mealTitle: e.mealTitle || null, entries: [] });
order.push(key);
}
byMeal.get(key).entries.push(e);
}
return order.map((k) => {
const g = byMeal.get(k);
g.entries.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
return g;
});
}

// Rendert eine Essens-Gruppe. Bei genau einer Komponente ohne Titel ist das
// Ergebnis optisch identisch zum bisherigen Einzel-Chip (kein Rahmen, kein
// Titel-Header) - erst ab zwei Komponenten oder gesetztem Titel erscheint der
// Gruppen-Rahmen mit Titel, Umbenennen- und "Als Kombination speichern"-Aktion.
function mealGroupHtml(group, mealTypeKey, entryRenderer) {
const isMulti = group.entries.length > 1 || !!group.mealTitle;
const entriesHtml = group.entries.map(entryRenderer).join("");
const canExtend = !!group.plannedMealId;
const hasRecipeComponent = group.entries.some((e) => e.recipeId);
const headerHtml = isMulti
? `<div class="meal-group-header">
<span class="meal-group-title">${escapeHtml(group.mealTitle || "Essen")}</span>
${
canExtend
? `<button class="meal-group-rename" data-planned-meal-id="${group.plannedMealId}" title="Titel ändern" type="button">✎</button>`
: ""
}
${
canExtend && hasRecipeComponent
? `<button class="meal-group-save-combo" data-planned-meal-id="${group.plannedMealId}" title="Als Kombination speichern" type="button">💾</button>`
: ""
}
</div>`
: "";
const addComponentHtml = canExtend
? `<select class="component-add-select" data-planned-meal-id="${group.plannedMealId}" data-meal-type="${mealTypeKey}">
<option value="">+ Komponente…</option> <option value="__custom__">✏️ Anderes…</option> ${recipeOptionsHtml(mealTypeKey)}
</select>`
: "";
return `
<div class="meal-group${isMulti ? " meal-group--multi" : ""}" data-planned-meal-id="${group.plannedMealId || ""}">
${headerHtml}
<div class="meal-group-entries">${entriesHtml}</div>
${addComponentHtml}
</div>
`;
}

function cellHtml(iso, mealTypeKey, entries) { const groups = groupEntriesByMeal(entries); const groupsHtml = groups.map((g) => mealGroupHtml(g, mealTypeKey, entryChipHtml)).join(""); return `<div class="timetable-cell" data-date="${iso}" data-meal-type="${mealTypeKey}"><div class="meal-entries">${groupsHtml}</div><select class="meal-add-select meal-add-select--${mealTypeKey}" data-date="${iso}" data-meal-type="${mealTypeKey}"><option value="">+ Rezept…</option><option value="__custom__">✏️ Anderes (ohne Rezept)…</option> ${quickCustomOptionsHtml()} ${recipeOptionsHtml(mealTypeKey)} ${comboOptionsHtml()}</select></div>`; } function buildTimetable(entries) { const byKey = {}; for (const e of entries) { const key = `${e.date}|${e.mealType}`; (byKey[key] ||= []).push(e); } const todayIso = formatDateISO(today); const dayIsos = Array.from({ length: 7 }, (_, i) => formatDateISO(addDays(currentWeekStart, i))); let html = `<div class="timetable-corner"></div>`; dayIsos.forEach((iso, i) => { const date = addDays(currentWeekStart, i); const isToday = iso === todayIso; html += `<div class="timetable-daylabel ${isToday ? "timetable-daylabel--today" : ""}"><span class="day-name">${WEEKDAY_LABELS_DE[i]}</span><span class="day-date text-muted">${formatDateDisplay(date)}</span>${dayCaloriesHtml(iso)}</div>`; }); for (const mt of MEAL_TYPES) { html += `<div class="timetable-mealrow-label timetable-mealrow-label--${mt.key}"><span class="meal-icon">${mt.icon}</span><span class="meal-label">${mt.label}</span></div>`; for (const iso of dayIsos) { const cellEntries = byKey[`${iso}|${mt.key}`] || []; html += cellHtml(iso, mt.key, cellEntries); } } planEl.innerHTML = html; planEl.style.setProperty("--meal-row-count", MEAL_TYPES.length); wireCells(); } function agendaEntryHtml(entry) { const isCustom = !entry.recipeId; const priceLabel = isCustom && entry.customPrice !== null && entry.customPrice !== undefined ? `<span class="meal-entry-price">${formatPrice(entry.customPrice)} €</span>` : ""; const titleHtml = isCustom ? `<span class="agenda-entry-title">${escapeHtml(entry.recipeTitle)}</span>` : `<a href="#/rezepte/${entry.recipeId}" class="agenda-entry-title">${escapeHtml(entry.recipeTitle)}</a>`; const metaHtml = isCustom ? priceLabel : `<input type="number" min="1" step="1" class="meal-entry-servings" data-entry-id="${entry.id}" value="${entry.servings}" />`; const cookedBtnHtml = isCustom ? "" : `<button class="meal-entry-cooked${entry.cookedAt ? " meal-entry-cooked--active" : ""}" data-entry-id="${entry.id}" title="${entry.cookedAt ? "Als gekocht markiert – erneut klicken zum Zurücksetzen" : "Als gekocht markieren"}" type="button">${entry.cookedAt ? "✅" : "☐"}</button>`; return `<div class="agenda-entry${isCustom ? " agenda-entry--custom" : ""}${entry.cookedAt ? " agenda-entry--cooked" : ""}" data-entry-id="${entry.id}">${entryThumbHtml(entry)}${titleHtml}<div class="agenda-entry-meta">${metaHtml}${cookedBtnHtml}<button class="meal-entry-remove" data-entry-id="${entry.id}" title="Entfernen" type="button">×</button></div></div>`; } function agendaMealRowHtml(iso, mt, entries) { const groups = groupEntriesByMeal(entries); const groupsHtml = groups.map((g) => mealGroupHtml(g, mt.key, agendaEntryHtml)).join(""); return `<div class="agenda-meal-row" data-date="${iso}" data-meal-type="${mt.key}"><div class="agenda-meal-label"><span class="meal-icon">${mt.icon}</span><span class="meal-label">${mt.label}</span></div><div class="agenda-meal-content">${groupsHtml || `<p class="agenda-meal-empty text-muted text-small">Nichts geplant</p>`}<select class="meal-add-select meal-add-select--${mt.key}" data-date="${iso}" data-meal-type="${mt.key}"><option value="">+ Rezept…</option><option value="__custom__">✏️ Anderes (ohne Rezept)…</option> ${quickCustomOptionsHtml()} ${recipeOptionsHtml(mt.key)} ${comboOptionsHtml()}</select></div></div>`; } function buildAgenda(entries) {
const byKey = {};
for (const e of entries) {
const key = `${e.date}|${e.mealType}`;
(byKey[key] ||= []).push(e);
}

const todayIso = formatDateISO(today);
const dayIsos = Array.from({ length: 7 }, (_, i) => formatDateISO(addDays(currentWeekStart, i)));

let html = "";
dayIsos.forEach((iso, i) => {
const date = addDays(currentWeekStart, i);
const isToday = iso === todayIso;
html += `
<div class="agenda-day ${isToday ? "agenda-day--today" : ""}">
<div class="agenda-day-header">
<span class="agenda-day-name">${WEEKDAY_LABELS_DE[i]}</span>
<span class="agenda-day-date text-muted">${formatDateDisplay(date)}</span>${dayCaloriesHtml(iso)}
</div>
${MEAL_TYPES.map((mt) => agendaMealRowHtml(iso, mt, byKey[`${iso}|${mt.key}`] || [])).join("")}
</div>
`;
});

planEl.innerHTML = html;
wireCells();
}

function renderPlan() {
if (viewMode === "list") {
planWrap.className = "plan-wrap agenda-wrap";
planEl.className = "agenda-list";
buildAgenda(currentEntries);
} else {
planWrap.className = "plan-wrap timetable-scroll";
planEl.className = "timetable";
buildTimetable(currentEntries);
}
}

  function wireCells() {
planEl.querySelectorAll(".meal-add-select").forEach((select) => {
select.addEventListener("change", async () => {
const value = select.value;
if (!value) return;
const date = select.dataset.date;
const mealType = select.dataset.mealType;
if (value === "__custom__") { const title = prompt("Wie soll dieses Essen heißen? (z. B. \"Brötchenfrühstück\" oder einfach \"Döner\")"); if (!title || !title.trim()) { select.value = ""; return; } const itemsInput = prompt("Weitere Posten dazu, durch Komma getrennt (optional) – z. B. \"5 Brötchen, Fleischsalat, Lachs, Krabbensalat\":", ""); const extraItems = itemsInput ? itemsInput.split(",").map((s) => s.trim()).filter(Boolean) : []; const priceInput = prompt("Kosten in € (optional, leer lassen zum Überspringen):", ""); let price = null; if (priceInput !== null && priceInput.trim() !== "") { const parsed = Number(priceInput.trim().replace(",", ".")); if (Number.isFinite(parsed) && parsed >= 0) price = parsed; } select.disabled = true; try { await addCustomMealPlanEntry(date, mealType, title.trim(), price, extraItems); try { recentCustomMeals = await listRecentCustomMealTitles(); } catch {} await load(); } catch (err) { alert("Konnte Eintrag nicht speichern: " + err.message); select.disabled = false; select.value = ""; } return; }
if (value.startsWith("quick:")) { const idx = Number(value.slice("quick:".length)); const meal = recentCustomMeals[idx]; if (!meal) { select.value = ""; return; } select.disabled = true; try { await addCustomMealPlanEntry(date, mealType, meal.title, meal.price); await load(); } catch (err) { alert("Konnte Eintrag nicht speichern: " + err.message); select.disabled = false; select.value = ""; } return; } if (value.startsWith("combo:")) {
const combinationId = value.slice("combo:".length);
select.disabled = true;
try {
await applyCombinationToSlot(date, mealType, combinationId);
await load();
} catch (err) {
alert("Konnte Kombination nicht einfügen: " + err.message);
select.disabled = false;
select.value = "";
}
return;
}
const recipeId = value;
const recipe = allRecipes.find((r) => r.id === recipeId);
const servings = recipe ? Math.max(1, Math.round(recipe.servingsBase)) : 2;
const dayCount = armTwoDays ? 2 : 1;
select.disabled = true;
try {
await addMealPlanEntryForDays(date, recipeId, servings, mealType, dayCount);
setArmTwoDays(false);
await load();
} catch (err) {
alert("Konnte Rezept nicht hinzufügen: " + err.message);
select.disabled = false;
}
});
});

planEl.querySelectorAll(".component-add-select").forEach((select) => { select.addEventListener("change", async () => { const value = select.value; if (!value) return; const plannedMealId = select.dataset.plannedMealId; const group = currentEntries.filter((e) => e.plannedMealId === plannedMealId); const needsTitle = group.length === 1 && !group[0]?.mealTitle; let title = null; if (needsTitle) { title = prompt( "Wie soll dieses Essen heißen (z. B. \"Raclette-Abend\")? Ab zwei Komponenten ist ein Titel Pflicht." ); if (!title || !title.trim()) { select.value = ""; return; } } select.disabled = true; try { if (value === "__custom__") { const itemTitle = prompt("Welcher Posten (ohne Rezept)?"); if (!itemTitle || !itemTitle.trim()) { select.disabled = false; select.value = ""; return; } await addCustomComponentToPlannedMeal(plannedMealId, itemTitle.trim()); } else { const recipe = allRecipes.find((r) => r.id === value); const servings = recipe ? Math.max(1, Math.round(recipe.servingsBase)) : 2; await addComponentToPlannedMeal(plannedMealId, value, servings); } if (title) await renamePlannedMeal(plannedMealId, title.trim()); await load(); } catch (err) { alert("Konnte Komponente nicht hinzufügen: " + err.message); select.disabled = false; select.value = ""; } }); });

planEl.querySelectorAll(".meal-group-rename").forEach((btn) => {
btn.addEventListener("click", async () => {
const plannedMealId = btn.dataset.plannedMealId;
const group = currentEntries.filter((e) => e.plannedMealId === plannedMealId);
const current = group[0]?.mealTitle || "";
const title = prompt("Titel für dieses Essen:", current);
if (title === null) return;
if (!title.trim()) {
alert("Ein Titel ist erforderlich, solange dieses Essen mehrere Komponenten hat.");
return;
}
btn.disabled = true;
try {
await renamePlannedMeal(plannedMealId, title.trim());
await load();
} catch (err) {
alert("Konnte Titel nicht speichern: " + err.message);
btn.disabled = false;
}
});
});

planEl.querySelectorAll(".meal-group-save-combo").forEach((btn) => {
btn.addEventListener("click", async () => {
const plannedMealId = btn.dataset.plannedMealId;
const group = currentEntries.filter((e) => e.plannedMealId === plannedMealId);
const suggested = group[0]?.mealTitle || "";
const title = prompt("Name für die neue Kombination:", suggested);
if (!title || !title.trim()) return;
btn.disabled = true;
try {
await saveMealAsCombination(plannedMealId, title.trim());
allCombinations = await listMealCombinations();
renderPlan();
alert(`Kombination "${title.trim()}" gespeichert. Du findest sie ab jetzt in der Rezeptauswahl jedes Zeitfensters.`);
} catch (err) {
alert("Konnte Kombination nicht speichern: " + err.message);
} finally {
btn.disabled = false;
}
});
});

planEl.querySelectorAll(".meal-entry-remove").forEach((btn) => {
btn.addEventListener("click", async () => {
btn.disabled = true;
try {
await removeMealPlanEntry(btn.dataset.entryId);
await load();
} catch (err) {
alert("Konnte nicht entfernen: " + err.message);
btn.disabled = false;
}
});
});

planEl.querySelectorAll(".meal-entry-cooked").forEach((btn) => {
btn.addEventListener("click", async () => {
btn.disabled = true;
try {
const result = await markMealPlanEntryCooked(btn.dataset.entryId);
if (result.bonusPoints > 0) {
cookedStatus.textContent = `+${result.bonusPoints} 🦫 Restlos verwertet, bevor's schlecht wurde!`;
setTimeout(() => {
cookedStatus.textContent = "";
}, 4000);
}
await load();
} catch (err) {
alert("Konnte nicht speichern: " + err.message);
btn.disabled = false;
}
});
});

planEl.querySelectorAll(".meal-entry-servings").forEach((input) => {
input.addEventListener("change", async () => {
const value = Math.max(1, Number(input.value) || 1);
input.value = value;
try {
await updateMealPlanEntryServings(input.dataset.entryId, value);
} catch (err) {
alert("Konnte Portionen nicht speichern: " + err.message);
}
});
});
}

  async function load() {
const weekEnd = addDays(currentWeekStart, 6);
const start = formatDateISO(currentWeekStart);
const end = formatDateISO(weekEnd);
rangeLabel.textContent = `${formatDateDisplay(currentWeekStart)} – ${formatDateDisplay(weekEnd)}`;

planEl.innerHTML = `<p class="text-muted">Lade Plan…</p>`;
try {
currentEntries = await listMealPlanEntries(start, end);
} catch (err) {
planEl.innerHTML = `<p class="form-error">Plan konnte nicht geladen werden: ${escapeHtml(
err.message
)}</p>`;
return;
}

renderPlan();
}

container.querySelector("#prev-week-btn").addEventListener("click", () => {
currentWeekStart = addDays(currentWeekStart, -7);
load();
});
container.querySelector("#next-week-btn").addEventListener("click", () => {
currentWeekStart = addDays(currentWeekStart, 7);
load();
});
container.querySelector("#today-week-btn").addEventListener("click", () => {
currentWeekStart = getWeekStart(new Date(), weekStartDay);
load();
});

copyWeekBtn.addEventListener("click", () => {
weekCopyRow.hidden = !weekCopyRow.hidden;
weekCopyStatus.textContent = "";
if (!weekCopyRow.hidden && !weekCopyTarget.value) {
weekCopyTarget.value = formatDateISO(addDays(currentWeekStart, 7));
}
});

clearWeekBtn.addEventListener("click", async () => {
  const start = formatDateISO(currentWeekStart);
  const end = formatDateISO(addDays(currentWeekStart, 6));
  const label = `${formatDateDisplay(currentWeekStart)} – ${formatDateDisplay(addDays(currentWeekStart, 6))}`;
  if (!confirm(`Wirklich ALLE Einträge der Woche ${label} löschen? Das kann nicht rückgängig gemacht werden.`)) return;
  clearWeekBtn.disabled = true;
  try {
    await clearMealPlanWeek(start, end);
    await load();
  } catch (err) {
    alert("Woche konnte nicht geleert werden: " + err.message);
  } finally {
    clearWeekBtn.disabled = false;
  }
});

weekCopyCancelBtn.addEventListener("click", () => {
weekCopyRow.hidden = true;
});

  weekCopyConfirmBtn.addEventListener("click", async () => {
if (!weekCopyTarget.value) {
weekCopyStatus.textContent = "Bitte ein Zieldatum waehlen.";
return;
}
const targetWeekStart = getWeekStart(new Date(`${weekCopyTarget.value}T00:00:00`), weekStartDay);
const targetStartIso = formatDateISO(targetWeekStart);
weekCopyConfirmBtn.disabled = true;
weekCopyStatus.textContent = "Kopiere…";
try {
const start = formatDateISO(currentWeekStart);
const end = formatDateISO(addDays(currentWeekStart, 6));
const count = await copyMealPlanWeek(start, end, targetStartIso);
weekCopyStatus.textContent =
count > 0
? `${count} Mahlzeit${count === 1 ? "" : "en"} in Zielwoche kopiert.`
: "Diese Woche hat keine Eintraege zum Kopieren.";
weekCopyConfirmBtn.disabled = false;
if (count > 0) {
if (formatDateISO(currentWeekStart) === formatDateISO(targetWeekStart)) {
await load();
}
setTimeout(() => {
weekCopyRow.hidden = true;
}, 2500);
}
} catch (err) {
weekCopyStatus.textContent = "Fehler: " + err.message;
weekCopyConfirmBtn.disabled = false;
}
});

shoppingBtn.addEventListener("click", async () => {
shoppingBtn.disabled = true;
const originalLabel = shoppingBtn.textContent;
shoppingBtn.textContent = "Erstelle…";
try {
const start = formatDateISO(currentWeekStart);
const end = formatDateISO(addDays(currentWeekStart, 6));
const result = await generateShoppingList(start, end);
if (result && result.skipped && result.skipped.length > 0) {
const n = result.skipped.length;
alert(
`Einkaufsliste erstellt. ${n} Zutat${n === 1 ? "" : "en"} war${n === 1 ? "" : "en"} bereits im Vorrat und wurde${n === 1 ? "" : "n"} deshalb nicht mit aufgenommen: ${result.skipped.join(", ")}.`
);
}
navigate("/einkaufsliste");
} catch (err) {
alert("Einkaufsliste konnte nicht erstellt werden: " + err.message);
shoppingBtn.disabled = false;
shoppingBtn.textContent = originalLabel;
}
});

  function suggestionCardHtml(item) {
const r = item.recipe;
const badge =
item.expiringMatchedCount > 0
? `<span class="chip suggestion-chip suggestion-chip--expiring">⏰ nutzt ${item.expiringMatchedCount} bald ablaufende Zutat${
item.expiringMatchedCount === 1 ? "" : "en"
}</span>`
: "";
return `
<div class="suggestion-item" data-recipe-id="${r.id}">
${
r.imageUrl
? `<img src="${escapeHtml(r.imageUrl)}" alt="" class="suggestion-image" />`
: `<div class="suggestion-image suggestion-image--empty" aria-hidden="true">🍲</div>`
}
<div class="suggestion-body">
<a href="#/rezepte/${r.id}" class="suggestion-title">${escapeHtml(r.title)}</a>
<div class="chip-row">
<span class="chip suggestion-chip">${item.matchedCount}/${item.totalCount} Zutaten im Vorrat</span>
${badge}
</div>
</div>
<button class="btn btn-secondary btn-small suggestion-add" data-recipe-id="${r.id}" type="button">+ Heute einplanen</button>
</div>
`;
}

async function loadSuggestions() {
let suggestions = [];
try {
suggestions = await suggestRecipesFromInventory(4);
} catch {
suggestions = [];
}
if (suggestions.length === 0) {
suggestionCard.hidden = true;
return;
}
suggestionCard.hidden = false;
suggestionList.innerHTML = suggestions.map(suggestionCardHtml).join("");

suggestionList.querySelectorAll(".suggestion-add").forEach((btn) => {
btn.addEventListener("click", async () => {
const recipeId = btn.dataset.recipeId;
const recipe = allRecipes.find((r) => r.id === recipeId);
if (!recipe) return;
const mealType = (recipe.mealTypes && recipe.mealTypes[0]) || "mittag";
const servings = Math.max(1, Math.round(recipe.servingsBase));
const todayIso = formatDateISO(today);
btn.disabled = true;
btn.textContent = "Eingeplant…";
try {
await addMealPlanEntryForDays(todayIso, recipeId, servings, mealType, 1);
if (formatDateISO(currentWeekStart) === formatDateISO(getWeekStart(today, weekStartDay))) {
await load();
}
} catch (err) {
alert("Konnte Rezept nicht einplanen: " + err.message);
btn.disabled = false;
btn.textContent = "+ Heute einplanen";
}
});
});
}

await loadSuggestions();
await load();
}
