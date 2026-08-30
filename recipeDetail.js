import { getRecipe, deleteRecipe } from "./db.js";
import { escapeHtml, formatMinutes, formatQuantity, scaleQuantity, SOURCE_TYPE_LABELS } from "./utils.js";
import { navigate } from "./router.js";

export async function renderRecipeDetail(container, { id }) {
    container.innerHTML = `<p class="text-muted">Lade Rezept…</p>`;

  let recipe;
    try {
          recipe = await getRecipe(id);
    } catch (err) {
          container.innerHTML = `<p class="form-error">Rezept konnte nicht geladen werden: ${escapeHtml(err.message)}</p>`;
          return;
    }

  let servings = recipe.servingsBase;

  container.innerHTML = `
      <div class="detail-header">
            <a href="#/" class="back-link">← Zur Übersicht</a>
                  <div class="detail-actions">
                          <a href="#/rezepte/${recipe.id}/bearbeiten" class="btn btn-secondary">Bearbeiten</a>
                                  <button id="delete-btn" class="btn btn-danger-ghost">Löschen</button>
                                        </div>
                                            </div>

                                                ${recipe.imageUrl ? `<img src="${escapeHtml(recipe.imageUrl)}" alt="" class="detail-hero-image" />` : ""}

                                                    <h1 class="detail-title">${escapeHtml(recipe.title)}</h1>

                                                        <div class="detail-meta-row">
                                                              <span>⏱ ${formatMinutes(recipe.prepTimeMinutes)}</span>
${recipe.caloriesPerServing ? `<span>🔥 ${recipe.caloriesPerServing} kcal/Portion</span>` : ""}
                                                                    ${recipe.sourceText || recipe.sourceUrl ? `<span>📖 ${sourceHtml(recipe)}</span>` : ""}
                                                                        </div>

                                                                            ${
                                                                                    recipe.tags.length
                                                                                      ? `<div class="chip-row">${recipe.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("")}</div>`
                                                                                      : ""
                                                                            }

                                                                                <div class="detail-grid">
                                                                                      <section class="card ingredients-card">
                                                                                              <div class="ingredients-header">
                                                                                                        <h2>Zutaten</h2>
                                                                                                                  <div class="stepper">
                                                                                                                              <button id="dec-servings" class="stepper-btn" aria-label="Weniger Portionen">−</button>
                                                                                                                                          <span><span id="servings-value">${servings}</span> Port.</span>
                                                                                                                                                      <button id="inc-servings" class="stepper-btn" aria-label="Mehr Portionen">+</button>
                                                                                                                                                                </div>
                                                                                                                                                                        </div>
                                                                                                                                                                                <ul id="ingredients-list" class="ingredients-list"></ul>
                                                                                                                                                                                      </section>
                                                                                                                                                                                      
                                                                                                                                                                                            <section class="card steps-card">
                                                                                                                                                                                                    <h2>Zubereitung</h2>
                                                                                                                                                                                                            <ol class="steps-list">
                                                                                                                                                                                                                      ${recipe.steps.map((s) => `<li>${escapeHtml(s.instruction)}</li>`).join("")}
                                                                                                                                                                                                                              </ol>
                                                                                                                                                                                                                                      ${recipe.notes ? `<div class="notes-block"><h3>Notizen</h3><p>${escapeHtml(recipe.notes)}</p></div>` : ""}
                                                                                                                                                                                                                                            </section>
                                                                                                                                                                                                                                                </div>
                                                                                                                                                                                                                                                  `;

  function renderIngredients() {
        const list = container.querySelector("#ingredients-list");
        list.innerHTML = recipe.ingredients
          .map((ing) => {
                    const scaled = scaleQuantity(ing.quantity, recipe.servingsBase, servings);
                    const qtyLabel = scaled === null ? "" : `${formatQuantity(scaled)} ${ing.unitAbbreviation || ""}`.trim();
                    return `
                              <li>
                                          <span class="ingredient-qty">${escapeHtml(qtyLabel)}</span>
                                                      <span class="ingredient-name">${escapeHtml(ing.ingredientName)}${ing.note ? ` <span class="text-muted">(${escapeHtml(ing.note)})</span>` : ""}</span>
                                                                </li>
                                                                        `;
          })
          .join("");
  }

  container.querySelector("#inc-servings").addEventListener("click", () => {
        servings += 1;
        container.querySelector("#servings-value").textContent = servings;
        renderIngredients();
  });

  container.querySelector("#dec-servings").addEventListener("click", () => {
        if (servings <= 1) return;
        servings -= 1;
        container.querySelector("#servings-value").textContent = servings;
        renderIngredients();
  });

  container.querySelector("#delete-btn").addEventListener("click", async () => {
        if (!confirm(`"${recipe.title}" wirklich unwiderruflich löschen?`)) return;
        try {
                await deleteRecipe(recipe.id);
                navigate("/");
        } catch (err) {
                alert("Löschen fehlgeschlagen: " + err.message);
        }
  });

  renderIngredients();
}

function sourceHtml(recipe) {
    const label = SOURCE_TYPE_LABELS[recipe.sourceType] || "Quelle";
    const text = recipe.sourceText ? escapeHtml(recipe.sourceText) : label;
    if (recipe.sourceUrl) {
          return `<a href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noopener">${text}</a>`;
    }
    return text;
}
