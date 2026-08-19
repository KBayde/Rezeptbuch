import {
    listRecipes,
    listMealPlanEntries,
    addMealPlanEntryForDays,
    removeMealPlanEntry,
    updateMealPlanEntryServings,
        copyMealPlanWeek,
    generateShoppingList,
    suggestRecipesFromInventory,
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
                                                                <button id="copy-week-btn" class="btn btn-secondary btn-small" type="button">📋 Woche kopieren</button>
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
    const suggestionCard = container.querySelector("#suggestion-card");
    const suggestionList = container.querySelector("#suggestion-list");
      const copyWeekBtn = container.querySelector("#copy-week-btn");
      const weekCopyRow = container.querySelector("#week-copy-row");
      const weekCopyTarget = container.querySelector("#week-copy-target");
      const weekCopyConfirmBtn = container.querySelector("#week-copy-confirm-btn");
      const weekCopyCancelBtn = container.querySelector("#week-copy-cancel-btn");
      const weekCopyStatus = container.querySelector("#week-copy-status");

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

  function recipeOptionsHtml(mealTypeKey) {
        return allRecipes
          .filter((r) => !r.mealTypes || r.mealTypes.length === 0 || r.mealTypes.includes(mealTypeKey))
          .map((r) => `<option value="${r.id}">${escapeHtml(r.title)}</option>`)
          .join("");
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
                              <select class="meal-add-select meal-add-select--${mealTypeKey}" data-date="${iso}" data-meal-type="${mealTypeKey}">
                                        <option value="">+ Rezept…</option>
                                                  ${recipeOptionsHtml(mealTypeKey)}
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

  copyWeekBtn.addEventListener("click", () => {
        weekCopyRow.hidden = !weekCopyRow.hidden;
        weekCopyStatus.textContent = "";
        if (!weekCopyRow.hidden && !weekCopyTarget.value) {
                weekCopyTarget.value = formatDateISO(addDays(currentWeekStart, 7));
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
          const targetWeekStart = getWeekStart(new Date(`${weekCopyTarget.value}T00:00:00`));
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
                await generateShoppingList(start, end);
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
                                    if (formatDateISO(currentWeekStart) === formatDateISO(getWeekStart(today))) {
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
