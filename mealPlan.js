import {
  listRecipes,
  listMealPlanEntries,
  addMealPlanEntry,
  removeMealPlanEntry,
  updateMealPlanEntryServings,
  generateShoppingList,
} from "./db.js";
import {
  escapeHtml,
  getWeekStart,
  addDays,
  formatDateISO,
  formatDateDisplay,
  WEEKDAY_LABELS_DE,
} from "./utils.js";
import { navigate } from "./router.js";

export async function renderMealPlan(container) {
  const today = new Date();
  let currentWeekStart = getWeekStart(today);

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Wochenplan</h1>
        <p class="text-muted" id="week-range-label"></p>
      </div>
      <div class="detail-actions">
        <button id="prev-week-btn" class="btn btn-secondary btn-small" type="button">← Vorige</button>
        <button id="today-week-btn" class="btn btn-secondary btn-small" type="button">Diese Woche</button>
        <button id="next-week-btn" class="btn btn-secondary btn-small" type="button">Nächste →</button>
      </div>
    </div>

    <div id="week-grid" class="week-grid"></div>

    <div class="week-footer">
      <a href="#/einkaufsliste" class="btn btn-secondary">Einkaufsliste ansehen</a>
      <button id="make-shopping-list-btn" class="btn btn-primary" type="button">
        Einkaufsliste aus dieser Woche erstellen
      </button>
    </div>
  `;

  const weekGrid = container.querySelector("#week-grid");
  const rangeLabel = container.querySelector("#week-range-label");
  const shoppingBtn = container.querySelector("#make-shopping-list-btn");

  let allRecipes = [];
  try {
    allRecipes = await listRecipes();
  } catch (err) {
    weekGrid.innerHTML = `<p class="form-error">Rezepte konnten nicht geladen werden: ${escapeHtml(
      err.message
    )}</p>`;
    return;
  }

  function recipeOptionsHtml() {
    return allRecipes.map((r) => `<option value="${r.id}">${escapeHtml(r.title)}</option>`).join("");
  }

  function entryHtml(entry) {
    return `
      <div class="day-entry" data-entry-id="${entry.id}">
        <a href="#/rezepte/${entry.recipeId}" class="day-entry-title">${escapeHtml(entry.recipeTitle)}</a>
        <div class="day-entry-meta">
          <input
            type="number" min="1" step="1" class="day-entry-servings"
            data-entry-id="${entry.id}" value="${entry.servings}"
          />
          <span class="text-small text-muted">Port.</span>
          <button class="row-remove day-entry-remove" data-entry-id="${entry.id}" title="Entfernen" type="button">×</button>
        </div>
      </div>
    `;
  }

  function dayCardHtml(iso, weekdayLabel, date, entries, isToday) {
    const entriesHtml = entries.length
      ? entries.map(entryHtml).join("")
      : `<p class="day-empty text-small text-muted">Kein Rezept geplant</p>`;

    return `
      <div class="day-card ${isToday ? "day-card--today" : ""}">
        <div class="day-card-header">
          <span class="day-name">${weekdayLabel}</span>
          <span class="day-date text-muted">${formatDateDisplay(date)}</span>
        </div>
        <div class="day-entries">${entriesHtml}</div>
        <select class="day-add-select select" data-date="${iso}">
          <option value="">+ Rezept hinzufügen…</option>
          ${recipeOptionsHtml()}
        </select>
      </div>
    `;
  }

  function wireDayCards() {
    weekGrid.querySelectorAll(".day-add-select").forEach((select) => {
      select.addEventListener("change", async () => {
        const recipeId = select.value;
        if (!recipeId) return;
        const date = select.dataset.date;
        const recipe = allRecipes.find((r) => r.id === recipeId);
        const servings = recipe ? Math.max(1, Math.round(recipe.servingsBase)) : 2;
        select.disabled = true;
        try {
          await addMealPlanEntry(date, recipeId, servings);
          await load();
        } catch (err) {
          alert("Konnte Rezept nicht hinzufügen: " + err.message);
          select.disabled = false;
        }
      });
    });

    weekGrid.querySelectorAll(".day-entry-remove").forEach((btn) => {
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

    weekGrid.querySelectorAll(".day-entry-servings").forEach((input) => {
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

    weekGrid.innerHTML = `<p class="text-muted">Lade Plan…</p>`;
    let entries = [];
    try {
      entries = await listMealPlanEntries(start, end);
    } catch (err) {
      weekGrid.innerHTML = `<p class="form-error">Plan konnte nicht geladen werden: ${escapeHtml(
        err.message
      )}</p>`;
      return;
    }

    const entriesByDate = {};
    for (const e of entries) {
      (entriesByDate[e.date] ||= []).push(e);
    }

    const todayIso = formatDateISO(today);
    weekGrid.innerHTML = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(currentWeekStart, i);
      const iso = formatDateISO(date);
      return dayCardHtml(iso, WEEKDAY_LABELS_DE[i], date, entriesByDate[iso] || [], iso === todayIso);
    }).join("");

    wireDayCards();
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
    currentWeekStart = getWeekStart(new Date());
    load();
  });

  shoppingBtn.addEventListener("click", async () => {
    shoppingBtn.disabled = true;
    const originalLabel = shoppingBtn.textContent;
    shoppingBtn.textContent = "Erstelle…";
    try {
      const start = formatDateISO(currentWeekStart);
      const end = formatDateISO(addDays(currentWeekStart, 6));
      await generateShoppingList(start, end);
      navigate("/einkaufsliste");
    } catch (err) {
      alert("Einkaufsliste konnte nicht erstellt werden: " + err.message);
      shoppingBtn.disabled = false;
      shoppingBtn.textContent = originalLabel;
    }
  });

  await load();
}
