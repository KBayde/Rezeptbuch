// ============================================================================
// Datenzugriffs-Schicht: alle Supabase-Aufrufe leben hier gebündelt.
// Views rufen nur diese Funktionen auf und wissen nichts von Tabellen/SQL.
// Das hält die spätere Erweiterung (Einkaufsliste, Inventar, Webhook-Import)
// einfach: neue Funktionen hier ergänzen, Views bleiben unangetastet.
// ============================================================================
import { supabase } from "./supabaseClient.js";

// Name des Supabase Storage Buckets für Rezeptbilder (muss im Dashboard
// als "Public bucket" angelegt sein, siehe DEPLOYMENT.md).
const IMAGE_BUCKET = "recipe-images";

// --------------------------- Auth ---------------------------

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return data.subscription;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// --------------------------- Stammdaten ---------------------------

export async function listUnits() {
  const { data, error } = await supabase.from("units").select("*").order("sort_order");
  if (error) throw error;
  return data;
}

export async function listTags() {
  const { data, error } = await supabase.from("tags").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function listIngredients() {
  const { data, error } = await supabase.from("ingredients").select("*").order("name");
  if (error) throw error;
  return data;
}

/** Findet eine Zutat per Name (case-insensitive) oder legt sie neu an. */
export async function getOrCreateIngredient(name, defaultUnitId = null) {
  const trimmed = name.trim();
  const { data: existing, error: findError } = await supabase
    .from("ingredients")
    .select("*")
    .ilike("name", trimmed)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from("ingredients")
    .insert({ name: trimmed, default_unit_id: defaultUnitId })
    .select()
    .single();
  if (createError) throw createError;
  return created;
}

/** Findet einen Tag per Name (case-insensitive) oder legt ihn neu an. */
export async function getOrCreateTag(name) {
  const trimmed = name.trim();
  const { data: existing, error: findError } = await supabase
    .from("tags")
    .select("*")
    .ilike("name", trimmed)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from("tags")
    .insert({ name: trimmed })
    .select()
    .single();
  if (createError) throw createError;
  return created;
}

// --------------------------- Bilder ---------------------------
//
// Bilder hängen an der Tabelle "recipe_images" (nicht mehr an einer einzelnen
// Spalte auf "recipes"), damit ein Rezept später mehrere Bilder haben kann
// (eigenes Titelbild + eingescannte Vorder-/Rückseite einer Rezeptkarte).
// Aktuell nutzt die UI nur den Typ "cover" (das eine Foto im Formular).

/** Lädt eine Bilddatei in den Storage-Bucket hoch und gibt den Speicherpfad zurück. */
async function uploadImageFile(recipeId, file, imageType) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${recipeId}/${imageType}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** Baut aus einem gespeicherten Bildpfad die öffentliche Bild-URL. */
export function getRecipeImageUrl(storagePath) {
  if (!storagePath) return null;
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

/**
 * Lädt ein Bild hoch und hängt es als recipe_images-Zeile an ein (bereits
 * existierendes) Rezept. imageType: 'cover' | 'source_front' | 'source_back' | 'other'.
 */
export async function addRecipeImage(recipeId, file, imageType = "cover") {
  const storagePath = await uploadImageFile(recipeId, file, imageType);
  const { data, error } = await supabase
    .from("recipe_images")
    .insert({ recipe_id: recipeId, storage_path: storagePath, image_type: imageType })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Ersetzt das Titelbild ("cover") eines Rezepts durch eine neue Datei. */
export async function replaceCoverImage(recipeId, file) {
  await removeCoverImage(recipeId);
  return addRecipeImage(recipeId, file, "cover");
}

/** Entfernt das aktuelle Titelbild ("cover") eines Rezepts, falls vorhanden. */
export async function removeCoverImage(recipeId) {
  const { data: existing, error: findError } = await supabase
    .from("recipe_images")
    .select("id, storage_path")
    .eq("recipe_id", recipeId)
    .eq("image_type", "cover");
  if (findError) throw findError;
  if (!existing || existing.length === 0) return;

  const paths = existing.map((row) => row.storage_path);
  await supabase.storage.from(IMAGE_BUCKET).remove(paths);
  const { error: deleteError } = await supabase
    .from("recipe_images")
    .delete()
    .in(
      "id",
      existing.map((row) => row.id)
    );
  if (deleteError) throw deleteError;
}

// --------------------------- Rezepte lesen ---------------------------

const RECIPE_SELECT = `
  id, title, source_type, source_text, source_url, prep_time_minutes,
  servings_base, notes, created_at, updated_at,
  recipe_steps ( id, step_number, instruction ),
  recipe_ingredients ( id, quantity, note, sort_order,
    ingredients ( id, name ),
    units ( id, name, abbreviation )
  ),
  recipe_tags ( tags ( id, name ) ),
  recipe_images ( id, storage_path, image_type, sort_order )
`;

function normalizeRecipe(row) {
  const images = [...row.recipe_images]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => ({
      id: img.id,
      type: img.image_type,
      storagePath: img.storage_path,
      url: getRecipeImageUrl(img.storage_path),
    }));
  const cover = images.find((img) => img.type === "cover") || images[0] || null;

  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceText: row.source_text,
    sourceUrl: row.source_url,
    prepTimeMinutes: row.prep_time_minutes,
    servingsBase: Number(row.servings_base),
    notes: row.notes,
    images,
    imageUrl: cover?.url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: [...row.recipe_steps]
      .sort((a, b) => a.step_number - b.step_number)
      .map((s) => ({ id: s.id, stepNumber: s.step_number, instruction: s.instruction })),
    ingredients: [...row.recipe_ingredients]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((ri) => ({
        id: ri.id,
        quantity: ri.quantity === null ? null : Number(ri.quantity),
        note: ri.note,
        ingredientName: ri.ingredients?.name ?? "",
        unitAbbreviation: ri.units?.abbreviation ?? "",
      })),
    tags: row.recipe_tags.map((rt) => rt.tags.name).filter(Boolean),
  };
}

export async function listRecipes() {
  const { data, error } = await supabase
    .from("recipes")
    .select(RECIPE_SELECT)
    .order("title");
  if (error) throw error;
  return data.map(normalizeRecipe);
}

export async function getRecipe(id) {
  const { data, error } = await supabase
    .from("recipes")
    .select(RECIPE_SELECT)
    .eq("id", id)
    .single();
  if (error) throw error;
  return normalizeRecipe(data);
}

// --------------------------- Rezepte schreiben ---------------------------

/**
 * form = {
 *   title, sourceType, sourceText, sourceUrl, prepTimeMinutes, servingsBase, notes,
 *   steps: [{ instruction }],
 *   ingredients: [{ name, quantity, unitId, note }],
 *   tags: [ "Vegetarisch", ... ]
 * }
 */
export async function createRecipe(form) {
  const { data: recipe, error } = await supabase
    .from("recipes")
    .insert({
      title: form.title,
      source_type: form.sourceType,
      source_text: form.sourceText || null,
      source_url: form.sourceUrl || null,
      prep_time_minutes: form.prepTimeMinutes,
      servings_base: form.servingsBase,
      notes: form.notes || null,
    })
    .select()
    .single();
  if (error) throw error;

  await writeRecipeChildren(recipe.id, form);
  return recipe.id;
}

export async function updateRecipe(id, form) {
  const { error } = await supabase
    .from("recipes")
    .update({
      title: form.title,
      source_type: form.sourceType,
      source_text: form.sourceText || null,
      source_url: form.sourceUrl || null,
      prep_time_minutes: form.prepTimeMinutes,
      servings_base: form.servingsBase,
      notes: form.notes || null,
    })
    .eq("id", id);
  if (error) throw error;

  // Einfachster robuster Ansatz für Phase 1: Kind-Datensätze ersetzen statt
  // einzeln zu diffen (Rezepte sind klein, das ist performant genug).
  await supabase.from("recipe_steps").delete().eq("recipe_id", id);
  await supabase.from("recipe_ingredients").delete().eq("recipe_id", id);
  await supabase.from("recipe_tags").delete().eq("recipe_id", id);

  await writeRecipeChildren(id, form);
}

async function writeRecipeChildren(recipeId, form) {
  if (form.steps.length > 0) {
    const stepRows = form.steps.map((s, i) => ({
      recipe_id: recipeId,
      step_number: i + 1,
      instruction: s.instruction,
    }));
    const { error } = await supabase.from("recipe_steps").insert(stepRows);
    if (error) throw error;
  }

  if (form.ingredients.length > 0) {
    const ingredientRows = [];
    for (let i = 0; i < form.ingredients.length; i++) {
      const ing = form.ingredients[i];
      const ingredient = await getOrCreateIngredient(ing.name, ing.unitId || null);
      ingredientRows.push({
        recipe_id: recipeId,
        ingredient_id: ingredient.id,
        quantity: ing.quantity,
        unit_id: ing.unitId || null,
        note: ing.note || null,
        sort_order: i,
      });
    }
    const { error } = await supabase.from("recipe_ingredients").insert(ingredientRows);
    if (error) throw error;
  }

  if (form.tags.length > 0) {
    const tagRows = [];
    for (const tagName of form.tags) {
      const tag = await getOrCreateTag(tagName);
      tagRows.push({ recipe_id: recipeId, tag_id: tag.id });
    }
    const { error } = await supabase.from("recipe_tags").insert(tagRows);
    if (error) throw error;
  }
}

export async function deleteRecipe(id) {
  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) throw error;
}

