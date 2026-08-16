import { listRecipes } from "../db.js";
import { debounce, escapeHtml, formatMinutes } from "../utils.js";
import { navigate } from "../router.js";

export async function renderRecipeList(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Rezepte</h1>
        <p class="text-muted" id="recipe-count"></p>
      </div>
      <a href="#/rezepte/neu" class="btn btn-primary">+ Neues Rezept</a>
    </div>

    <div class="toolbar">
      <input
        type="search"
        id="search-input"
        class="search-input"
        placeholder="Suche nach Titel oder Zutat…"
      />
      <select id="tag-filter" class="select">
        <option value="">Alle Kategorien</option>
      </select>
    </div>

    <div id="recipe-grid" class="recipe-grid"></div>
    <p id="empty-state" class="empty-state" hidden>Keine Rezepte gefunden.</p>
  `;

  const grid = container.querySelector("#recipe-grid");
  const countEl = container.querySelector("#recipe-count");
  const emptyState = container.querySelector("#empty-state");
  const searchInput = container.querySelector("#search-input");
  const tagFilter = container.querySelector("#tag-filter");

  grid.innerHTML = `<p class="text-muted">Lade Rezepte…</p>`;

  let allRecipes = [];
  try {
    allRecipes = await listRecipes();
  } catch (err) {
    grid.innerHTML = `<p class="form-error">Rezepte konnten nicht geladen werden: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const allTags = [...new Set(allRecipes.flatMap((r) => r.tags))].sort();
  tagFilter.innerHTML =
    `<option value="">Alle Kategorien</option>` +
    allTags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    const tag = tagFilter.value;

    const filtered = allRecipes.filter((r) => {
      const matchesTag = !tag || r.tags.includes(tag);
      if (!matchesTag) return false;
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
  tagFilter.addEventListener("change", applyFilters);

  grid.addEventListener("click", (e) => {
    const card = e.target.closest("[data-recipe-id]");
    if (card) navigate(`/rezepte/${card.dataset.recipeId}`);
  });

  renderGrid(allRecipes);
}

function recipeCardHtml(recipe) {
  const tagChips = recipe.tags
    .slice(0, 3)
    .map((t) => `<span class="chip">${escapeHtml(t)}</span>`)
    .join("");

  return `
    <article class="recipe-card" data-recipe-id="${recipe.id}" tabindex="0">
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
