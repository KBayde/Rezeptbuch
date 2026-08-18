import {
  listUnits,
  listIngredients,
  listTags,
  getRecipe,
  createRecipe,
  updateRecipe,
  replaceCoverImage,
  removeCoverImage,
} from "./db.js";
import { escapeHtml, SOURCE_TYPE_LABELS, MEAL_TYPES } from "./utils.js";
import { navigate } from "./router.js";
import { consumePhotoDraft } from "./photoImport.js";

export async function renderRecipeForm(container, { id } = {}) {
  const isEdit = Boolean(id);
  container.innerHTML = `<p class="text-muted">Lade Formular…</p>`;

  let units = [];
  let existingIngredients = [];
  let existingTags = [];
  let recipe = null;

  try {
    [units, existingIngredients, existingTags] = await Promise.all([
      listUnits(),
      listIngredients(),
      listTags(),
    ]);
    if (isEdit) recipe = await getRecipe(id);
  } catch (err) {
    container.innerHTML = `<p class="form-error">Formular konnte nicht geladen werden: ${escapeHtml(err.message)}</p>`;
    return;
  }

  // Kommt man von der Foto-Import-Seite und hat gerade ein Rezept aus einem
  // Foto erkannt bekommen, übernehmen wir diesen Entwurf hier als Vorbelegung
  // (nur bei "Neues Rezept", nie beim Bearbeiten eines bestehenden).
  if (!isEdit) {
    const draft = consumePhotoDraft();
    if (draft) recipe = draft;
  }

  const state = {
    steps: recipe ? recipe.steps.map((s) => ({ instruction: s.instruction })) : [{ instruction: "" }],
    ingredients: recipe
      ? recipe.ingredients.map((i) => ({
          name: i.ingredientName,
          quantity: i.quantity ?? "",
          unitAbbreviation: i.unitAbbreviation || "",
          note: i.note || "",
        }))
      : [{ name: "", quantity: "", unitAbbreviation: "", note: "" }],
    tags: recipe ? [...recipe.tags] : [],
    mealTypes: recipe ? [...(recipe.mealTypes || [])] : [],
    imageFile: null,
    removeImage: false,
  };
  let imagePreviewUrl = recipe?.imageUrl || null;

  container.innerHTML = `
    <a href="${isEdit ? `#/rezepte/${id}` : "#/"}" class="back-link">← Zurück</a>
    <h1>${isEdit ? "Rezept bearbeiten" : "Neues Rezept"}</h1>

    <form id="recipe-form" class="stack-lg">
      <section class="card stack-md">
        <label class="field">
          <span>Foto (optional)</span>
          <div id="image-preview-wrap" class="image-preview-wrap">
            ${
              imagePreviewUrl
                ? `<img id="image-preview" src="${escapeHtml(imagePreviewUrl)}" alt="" class="image-preview" />`
                : `<div id="image-preview-empty" class="image-preview-empty">Noch kein Foto</div>`
            }
          </div>
          <div class="image-field-actions">
            <input type="file" id="image-input" accept="image/*" />
            <button type="button" id="remove-image-btn" class="btn btn-ghost btn-small" ${imagePreviewUrl ? "" : "hidden"}>Foto entfernen</button>
          </div>
        </label>

        <label class="field">
          <span>Titel *</span>
          <input type="text" name="title" required value="${escapeHtml(recipe?.title || "")}" />
        </label>

        <div class="field-row">
          <label class="field">
            <span>Quelle</span>
            <select name="sourceType">
              ${Object.entries(SOURCE_TYPE_LABELS)
                .map(
                  ([value, label]) =>
                    `<option value="${value}" ${recipe?.sourceType === value ? "selected" : ""}>${label}</option>`
                )
                .join("")}
            </select>
          </label>
          <label class="field">
            <span>Quelle – Details</span>
            <input type="text" name="sourceText" placeholder="z. B. Kochbuch, Seite 42"
              value="${escapeHtml(recipe?.sourceText || "")}" />
          </label>
        </div>

        <label class="field">
          <span>Link (optional)</span>
          <input type="url" name="sourceUrl" placeholder="https://…" value="${escapeHtml(recipe?.sourceUrl || "")}" />
        </label>

        <div class="field-row">
          <label class="field">
            <span>Zubereitungszeit (Minuten)</span>
            <input type="number" name="prepTimeMinutes" min="0" value="${recipe?.prepTimeMinutes ?? ""}" />
          </label>
          <label class="field">
            <span>Portionen (Basis) *</span>
            <input type="number" name="servingsBase" min="1" step="1" required
              value="${recipe?.servingsBase ?? 4}" />
          </label>
        </div>

        <label class="field">
          <span>Kategorien / Tags</span>
          <div id="tag-editor" class="tag-editor"></div>
          <input list="tag-suggestions" id="tag-input" type="text" placeholder="Tag eingeben und Enter drücken" />
          <datalist id="tag-suggestions">
            ${existingTags.map((t) => `<option value="${escapeHtml(t.name)}"></option>`).join("")}
          </datalist>
        </label>

        <label class="field">
          <span>Für welche Mahlzeiten geeignet? (optional)</span>
          <div id="mealtype-picker" class="mealtype-picker"></div>
        </label>
      </section>

      <section class="card stack-md">
        <h2>Zutaten</h2>
        <div id="ingredients-editor" class="ingredients-editor"></div>
        <button type="button" id="add-ingredient" class="btn btn-secondary">+ Zutat hinzufügen</button>
      </section>

      <section class="card stack-md">
        <h2>Zubereitungsschritte</h2>
        <div id="steps-editor" class="steps-editor"></div>
        <button type="button" id="add-step" class="btn btn-secondary">+ Schritt hinzufügen</button>
      </section>

      <section class="card stack-md">
        <label class="field">
          <span>Notizen (optional)</span>
          <textarea name="notes" rows="3">${escapeHtml(recipe?.notes || "")}</textarea>
        </label>
      </section>

      <p id="form-error" class="form-error" hidden></p>

      <div class="form-actions">
        <a href="${isEdit ? `#/rezepte/${id}` : "#/"}" class="btn btn-ghost">Abbrechen</a>
        <button type="submit" class="btn btn-primary">${isEdit ? "Speichern" : "Rezept anlegen"}</button>
      </div>
    </form>

    <datalist id="ingredient-suggestions">
      ${existingIngredients.map((i) => `<option value="${escapeHtml(i.name)}"></option>`).join("")}
    </datalist>
    <datalist id="unit-suggestions">
      ${units.map((u) => `<option value="${escapeHtml(u.abbreviation)}"></option>`).join("")}
    </datalist>
  `;

  const tagEditor = container.querySelector("#tag-editor");
  const tagInput = container.querySelector("#tag-input");
  const mealTypePicker = container.querySelector("#mealtype-picker");
  const ingredientsEditor = container.querySelector("#ingredients-editor");
  const stepsEditor = container.querySelector("#steps-editor");

  const imagePreviewWrap = container.querySelector("#image-preview-wrap");
  const imageInput = container.querySelector("#image-input");
  const removeImageBtn = container.querySelector("#remove-image-btn");

  function renderImagePreview() {
    imagePreviewWrap.innerHTML = imagePreviewUrl
      ? `<img id="image-preview" src="${escapeHtml(imagePreviewUrl)}" alt="" class="image-preview" />`
      : `<div id="image-preview-empty" class="image-preview-empty">Noch kein Foto</div>`;
    removeImageBtn.hidden = !imagePreviewUrl;
  }
  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    state.imageFile = file;
    state.removeImage = false;
    imagePreviewUrl = URL.createObjectURL(file);
    renderImagePreview();
  });
  removeImageBtn.addEventListener("click", () => {
    state.imageFile = null;
    state.removeImage = true;
    imagePreviewUrl = null;
    imageInput.value = "";
    renderImagePreview();
  });

  function renderTags() {
    tagEditor.innerHTML = state.tags
      .map(
        (t, i) =>
          `<span class="chip chip-removable">${escapeHtml(t)} <button type="button" data-remove-tag="${i}" aria-label="Tag entfernen">×</button></span>`
      )
      .join("");
  }
  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const value = tagInput.value.trim();
      if (value && !state.tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
        state.tags.push(value);
        renderTags();
      }
      tagInput.value = "";
    }
  });
  tagEditor.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-tag]");
    if (!btn) return;
    state.tags.splice(Number(btn.dataset.removeTag), 1);
    renderTags();
  });

  function renderMealTypePicker() {
    mealTypePicker.innerHTML = MEAL_TYPES.map(
      (mt) => `
        <button
          type="button"
          class="chip chip-toggle ${state.mealTypes.includes(mt.key) ? "chip-toggle--active" : ""}"
          data-mealtype="${mt.key}"
        >${mt.icon} ${escapeHtml(mt.label)}</button>
      `
    ).join("");
  }
  mealTypePicker.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mealtype]");
    if (!btn) return;
    const key = btn.dataset.mealtype;
    if (state.mealTypes.includes(key)) {
      state.mealTypes = state.mealTypes.filter((k) => k !== key);
    } else {
      state.mealTypes.push(key);
    }
    renderMealTypePicker();
  });

  function renderIngredients() {
    ingredientsEditor.innerHTML = state.ingredients
      .map(
        (ing, i) => `
        <div class="ingredient-row" data-index="${i}">
          <input type="number" step="any" min="0" class="ing-quantity" placeholder="Menge"
            value="${ing.quantity}" />
          <input type="text" class="ing-unit" list="unit-suggestions" placeholder="Einheit"
            value="${escapeHtml(ing.unitAbbreviation)}" />
          <input type="text" class="ing-name" list="ingredient-suggestions" placeholder="Zutat *"
            value="${escapeHtml(ing.name)}" />
          <input type="text" class="ing-note" placeholder="Notiz (optional)"
            value="${escapeHtml(ing.note)}" />
          <button type="button" class="row-remove" data-remove-ingredient="${i}" aria-label="Zutat entfernen">×</button>
        </div>
      `
      )
      .join("");
  }
  container.querySelector("#add-ingredient").addEventListener("click", () => {
    syncIngredientsFromDom();
    state.ingredients.push({ name: "", quantity: "", unitAbbreviation: "", note: "" });
    renderIngredients();
  });
  ingredientsEditor.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-ingredient]");
    if (!btn) return;
    syncIngredientsFromDom();
    state.ingredients.splice(Number(btn.dataset.removeIngredient), 1);
    renderIngredients();
  });
  function syncIngredientsFromDom() {
    const rows = ingredientsEditor.querySelectorAll(".ingredient-row");
    rows.forEach((row, i) => {
      state.ingredients[i] = {
        quantity: row.querySelector(".ing-quantity").value,
        unitAbbreviation: row.querySelector(".ing-unit").value,
        name: row.querySelector(".ing-name").value,
        note: row.querySelector(".ing-note").value,
      };
    });
  }

  function renderSteps() {
    stepsEditor.innerHTML = state.steps
      .map(
        (s, i) => `
        <div class="step-row" data-index="${i}">
          <span class="step-number">${i + 1}</span>
          <textarea class="step-instruction" rows="2" placeholder="Schritt ${i + 1} beschreiben…">${escapeHtml(s.instruction)}</textarea>
          <div class="step-row-actions">
            <button type="button" class="row-icon-btn" data-move-step-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Nach oben">↑</button>
            <button type="button" class="row-icon-btn" data-move-step-down="${i}" ${i === state.steps.length - 1 ? "disabled" : ""} aria-label="Nach unten">↓</button>
            <button type="button" class="row-remove" data-remove-step="${i}" aria-label="Schritt entfernen">×</button>
          </div>
        </div>
      `
      )
      .join("");
  }
  container.querySelector("#add-step").addEventListener("click", () => {
    syncStepsFromDom();
    state.steps.push({ instruction: "" });
    renderSteps();
  });
  stepsEditor.addEventListener("click", (e) => {
    syncStepsFromDom();
    const removeBtn = e.target.closest("[data-remove-step]");
    const upBtn = e.target.closest("[data-move-step-up]");
    const downBtn = e.target.closest("[data-move-step-down]");
    if (removeBtn) {
      state.steps.splice(Number(removeBtn.dataset.removeStep), 1);
    } else if (upBtn) {
      const i = Number(upBtn.dataset.moveStepUp);
      [state.steps[i - 1], state.steps[i]] = [state.steps[i], state.steps[i - 1]];
    } else if (downBtn) {
      const i = Number(downBtn.dataset.moveStepDown);
      [state.steps[i + 1], state.steps[i]] = [state.steps[i], state.steps[i + 1]];
    } else {
      return;
    }
    renderSteps();
  });
  function syncStepsFromDom() {
    const rows = stepsEditor.querySelectorAll(".step-row");
    rows.forEach((row, i) => {
      state.steps[i] = { instruction: row.querySelector(".step-instruction").value };
    });
  }

  renderTags();
  renderMealTypePicker();
  renderIngredients();
  renderSteps();

  const form = container.querySelector("#recipe-form");
  const errorEl = container.querySelector("#form-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    syncIngredientsFromDom();
    syncStepsFromDom();
    errorEl.hidden = true;

    const formData = new FormData(form);
    const unitByAbbr = new Map(units.map((u) => [u.abbreviation.toLowerCase(), u]));

    const cleanIngredients = state.ingredients
      .filter((ing) => ing.name.trim())
      .map((ing) => ({
        name: ing.name.trim(),
        quantity: ing.quantity === "" ? null : Number(ing.quantity),
        unitId: unitByAbbr.get((ing.unitAbbreviation || "").trim().toLowerCase())?.id || null,
        note: ing.note.trim(),
      }));

    const cleanSteps = state.steps
      .filter((s) => s.instruction.trim())
      .map((s) => ({ instruction: s.instruction.trim() }));

    const payload = {
      title: formData.get("title").trim(),
      sourceType: formData.get("sourceType"),
      sourceText: formData.get("sourceText").trim(),
      sourceUrl: formData.get("sourceUrl").trim(),
      prepTimeMinutes: formData.get("prepTimeMinutes") ? Number(formData.get("prepTimeMinutes")) : null,
      servingsBase: Number(formData.get("servingsBase")),
      notes: formData.get("notes").trim(),
      ingredients: cleanIngredients,
      steps: cleanSteps,
      tags: state.tags,
      mealTypes: state.mealTypes,
    };

    if (!payload.title) {
      errorEl.textContent = "Bitte einen Titel eingeben.";
      errorEl.hidden = false;
      return;
    }
    if (cleanIngredients.length === 0) {
      errorEl.textContent = "Bitte mindestens eine Zutat eingeben.";
      errorEl.hidden = false;
      return;
    }

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Speichern…";

    try {
      let targetId = id;
      if (isEdit) {
        await updateRecipe(id, payload);
      } else {
        targetId = await createRecipe(payload);
      }

      if (state.imageFile) {
        submitBtn.textContent = "Foto wird hochgeladen…";
        try {
          await replaceCoverImage(targetId, state.imageFile);
        } catch (imgErr) {
          console.error("Foto-Upload fehlgeschlagen:", imgErr);
        }
      } else if (state.removeImage) {
        try {
          await removeCoverImage(targetId);
        } catch (imgErr) {
          console.error("Foto entfernen fehlgeschlagen:", imgErr);
        }
      }

      navigate(`/rezepte/${targetId}`);
    } catch (err) {
      errorEl.textContent = "Speichern fehlgeschlagen: " + err.message;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? "Speichern" : "Rezept anlegen";
    }
  });
}