// --------------------------- Wochenplan ---------------------------

const MEAL_PLAN_SELECT = `
  id, planned_date, servings, meal_type, created_at,
  recipes ( id, title, servings_base, prep_time_minutes,
    recipe_images ( storage_path, image_type )
  )
`;

function normalizeMealPlanEntry(row) {
  const cover = (row.recipes?.recipe_images || []).find((img) => img.image_type === "cover");
  return {
    id: row.id,
    date: row.planned_date,
    servings: Number(row.servings),
    mealType: row.meal_type,
    recipeId: row.recipes?.id ?? null,
    recipeTitle: row.recipes?.title ?? "(gelöschtes Rezept)",
    recipeServingsBase: row.recipes ? Number(row.recipes.servings_base) : null,
    prepTimeMinutes: row.recipes?.prep_time_minutes ?? null,
    imageUrl: cover ? getRecipeImageUrl(cover.storage_path) : null,
  };
}

/** Lädt alle geplanten Mahlzeiten im Datumsbereich [startDate, endDate] (je "YYYY-MM-DD"). */
export async function listMealPlanEntries(startDate, endDate) {
  const { data, error } = await supabase
    .from("meal_plan_entries")
    .select(MEAL_PLAN_SELECT)
    .gte("planned_date", startDate)
    .lte("planned_date", endDate)
    .order("planned_date");
  if (error) throw error;
  return data.map(normalizeMealPlanEntry);
}

