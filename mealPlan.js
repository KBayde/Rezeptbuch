import {
  listRecipes,
  listMealPlanEntries,
  addMealPlanEntryForDays,
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
  MEAL_TYPES,
} from "./utils.js";
import { navigate } from "./router.js";

export async function renderMealPlan(container) {
  const today = new Date();
  let currentWeekStart = getWeekStart(today);
  // "Arming" eines Zwei-Tage-Eintrags: einmal aktivieren, gilt für die
  // nächste Rezept-Auswahl, dann automatisch wieder aus.
  let armTwoDays = false;

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

    <div class="two-day-toggle-row">
      <button id="two-day-toggle" class="chip chip-toggle" type="button" title="Bei der nächsten Rezeptauswahl auch für den Folgetag einplanen">
        🗓️ Nächste Auswahl auch für Folgetag planen
      </button>
      <span id="two-day-hint" class="text-small text-muted" hidden>Aktiv – wähle jetzt ein Rezept aus.</span>
    </div>

    <div class="timetable-scroll">
      <div id="timetable" class="timetable"></div>
    </div>

    <div class="week-footer">
      <a href="#/einkaufsliste" class="btn btn-secondary">Einkaufsliste ansehen</a>
      <button id="make-shopping-list-btn" class="btn btn-primary" type="button">
        Einkaufsliste aus dieser Woche erstellen
      </button>
    </div>
  `;

  const timetable = container.querySelector("#timetable");
  const rangeLabel = container.querySelector("#week-range-label");
  const shoppingBtn = container.querySelector("#make-shopping-list-btn");
  const twoDayToggle = container.querySelector("#two-day-toggle");
  const twoDayHint = container.querySelector("#two-day-hint");

  let allRecipes = [];
  try {
    allRecipes = await listRecipes();
  } catch (err) {
    timetable.innerHTML = `<p class="form-error">Rezepte konnten nicht geladen werden: ${escapeHtml(
      err.message
    )}</p>`;
    return;
  }

  function setArmTwoDays(value) {
    armTwoDays = value;
    twoDayToggle.classList.toggle("chip-toggle--active", value);
    twoDayHint.hidden = !value;
  }

  twoDayToggle.addEventListener("click", () => setArmTwoDays(!armTwoDays));

  function recipeOptionsHtml() {
    return allRecipes.map((r) => `<option value="${r.id}">${escapeHtml(r.title)}</option>`).join("");
  }

  function entryChipHtml(entry) {
    return `
      <div class="meal-entry" data-entry-id="${entry.id}">
        <a href="#/rezepte/${entry.recipeId}" class="meal-entry-title">${escapeHtml(entry.recipeTitle)}</a>
        <div class="meal-entry-meta">
          <input
            type="number" min="1" step="1" class="meal-entry-servings"
            data-entry-id="${entry.id}" value="${entry.servings}"
          />
          <button class="meal-entry-remove" data-entry-id="${entry.id}" title="Entfernen" type="button">×</button>
        </div>
      </div>
    `;
  }

  function cellHtml(iso, mealTypeKey, entries) {
    const entriesHtml = entries.map(entryChipHtml).join("");
    return `
      <div class="timetable-cell" data-date="${iso}" data-meal-type="${mealTypeKey}">
        <div class="meal-entries">${entriesHtml}</div>
        <select class="meal-add-select" data-date="${iso}" data-meal-type="${mealTypeKey}">
          <option value="">+ Rezept…</option>
          ${recipeOptionsHtml()}
        </select>
      </div>
    `;
  }

  function buildTimetable(entries) {
    const byKey = {};
    for (const e of entries) {
      const key = `${e.date}|${e.mealType}`;
      (byKey[key] ||= []).push(e);
    }

    const todayIso = formatDateISO(today);
    const dayIsos = Array.from({ length: 7 }, (_, i) => formatDateISO(addDays(currentWeekStart, i)));

    let html = `<div class="timetable-corner"></div>`;
    dayIsos.forEach((iso, i) => {
      const date = addDays(currentWeekStart, i);
      const isToday = iso === todayIso;
      html += `
        <div class="timetable-daylabel ${isToday ? "timetable-daylabel--today" : ""}">
          <span class="day-name">${WEEKDAY_LABELS_DE[i]}</span>
          <span class="day-date text-muted">${formatDateDisplay(date)}</span>
        </div>
      `;
    });

    for (const mt of MEAL_TYPES) {
      html += `
        <div class="timetable-mealrow-label timetable-mealrow-label--${mt.key}">
          <span class="meal-icon">${mt.icon}</span>
          <span class="meal-label">${mt.label}</span>
        </div>
      `;
      for (const iso of dayIsos) {
        const cellEntries = byKey[`${iso}|${mt.key}`] || [];
        html += cellHtml(iso, mt.key, cellEntries);
      }
    }

    timetable.innerHTML = html;
    timetable.style.setProperty("--meal-row-count", MEAL_TYPES.length);
    wireCells();
  }

  function wireCells() {
    timetable.querySelectorAll(".meal-add-select").forEach((select) => {
      select.addEventListener("change", async () => {
        const recipeId = select.value;
        if (!recipeId) return;
        const date = select.dataset.date;
        const mealType = select.dataset.mealType;
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

    timetable.querySelectorAll(".meal-entry-remove").forEach((btn) => {
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

    timetable.querySelectorAll(".meal-entry-servings").forEach((input) => {
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

    timetable.innerHTML = `<p class="text-muted">Lade Plan…</p>`;
    let entries = [];
    try {
      entries = await listMealPlanEntries(start, end);
    } catch (err) {
      timetable.innerHTML = `<p class="form-error">Plan konnte nicht geladen werden: ${escapeHtml(
        err.message
      )}</p>`;
      return;
    }

    buildTimetable(entries);
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
