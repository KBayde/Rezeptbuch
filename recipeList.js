import { listRecipes, getExpiringInventoryItems, listTags } from "./db.js";
import { debounce, escapeHtml, formatMinutes, MEAL_TYPES } from "./utils.js";
import { navigate } from "./router.js";

export async function renderRecipeList(container) {
    container.innerHTML = `
        <div class="expiry-hint card" id="expiry-hint" hidden>
              <span id="expiry-hint-text"></span>
                    <a href="#/vorrat" class="btn btn-secondary btn-small">Zum Vorrat →</a>
                        </div>

                            <div class="page-header">
                                  <div>
                                          <h1>Rezepte</h1>
                                                  <p class="text-muted" id="recipe-count"></p>
                                                        </div>
                                                              <div class="detail-actions">
                                                                      <a href="#/rezepte/foto-import" class="btn btn-secondary">📷 Per Foto</a>
                                                                              <a href="#/rezepte/youtube-import" class="btn btn-secondary">▶️ Per YouTube</a>
                                                                                      <a href="#/rezepte/link-import" class="btn btn-secondary">🔗 Per Link</a>
                                                                                              <a href="#/rezepte/neu" class="btn btn-primary">+ Neues Rezept</a>
                                                                                                    </div>
                                                                                                        </div>
                                                                                                        
                                                                                                            <div class="toolbar toolbar--wrap">
      <input
        type="search"
        id="search-input"
        class="search-input"
        placeholder="Suche nach Titel oder Zutat…"
      />
      <select id="filter-mealtype" class="select">
        <option value="">Alle Tageszeiten</option>
      </select>
      <select id="filter-dish" class="select">
        <option value="">Alle Gerichtarten</option>
      </select>
      <select id="filter-ingredient" class="select">
        <option value="">Alle Zutaten</option>
      </select>
      <select id="filter-cuisine" class="select">
        <option value="">Alle Küchen</option>
      </select>
    </div>
                                                                                                                                                                                
                                                                                                                                                                                    <div id="recipe-grid" class="recipe-grid"></div>
                                                                                                                                                                                        <p id="empty-state" class="empty-state" hidden>Keine Rezepte gefunden.</p>
                                                                                                                                                                                          `;

  const grid = container.querySelector("#recipe-grid");
    const countEl = container.querySelector("#recipe-count");
    const emptyState = container.querySelector("#empty-state");
    const searchInput = container.querySelector("#search-input");
    const mealTypeFilter = container.querySelector("#filter-mealtype");
    const dishFilter = container.querySelector("#filter-dish");
    const ingredientFilter = container.querySelector("#filter-ingredient");
    const cuisineFilter = container.querySelector("#filter-cuisine");

  grid.innerHTML = `<p class="text-muted">Lade Rezepte…</p>`;

  let allRecipes = [];
    let allTagRows = [];
    try {
      [allRecipes, allTagRows] = await Promise.all([listRecipes(), listTags()]);
    } catch (err) {
          grid.innerHTML = `<p class="form-error">Rezepte konnten nicht geladen werden: ${escapeHtml(err.message)}</p>`;
          return;
    }

  const tagCategoryByName = new Map(allTagRows.map((t) => [t.name, t.category || "sonstiges"]));
    const usedTags = [...new Set(allRecipes.flatMap((r) => r.tags))];
    function tagsByCategory(cat) {
      return usedTags
        .filter((t) => (tagCategoryByName.get(t) || "sonstiges") === cat)
        .sort((a, b) => a.localeCompare(b, "de"));
    }

    mealTypeFilter.innerHTML =
      `<option value="">Alle Tageszeiten</option>` +
      MEAL_TYPES.map((mt) => `<option value="$\{mt.key}">$\{mt.icon} $\{escapeHtml(mt.label)}</option>`).join("");

    dishFilter.innerHTML =
      `<option value="">Alle Gerichtarten</option>` +
      tagsByCategory("gerichtart").map((t) => `<option value="$\{escapeHtml(t)}">$\{escapeHtml(t)}</option>`).join("");

    ingredientFilter.innerHTML =
      `<option value="">Alle Zutaten</option>` +
      tagsByCategory("zutat").map((t) => `<option value="$\{escapeHtml(t)}">$\{escapeHtml(t)}</option>`).join("");

    cuisineFilter.innerHTML =
      `<option value="">Alle Küchen</option>` +
      tagsByCategory("kueche").map((t) => `<option value="$\{escapeHtml(t)}">$\{escapeHtml(t)}</option>`).join("");

  function applyFilters() {
        const query = searchInput.value.trim().toLowerCase();
    const mealType = mealTypeFilter.value;
    const dish = dishFilter.value;
    const ingredient = ingredientFilter.value;
    const cuisine = cuisineFilter.value;

    const filtered = allRecipes.filter((r) => {
      if (mealType && !(r.mealTypes || []).includes(mealType)) return false;
      if (dish && !r.tags.includes(dish)) return false;
      if (ingredient && !r.tags.includes(ingredient)) return false;
      if (cuisine && !r.tags.includes(cuisine)) return false;
              if (!query) return true;
              const haystack = [
                        r.title,
                        ...r.ingredients.map((i) => i.ingredientName),
                        ...r.tags,
                      ]
                .join(" ")
                .toLowerCase();
              return haystack.includes(query);
      });

      renderGrid(filtered);
  }

  function renderGrid(recipes) {
        countEl.textContent = `${recipes.length} von ${allRecipes.length} Rezept${
                allRecipes.length === 1 ? "" : "en"
        }`;
        emptyState.hidden = recipes.length > 0;
        grid.innerHTML = recipes.map(recipeCardHtml).join("");
  }

  searchInput.addEventListener("input", debounce(applyFilters, 150));
    mealTypeFilter.addEventListener("change", applyFilters);
    dishFilter.addEventListener("change", applyFilters);
    ingredientFilter.addEventListener("change", applyFilters);
    cuisineFilter.addEventListener("change", applyFilters);

  grid.addEventListener("click", (e) => {
        const card = e.target.closest("[data-recipe-id]");
        if (card) navigate(`/rezepte/${card.dataset.recipeId}`);
  });

  renderGrid(allRecipes);

  const expiryHint = container.querySelector("#expiry-hint");
    const expiryHintText = container.querySelector("#expiry-hint-text");
    try {
          const expiring = await getExpiringInventoryItems(3);
          if (expiring.length > 0) {
                  const overdue = expiring.filter((i) => new Date(`${i.expiryDate}T00:00:00`) < new Date(new Date().toDateString()));
                  const label =
                            overdue.length > 0
                      ? `⏰ ${expiring.length} Zutat${expiring.length === 1 ? "" : "en"} im Vorrat laufen bald ab oder sind abgelaufen`
                              : `⏰ ${expiring.length} Zutat${expiring.length === 1 ? "" : "en"} im Vorrat laufen bald ab`;
                  expiryHintText.textContent = label;
                  expiryHint.hidden = false;
          }
    } catch {
    }
}

function recipeCardHtml(recipe) {
    const tagChips = recipe.tags
      .slice(0, 3)
      .map((t) => `<span class="chip">${escapeHtml(t)}</span>`)
      .join("");

  return `
      <article class="recipe-card" data-recipe-id="${recipe.id}" tabindex="0">
            ${
                      recipe.imageUrl
                        ? `<img src="${escapeHtml(recipe.imageUrl)}" alt="" class="recipe-card-image" />`
                        : `<div class="recipe-card-image recipe-card-image--empty" aria-hidden="true">🍲</div>`
            }
                  <div class="recipe-card-body">
                          <h2>${escapeHtml(recipe.title)}</h2>
                                  <div class="recipe-card-meta">
                                            <span>⏱ ${formatMinutes(recipe.prepTimeMinutes)}</span>
                                                      <span>🍽 ${recipe.servingsBase} Port.</span>
                                                              </div>
                                                                      ${tagChips ? `<div class="chip-row">${tagChips}</div>` : ""}
                                                                            </div>
                                                                                </article>
                                                                                  `;
}