export async function addMealPlanEntry(date, recipeId, servings, mealType = "mittag") {
  const { data, error } = await supabase
    .from("meal_plan_entries")
    .insert({ planned_date: date, recipe_id: recipeId, servings, meal_type: mealType })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Plant ein Rezept für eine bestimmte Mahlzeit an einem oder mehreren
 * aufeinanderfolgenden Tagen (z. B. "das gleiche Gericht auch morgen essen").
 * dayCount = 1 legt nur "date" an, dayCount = 2 zusätzlich den Folgetag.
 */
export async function addMealPlanEntryForDays(date, recipeId, servings, mealType, dayCount = 1) {
  const rows = [];
  const start = new Date(date);
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    rows.push({ planned_date: iso, recipe_id: recipeId, servings, meal_type: mealType });
  }
  const { data, error } = await supabase.from("meal_plan_entries").insert(rows).select();
  if (error) throw error;
  return data;
}

export async function updateMealPlanEntryServings(id, servings) {
  const { error } = await supabase.from("meal_plan_entries").update({ servings }).eq("id", id);
  if (error) throw error;
}

export async function removeMealPlanEntry(id) {
  const { error } = await supabase.from("meal_plan_entries").delete().eq("id", id);
  if (error) throw error;
}

// --------------------------- Einkaufsliste ---------------------------

export async function listShoppingListItems() {
  const { data, error } = await supabase
    .from("shopping_list_items")
    .select("*")
    .order("checked")
    .order("sort_order");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
    checked: row.checked,
    source: row.source,
  }));
}

export async function addShoppingListItem(name) {
  const { error } = await supabase
    .from("shopping_list_items")
    .insert({ name, source: "manual", sort_order: 999 });
  if (error) throw error;
}

export async function toggleShoppingListItem(id, checked) {
  const { error } = await supabase.from("shopping_list_items").update({ checked }).eq("id", id);
  if (error) throw error;
}

export async function deleteShoppingListItem(id) {
  const { error } = await supabase.from("shopping_list_items").delete().eq("id", id);
  if (error) throw error;
}

export async function clearCheckedShoppingListItems() {
  const { error } = await supabase.from("shopping_list_items").delete().eq("checked", true);
  if (error) throw error;
}

/**
 * Baut die Einkaufsliste aus allen Rezepten neu, die im Datumsbereich
 * [startDate, endDate] eingeplant sind: Mengen werden über alle Rezepte
 * hinweg pro Zutat+Einheit aufsummiert (skaliert auf die geplante
 * Portionenzahl). Nur automatisch erzeugte Positionen ("plan") werden
 * ersetzt – manuell hinzugefügte Items und ihr Abhak-Status bleiben erhalten.
 * Gibt die Anzahl der erzeugten Positionen zurück.
 */
export async function generateShoppingList(startDate, endDate) {
  const entries = await listMealPlanEntries(startDate, endDate);

  if (entries.length === 0) {
    const { error } = await supabase.from("shopping_list_items").delete().eq("source", "plan");
    if (error) throw error;
    return 0;
  }

  const recipeIds = [...new Set(entries.map((e) => e.recipeId).filter(Boolean))];
  const { data: recipeRows, error: fetchError } = await supabase
    .from("recipes")
    .select(
      `id, servings_base,
       recipe_ingredients ( quantity,
         ingredients ( name ),
         units ( abbreviation )
       )`
    )
    .in("id", recipeIds);
  if (fetchError) throw fetchError;

  const recipesById = new Map(recipeRows.map((r) => [r.id, r]));
  const aggregated = new Map(); // "name|unit" -> { name, unit, quantity }

  for (const entry of entries) {
    const recipe = recipesById.get(entry.recipeId);
    if (!recipe) continue;
    const base = Number(recipe.servings_base) || 1;
    const ratio = entry.servings / base;

    for (const ri of recipe.recipe_ingredients) {
      const name = ri.ingredients?.name?.trim();
      if (!name) continue;
      const unit = ri.units?.abbreviation || "";
      const key = `${name.toLowerCase()}|${unit}`;

      if (ri.quantity === null) {
        // z. B. "nach Geschmack" – ohne Menge, nur einmal auflisten
        if (!aggregated.has(key)) aggregated.set(key, { name, unit, quantity: null });
        continue;
      }

      const scaled = Number(ri.quantity) * ratio;
      const existing = aggregated.get(key);
      if (existing && existing.quantity !== null) {
        existing.quantity += scaled;
      } else {
        aggregated.set(key, { name, unit, quantity: scaled });
      }
    }
  }

  const items = [...aggregated.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));

  const { error: deleteError } = await supabase
    .from("shopping_list_items")
    .delete()
    .eq("source", "plan");
  if (deleteError) throw deleteError;

  if (items.length > 0) {
    const rows = items.map((it, i) => ({
      name: it.name,
      quantity: it.quantity,
      unit: it.unit || null,
      source: "plan",
      sort_order: i,
    }));
    const { error: insertError } = await supabase.from("shopping_list_items").insert(rows);
    if (insertError) throw insertError;
  }

  return items.length;
}
