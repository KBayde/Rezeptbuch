// ============================================================================
// Datenzugriffs-Schicht: alle Supabase-Aufrufe leben hier gebündelt.
// Views rufen nur diese Funktionen auf und wissen nichts von Tabellen/SQL.
// Das hält die spätere Erweiterung (Einkaufsliste, Inventar, Webhook-Import)
// einfach: neue Funktionen hier ergänzen, Views bleiben unangetastet.
// ============================================================================
import { supabase } from "./supabaseClient.js";
import { formatQuantity, getWeekStart, formatDateISO, daysUntil } from "./utils.js";

// Name des Supabase Storage Buckets für Rezeptbilder (muss im Dashboard
// als "Public bucket" angelegt sein, siehe DEPLOYMENT.md).
const IMAGE_BUCKET = "recipe-images";

const WORKSPACE_STORAGE_KEY = "cookcook-workspace";
let currentWorkspace = localStorage.getItem(WORKSPACE_STORAGE_KEY) === "sandbox" ? "sandbox" : "real";
export function getWorkspace() { return currentWorkspace; }
export function setWorkspace(value) { currentWorkspace = value === "sandbox" ? "sandbox" : "real"; localStorage.setItem(WORKSPACE_STORAGE_KEY, currentWorkspace); }

// --------------------------- Einstellungen (generisches Key/Value) ---------------------------
//
// Generischer Settings-Speicher pro Workspace, damit neue Einstellungen
// (z. B. spaeter "Portionen"-Praeferenzen) nur eine neue Zeile/Aufruf
// brauchen statt einer neuen Spalte/Migration.

export async function getSetting(key, defaultValue = null) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("workspace", currentWorkspace)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data ? data.value : defaultValue;
}

export async function setSetting(key, value) {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { workspace: currentWorkspace, key, value, updated_at: new Date().toISOString() },
      { onConflict: "workspace,key" }
    );
  if (error) throw error;
}

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
 * existierendes) Rezept. imageType: "cover" | "source_front" | "source_back" | "other".
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
  servings_base, notes, meal_types, calories_per_serving, created_at, updated_at,
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
    mealTypes: row.meal_types || [],
caloriesPerServing: row.calories_per_serving === null || row.calories_per_serving === undefined ? null : Number(row.calories_per_serving),
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
      meal_types: form.mealTypes || [],
calories_per_serving: form.caloriesPerServing ?? null,
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
      meal_types: form.mealTypes || [],
calories_per_serving: form.caloriesPerServing ?? null,
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
//
// Fachliches Modell: ein Wochenplan-Slot (Datum + Mahlzeit-Typ) enthaelt ein
// "geplantes Essen" (Tabelle planned_meals). Dieses Essen besteht aus einer
// oder mehreren Rezept-Komponenten (Tabelle meal_plan_entries, je Zeile eine
// Komponente, verknuepft ueber planned_meal_id). Ein einzelnes Rezept ist
// damit einfach der einfachste Fall eines geplanten Essens: EIN planned_meal
// mit GENAU EINER Komponente. Reusable Vorlagen ("Kombinationen") leben in
// meal_combinations / meal_combination_items und werden beim Einfuegen als
// Snapshot kopiert (neue Komponenten-Zeilen, die auf dieselben Rezepte
// verweisen) - die Rezepte selbst bleiben eigenstaendig und werden nie dupliziert.

const MEAL_PLAN_SELECT = `
  id, planned_date, servings, meal_type, created_at, custom_title, custom_price, cooked_at,
  planned_meal_id, sort_order,
  recipes ( id, title, servings_base, prep_time_minutes, calories_per_serving,
    recipe_images ( storage_path, image_type )
  ),
  planned_meals ( id, title, combination_id )
`;

function normalizeMealPlanEntry(row) {
    const cover = (row.recipes?.recipe_images || []).find((img) => img.image_type === "cover");
    const hasRecipe = !!row.recipes;
    return {
          id: row.id,
          date: row.planned_date,
          servings: Number(row.servings),
          mealType: row.meal_type,
          recipeId: row.recipes?.id ?? null,
          recipeTitle: hasRecipe ? row.recipes.title : row.custom_title || "(gelöschtes Rezept)",
          recipeServingsBase: row.recipes ? Number(row.recipes.servings_base) : null,
          prepTimeMinutes: row.recipes?.prep_time_minutes ?? null,
caloriesPerServing: row.recipes?.calories_per_serving === null || row.recipes?.calories_per_serving === undefined ? null : Number(row.recipes.calories_per_serving),
          imageUrl: cover ? getRecipeImageUrl(cover.storage_path) : null,
          isCustom: !hasRecipe && !!row.custom_title,
          customPrice: row.custom_price === null || row.custom_price === undefined ? null : Number(row.custom_price),
          plannedMealId: row.planned_meal_id ?? null,
          mealTitle: row.planned_meals?.title ?? null,
          sortOrder: row.sort_order ?? 0,
          cookedAt: row.cooked_at ?? null,
    };
}
/** Lädt alle geplanten Mahlzeiten im Datumsbereich [startDate, endDate] (je "YYYY-MM-DD"). */
export async function listMealPlanEntries(startDate, endDate) {
  const { data, error } = await supabase
    .from("meal_plan_entries")
    .select(MEAL_PLAN_SELECT)
    .eq("workspace", currentWorkspace)
    .gte("planned_date", startDate)
    .lte("planned_date", endDate)
    .order("planned_date");
  if (error) throw error;
  return data.map(normalizeMealPlanEntry);
}

export async function addMealPlanEntry(date, recipeId, servings, mealType = "mittag") {
  const { data: meal, error: mealError } = await supabase
    .from("planned_meals")
    .insert({ planned_date: date, meal_type: mealType, workspace: currentWorkspace })
    .select()
    .single();
  if (mealError) throw mealError;

  const { data, error } = await supabase
    .from("meal_plan_entries")
    .insert({ planned_date: date, recipe_id: recipeId, servings, meal_type: mealType, planned_meal_id: meal.id, workspace: currentWorkspace })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Plant ein Rezept für eine bestimmte Mahlzeit an einem oder mehreren
 * aufeinanderfolgenden Tagen (z. B. "das gleiche Gericht auch morgen essen").
 * dayCount = 1 legt nur "date" an, dayCount = 2 zusätzlich den Folgetag.
 * Jeder Tag bekommt sein eigenes neues geplantes Essen (planned_meal) mit
 * dieser einen Komponente - das ist der einfache Standardfall und bleibt
 * genauso schnell wie zuvor: Rezept auswählen, Zeitfenster auswählen, fertig.
 */
export async function addMealPlanEntryForDays(date, recipeId, servings, mealType, dayCount = 1) {
  const start = new Date(date);
  const inserted = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

    const { data: meal, error: mealError } = await supabase
      .from("planned_meals")
      .insert({ planned_date: iso, meal_type: mealType, workspace: currentWorkspace })
      .select()
      .single();
    if (mealError) throw mealError;

    const { data: entry, error: entryError } = await supabase
      .from("meal_plan_entries")
      .insert({ planned_date: iso, recipe_id: recipeId, servings, meal_type: mealType, planned_meal_id: meal.id, workspace: currentWorkspace })
      .select()
      .single();
    if (entryError) throw entryError;
    inserted.push(entry);
  }
  return inserted;
}

export async function updateMealPlanEntryServings(id, servings) {
  const { error } = await supabase.from("meal_plan_entries").update({ servings }).eq("id", id);
  if (error) throw error;
}

/**
 * Entfernt eine einzelne Rezept-Komponente aus einem geplanten Essen. War es
 * die letzte verbliebene Komponente dieses Essens, wird das jetzt leere
 * planned_meal automatisch mit aufgeraeumt (keine Karteileichen im Plan).
 */
export async function removeMealPlanEntry(id) {
  const { data: existing, error: findError } = await supabase
    .from("meal_plan_entries")
    .select("planned_meal_id")
    .eq("id", id)
    .maybeSingle();
  if (findError) throw findError;

  const { error } = await supabase.from("meal_plan_entries").delete().eq("id", id);
  if (error) throw error;

  const plannedMealId = existing?.planned_meal_id;
  if (plannedMealId) {
    const { count, error: countError } = await supabase
      .from("meal_plan_entries")
      .select("id", { count: "exact", head: true })
      .eq("planned_meal_id", plannedMealId);
    if (countError) throw countError;
    if (!count) {
      await supabase.from("planned_meals").delete().eq("id", plannedMealId);
    }
  }
}

// Legt einen Wochenplan-Eintrag ohne Rezept an (z. B. "Doener"), optional mit Kosten.
export async function addCustomMealPlanEntry(date, mealType, title, price = null, extraItems = []) { const items = (extraItems || []).map((t) => (t || "").trim()).filter(Boolean); const mealTitle = items.length > 0 ? title : null; const { data: meal, error: mealError } = await supabase.from("planned_meals").insert({ planned_date: date, meal_type: mealType, title: mealTitle, workspace: currentWorkspace }).select().single(); if (mealError) throw mealError; const itemTitles = items.length > 0 ? items : [title]; const rows = itemTitles.map((t, i) => ({ planned_date: date, recipe_id: null, servings: 1, meal_type: mealType, custom_title: t, custom_price: i === 0 ? price : null, planned_meal_id: meal.id, sort_order: i, workspace: currentWorkspace, })); const { data, error } = await supabase.from("meal_plan_entries").insert(rows).select(); if (error) throw error; return data; } export async function addCustomComponentToPlannedMeal(plannedMealId, title) { const { data: meal, error: mealError } = await supabase.from("planned_meals").select("planned_date, meal_type").eq("id", plannedMealId).single(); if (mealError) throw mealError; const { data: siblings, error: siblingsError } = await supabase.from("meal_plan_entries").select("sort_order").eq("planned_meal_id", plannedMealId); if (siblingsError) throw siblingsError; const nextSortOrder = siblings.length > 0 ? Math.max(...siblings.map((s) => s.sort_order ?? 0)) + 1 : 0; const { data, error } = await supabase.from("meal_plan_entries").insert({ planned_date: meal.planned_date, meal_type: meal.meal_type, recipe_id: null, servings: 1, custom_title: title, planned_meal_id: plannedMealId, sort_order: nextSortOrder, workspace: currentWorkspace, }).select().single(); if (error) throw error; return data; } export async function listRecentCustomMealTitles(limit = 12) { const { data, error } = await supabase.from("meal_plan_entries").select("custom_title, custom_price, planned_date").eq("workspace", currentWorkspace).is("recipe_id", null).not("custom_title", "is", null).order("planned_date", { ascending: false }); if (error) throw error; const byTitle = new Map(); for (const row of data || []) { const key = (row.custom_title || "").trim(); if (!key) continue; if (!byTitle.has(key)) { byTitle.set(key, { title: key, price: row.custom_price === null || row.custom_price === undefined ? null : Number(row.custom_price), count: 1 }); } else { byTitle.get(key).count += 1; } } return [...byTitle.values()].sort((a, b) => b.count - a.count).slice(0, limit); }
/**
 * Fuegt einem bereits bestehenden geplanten Essen eine weitere Rezept-
 * Komponente hinzu (der "+ Gericht/Komponente hinzufügen"-Fall). Aus einem
 * bis dahin einfachen Einzelrezept-Essen wird dadurch ein mehrteiliges Essen.
 */
export async function addComponentToPlannedMeal(plannedMealId, recipeId, servings) {
  const { data: meal, error: mealError } = await supabase
    .from("planned_meals")
    .select("planned_date, meal_type")
    .eq("id", plannedMealId)
    .single();
  if (mealError) throw mealError;

  const { data: siblings, error: siblingsError } = await supabase
    .from("meal_plan_entries")
    .select("sort_order")
    .eq("planned_meal_id", plannedMealId);
  if (siblingsError) throw siblingsError;
  const nextSortOrder = siblings.length > 0 ? Math.max(...siblings.map((s) => s.sort_order ?? 0)) + 1 : 0;

  const { data, error } = await supabase
    .from("meal_plan_entries")
    .insert({
      planned_date: meal.planned_date,
      meal_type: meal.meal_type,
      recipe_id: recipeId,
      servings,
      planned_meal_id: plannedMealId,
      sort_order: nextSortOrder,
      workspace: currentWorkspace,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Vergibt/aendert den Titel eines geplanten Essens (z. B. "Raclette-Abend"). Ab der 2. Komponente ist ein Titel Pflicht. */
export async function renamePlannedMeal(plannedMealId, title) {
  const { error } = await supabase.from("planned_meals").update({ title }).eq("id", plannedMealId);
  if (error) throw error;
}

// --------------------------- Essens-Kombinationen ---------------------------
//
// Eine Kombination ist eine wiederverwendbare Vorlage fuer ein mehrteiliges
// Essen (z. B. "Unser Raclette"). Sie verknuepft lediglich bestehende Rezepte
// miteinander (meal_combination_items.recipe_id) - es werden dabei nie
// Rezepte kopiert. Beim Einfuegen in den Wochenplan wird die Verknuepfung
// als Snapshot uebernommen: neue meal_plan_entries-Zeilen, die weiterhin auf
// dieselben Rezepte verweisen. Spaetere Aenderungen an der Kombination oder
// am eingefuegten Essen wirken sich NICHT gegenseitig aus.

/** Laedt alle gespeicherten Kombinationen inkl. ihrer Rezept-Komponenten. */
export async function listMealCombinations() {
  const { data, error } = await supabase
    .from("meal_combinations")
    .select(`
      id, title, notes, created_at,
      meal_combination_items ( id, recipe_id, default_servings, sort_order,
        recipes ( id, title )
      )
    `)
    .eq("workspace", currentWorkspace)
    .order("title");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    notes: row.notes,
    items: [...row.meal_combination_items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((it) => ({
        id: it.id,
        recipeId: it.recipe_id,
        recipeTitle: it.recipes?.title ?? "(gelöschtes Rezept)",
        defaultServings: Number(it.default_servings),
      })),
  }));
}

/** Speichert die aktuellen Rezept-Komponenten eines geplanten Essens als neue, wiederverwendbare Kombination. */
export async function saveMealAsCombination(plannedMealId, title) {
  const { data: entries, error: entriesError } = await supabase
    .from("meal_plan_entries")
    .select("recipe_id, servings, sort_order")
    .eq("planned_meal_id", plannedMealId)
    .not("recipe_id", "is", null);
  if (entriesError) throw entriesError;
  if (!entries || entries.length === 0) {
    throw new Error("Dieses Essen hat keine Rezept-Komponenten zum Speichern.");
  }

  const { data: combo, error: comboError } = await supabase
    .from("meal_combinations")
    .insert({ title, workspace: currentWorkspace })
    .select()
    .single();
  if (comboError) throw comboError;

  const itemRows = entries.map((e, i) => ({
    combination_id: combo.id,
    recipe_id: e.recipe_id,
    default_servings: e.servings,
    sort_order: e.sort_order ?? i,
  }));
  const { error: itemsError } = await supabase.from("meal_combination_items").insert(itemRows);
  if (itemsError) throw itemsError;

  return combo;
}

/**
 * Fuegt eine gespeicherte Kombination als neues geplantes Essen in einen
 * Wochenplan-Slot ein (Ein-Klick-Uebernahme). Legt ein neues planned_meal an
 * (Titel = Kombinations-Titel) und kopiert die Verknuepfungen der
 * Kombination als eigene, neue meal_plan_entries-Zeilen - die referenzierten
 * Rezepte selbst werden dabei NICHT dupliziert, nur neu verknuepft.
 */
export async function applyCombinationToSlot(date, mealType, combinationId) {
  const { data: combo, error: comboError } = await supabase
    .from("meal_combinations")
    .select(`id, title, meal_combination_items ( recipe_id, default_servings, sort_order )`)
    .eq("id", combinationId)
    .single();
  if (comboError) throw comboError;

  const { data: meal, error: mealError } = await supabase
    .from("planned_meals")
    .insert({ planned_date: date, meal_type: mealType, title: combo.title, combination_id: combo.id, workspace: currentWorkspace })
    .select()
    .single();
  if (mealError) throw mealError;

  const items = [...combo.meal_combination_items].sort((a, b) => a.sort_order - b.sort_order);
  const entryRows = items.map((it, i) => ({
    planned_date: date,
    meal_type: mealType,
    recipe_id: it.recipe_id,
    servings: it.default_servings,
    planned_meal_id: meal.id,
    sort_order: i,
    workspace: currentWorkspace,
  }));
  const { error: insertError } = await supabase.from("meal_plan_entries").insert(entryRows);
  if (insertError) throw insertError;

  return meal;
}

/** Loescht eine gespeicherte Kombination (bereits eingeplante Essen, die daraus entstanden sind, bleiben unveraendert erhalten). */
export async function deleteMealCombination(id) {
  const { error } = await supabase.from("meal_combinations").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Kopiert alle geplanten Mahlzeiten einer Woche in eine andere Zielwoche.
  * Praktisch, wenn man denselben Plan (z. B. "Meal-Prep-Woche") wiederholen
   * moechte, ohne alles erneut einzeln einzutragen. Bestehende Eintraege in der
    * Zielwoche bleiben erhalten, es wird nur ergaenzt (keine Ueberschreibung).
     * Mehrteilige Essen (mehrere Rezept-Komponenten unter einem planned_meal)
      * werden dabei als EIN neues, zusammenhaengendes Essen kopiert (inkl. Titel),
       * zerfallen also beim Kopieren nicht in einzelne, unverbundene Eintraege.
        * Gibt die Anzahl der kopierten Eintraege zurueck.
         */
export async function copyMealPlanWeek(sourceStartDate, sourceEndDate, targetStartDate) {
    const { data: sourceRows, error: fetchError } = await supabase
      .from("meal_plan_entries")
      .select("planned_date, recipe_id, servings, meal_type, custom_title, custom_price, planned_meal_id, sort_order")
      .eq("workspace", currentWorkspace)
      .gte("planned_date", sourceStartDate)
      .lte("planned_date", sourceEndDate);
    if (fetchError) throw fetchError;
    if (!sourceRows || sourceRows.length === 0) return 0;

    const mealIds = [...new Set(sourceRows.map((r) => r.planned_meal_id).filter(Boolean))];
    let titleByMealId = new Map();
    if (mealIds.length > 0) {
      const { data: mealRows, error: mealErr } = await supabase
        .from("planned_meals")
        .select("id, title")
        .in("id", mealIds);
      if (mealErr) throw mealErr;
      titleByMealId = new Map(mealRows.map((m) => [m.id, m.title]));
    }

    const dayOffsetMs =
          new Date(`${targetStartDate}T00:00:00`).getTime() - new Date(`${sourceStartDate}T00:00:00`).getTime();
    const shiftDate = (isoDate) => {
          const shifted = new Date(`${isoDate}T00:00:00`).getTime() + dayOffsetMs;
          const d = new Date(shifted);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
                  d.getDate()
                ).padStart(2, "0")}`;
    };

    // Nach altem planned_meal_id gruppieren, damit mehrteilige Essen beim
    // Kopieren als EIN neues Essen (mit eigenem neuem planned_meal) ankommen,
    // statt in einzelne, unverbundene Eintraege zu zerfallen.
    const groups = new Map();
    sourceRows.forEach((row, i) => {
          const key = row.planned_meal_id || `solo:${i}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(row);
    });

    let copiedCount = 0;
    for (const [key, rows] of groups) {
          const first = rows[0];
          const targetDate = shiftDate(first.planned_date);
          const title = first.planned_meal_id ? titleByMealId.get(first.planned_meal_id) || null : null;

          const { data: newMeal, error: mealInsertError } = await supabase
            .from("planned_meals")
            .insert({ planned_date: targetDate, meal_type: first.meal_type, title, workspace: currentWorkspace })
            .select()
            .single();
          if (mealInsertError) throw mealInsertError;

          const entryRows = rows.map((row, i) => ({
                  planned_date: targetDate,
                  recipe_id: row.recipe_id,
                  servings: row.servings,
                  meal_type: row.meal_type,
                  custom_title: row.custom_title,
                  custom_price: row.custom_price,
                  planned_meal_id: newMeal.id,
                  sort_order: row.sort_order ?? i,
                  workspace: currentWorkspace,
          }));
          const { error: insertError } = await supabase.from("meal_plan_entries").insert(entryRows);
          if (insertError) throw insertError;
          copiedCount += entryRows.length;
    }

    return copiedCount;
}

/**
 * Loescht alle geplanten Mahlzeiten (inkl. der zugehoerigen planned_meals)
 * im Datumsbereich [startDate, endDate] der aktuellen Arbeitsumgebung - der
 * "Woche leeren"-Knopf im Wochenplan. Referenzierte Rezepte selbst werden
 * dabei nicht angeruehrt, nur die Verknuepfungen im Plan.
 */
export async function clearMealPlanWeek(startDate, endDate) {
  const { data: rows, error: fetchError } = await supabase
    .from("meal_plan_entries")
    .select("id, planned_meal_id")
    .eq("workspace", currentWorkspace)
    .gte("planned_date", startDate)
    .lte("planned_date", endDate);
  if (fetchError) throw fetchError;
  if (!rows || rows.length === 0) return 0;

  const { error: deleteError } = await supabase
    .from("meal_plan_entries")
    .delete()
    .eq("workspace", currentWorkspace)
    .gte("planned_date", startDate)
    .lte("planned_date", endDate);
  if (deleteError) throw deleteError;

  const mealIds = [...new Set(rows.map((r) => r.planned_meal_id).filter(Boolean))];
  if (mealIds.length > 0) {
    await supabase.from("planned_meals").delete().in("id", mealIds);
  }

  return rows.length;
}

// --------------------------- Einkaufsliste ---------------------------

export async function listShoppingListItems() {
  const { data, error } = await supabase
.from("shopping_list_items")
    .select("*")
    .eq("workspace", currentWorkspace)
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
      plannedPrice: row.planned_price === null || row.planned_price === undefined ? null : Number(row.planned_price),
      actualPrice: row.actual_price === null || row.actual_price === undefined ? null : Number(row.actual_price),
}));
}

export async function addShoppingListItem(name, plannedPrice = null) {
    const { error } = await supabase
      .from("shopping_list_items")
      .insert({ name, source: "manual", sort_order: 999, planned_price: plannedPrice, workspace: currentWorkspace });
    if (error) throw error;
}

export async function toggleShoppingListItem(id, checked) {
  const { error } = await supabase.from("shopping_list_items").update({ checked }).eq("id", id);
  if (error) throw error;
}

        // Fuegt einen bereits gekauften Posten hinzu (z. B. aus Kassenbon-Scan): direkt abgehakt mit tatsaechlichem Preis.
export async function addPurchasedShoppingListItem(name, actualPrice, spontaneous = false) {
  const { data, error } = await supabase
  .from("shopping_list_items")
  .insert({ name, source: spontaneous ? "receipt_spontaneous" : "receipt", sort_order: 999, checked: true, actual_price: actualPrice, workspace: currentWorkspace })
  .select()
  .single();
  if (error) throw error;
  return data;
}

/** Setzt geplanten und/oder tatsaechlichen Preis eines Postens. changes: Teilmenge aus { plannedPrice, actualPrice }. */
export async function updateShoppingListItemPrice(id, changes = {}) {
  const payload = {};
  if ("plannedPrice" in changes) payload.planned_price = changes.plannedPrice;
  if ("actualPrice" in changes) payload.actual_price = changes.actualPrice;
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase.from("shopping_list_items").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteShoppingListItem(id) {
    const { error } = await supabase.from("shopping_list_items").delete().eq("id", id);
    if (error) throw error;
}

/**
 * Entfernt alle abgehakten Posten aus der Einkaufsliste. Bevor geloescht wird,
  * werden ihre Preisangaben dauerhaft gesichert (siehe recordPurchaseHistory):
   * tatsaechliche Preise wandern in price_history (Basis fuer Durchschnittspreise),
    * geplante+tatsaechliche Summen werden auf die aktuelle Kalenderwoche in
     * weekly_household_costs aufaddiert (Basis fuer den Kosten-Tracker).
      */
export async function clearCheckedShoppingListItems() {
    const { data: checkedItems, error: fetchError } = await supabase
      .from("shopping_list_items")
      .select("name, unit, planned_price, actual_price, source")
      .eq("checked", true)
      .eq("workspace", currentWorkspace);
    if (fetchError) throw fetchError;

    if (checkedItems && checkedItems.length > 0) {
          await recordPurchaseHistory(checkedItems);
    }

    const { error } = await supabase.from("shopping_list_items").delete().eq("checked", true).eq("workspace", currentWorkspace);
    if (error) throw error;
}

/**
 * Loescht ALLE Posten der aktuellen Einkaufsliste (abgehakt oder nicht) -
 * anders als clearCheckedShoppingListItems werden dabei KEINE Preise in die
 * Kostenhistorie/den Wochenbericht uebernommen, da dies ein reiner
 * "Liste zuruecksetzen"-Knopf ist und kein abgeschlossener Einkauf.
 */
export async function clearShoppingList() {
  const { error } = await supabase.from("shopping_list_items").delete().eq("workspace", currentWorkspace);
  if (error) throw error;
}

// Einheiten, die sich sinnvoll ineinander umrechnen lassen, damit z. B.
// "500 g" aus einem Rezept und "0,5 kg" aus einem anderen als EINE Zutat
// zusammengezählt werden statt als zwei getrennte Einkaufsliste-Zeilen.
// canonical = die Einheit, in der intern aufsummiert wird; factor = wie
// viele "canonical"-Einheiten in einer Einheit dieser Zeile stecken.
const UNIT_CONVERSIONS = {
  g: { canonical: "g", factor: 1 },
  kg: { canonical: "g", factor: 1000 },
  ml: { canonical: "ml", factor: 1 },
  l: { canonical: "ml", factor: 1000 },
  TL: { canonical: "TL", factor: 1 },
  EL: { canonical: "TL", factor: 3 },
};

/** Wählt für eine aufsummierte "canonical"-Menge die am besten lesbare Einheit. */
function humanizeCanonicalAmount(canonicalUnit, amount) {
  if (canonicalUnit === "g" && amount >= 1000) {
    return { quantity: Math.round((amount / 1000) * 100) / 100, unit: "kg" };
  }
  if (canonicalUnit === "ml" && amount >= 1000) {
    return { quantity: Math.round((amount / 1000) * 100) / 100, unit: "l" };
  }
  if (canonicalUnit === "TL" && amount >= 3 && Math.round(amount) % 3 === 0) {
    return { quantity: Math.round(amount) / 3, unit: "EL" };
  }
  return { quantity: amount, unit: canonicalUnit };
}

/**
 * Baut die Einkaufsliste aus allen Rezepten neu, die im Datumsbereich
 * [startDate, endDate] eingeplant sind: Mengen werden über alle Rezepte
 * hinweg pro Zutat aufsummiert (skaliert auf die geplante Portionenzahl).
 * Gleiche Zutaten mit kompatiblen Einheiten (g/kg, ml/l, TL/EL) werden
 * umgerechnet und zusammengezählt. Bleiben nach der Umrechnung trotzdem
 * mehrere, nicht vergleichbare Angaben übrig (z. B. "2 TL" und "nach
 * Geschmack"), landen sie als EIN kombinierter Text in einer einzigen
 * Zeile statt als Duplikate. Nur automatisch erzeugte Positionen ("plan")
 * werden ersetzt – manuell hinzugefügte Items und ihr Abhak-Status bleiben
 * erhalten. Gibt die Anzahl der erzeugten Positionen zurück.
 *
 * Hinweis Mehrkomponenten-Essen: listMealPlanEntries liefert weiterhin EINE
 * Zeile je Rezept-Komponente (unabhängig davon, ob mehrere Komponenten zu
 * einem gemeinsamen planned_meal gehören). Diese Funktion summiert bereits
 * je recipeId über alle Zeilen im Zeitraum, daher fließen die Zutaten ALLER
 * Komponenten eines mehrteiligen Essens automatisch mit ein - ohne dass hier
 * irgendetwas Gruppierungsspezifisches noetig ist.
 */
export async function generateShoppingList(startDate, endDate) {
  const entries = await listMealPlanEntries(startDate, endDate);

  if (entries.length === 0) {
    const { error } = await supabase.from("shopping_list_items").delete().eq("source", "plan").eq("workspace", currentWorkspace);
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
  // Zutaten werden zuerst nur nach NAME gruppiert (nicht mehr nach
  // Name+Einheit) – die konkreten Mengen/Einheiten sammeln sich in
  // "subgroups" darunter und werden erst danach zusammengeführt.
  const byName = new Map(); // nameLower -> { name, subgroups: Map(subKey -> {quantity, unit, canonical}) }

  for (const entry of entries) { const recipe = recipesById.get(entry.recipeId); if (!recipe) continue; const base = Number(recipe.servings_base) || 1; const ratio = entry.servings / base; for (const ri of recipe.recipe_ingredients) { const name = ri.ingredients?.name?.trim(); if (!name) continue; const nameKey = name.toLowerCase(); const rawUnit = ri.units?.abbreviation || ""; if (!byName.has(nameKey)) byName.set(nameKey, { name, subgroups: new Map() }); const group = byName.get(nameKey); if (ri.quantity === null) { const subKey = `text|${rawUnit}`; if (!group.subgroups.has(subKey)) { group.subgroups.set(subKey, { quantity: null, unit: rawUnit }); } continue; } const scaled = Number(ri.quantity) * ratio; const conversion = UNIT_CONVERSIONS[rawUnit]; if (conversion) { const subKey = `unit|${conversion.canonical}`; const amount = scaled * conversion.factor; const existing = group.subgroups.get(subKey); if (existing) { existing.quantity += amount; } else { group.subgroups.set(subKey, { quantity: amount, unit: conversion.canonical, canonical: true }); } } else { const subKey = `unit|${rawUnit}`; const existing = group.subgroups.get(subKey); if (existing) { existing.quantity += scaled; } else { group.subgroups.set(subKey, { quantity: scaled, unit: rawUnit }); } } } } for (const entry of entries) { if (entry.recipeId || !entry.isCustom) continue; const rawName = (entry.recipeTitle || "").trim(); if (!rawName) continue; const nameKey = rawName.toLowerCase(); if (!byName.has(nameKey)) byName.set(nameKey, { name: rawName, subgroups: new Map() }); const group = byName.get(nameKey); const subKey = "text|custom"; if (!group.subgroups.has(subKey)) group.subgroups.set(subKey, { quantity: null, unit: "" }); } const items = [];
  for (const { name, subgroups } of byName.values()) {
    const parts = [...subgroups.values()].map((sg) => {
      if (sg.quantity === null) return { quantity: null, unit: sg.unit || "" };
      const human = sg.canonical ? humanizeCanonicalAmount(sg.unit, sg.quantity) : { quantity: sg.quantity, unit: sg.unit };
      return human;
    });

    if (parts.length === 1) {
      const p = parts[0];
      items.push({ name, quantity: p.quantity, unit: p.unit || null });
    } else {
      // Mehrere unterschiedliche/unvergleichbare Einheiten für dieselbe
      // Zutat übrig – zu einem lesbaren Text zusammenfassen, damit die
      // Zutat trotzdem nur EINMAL in der Liste auftaucht.
      const combinedText = parts
        .map((p) =>
          p.quantity !== null ? `${formatQuantity(p.quantity)}${p.unit ? " " + p.unit : ""}` : p.unit || "nach Geschmack"
        )
        .join(" + ");
      items.push({ name, quantity: null, unit: combinedText });
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name, "de"));

  const { error: deleteError } = await supabase
    .from("shopping_list_items")
    .delete()
    .eq("source", "plan")
    .eq("workspace", currentWorkspace);
  if (deleteError) throw deleteError;

  if (items.length > 0) {
    const rows = items.map((it, i) => ({
      name: it.name,
      quantity: it.quantity,
      unit: it.unit || null,
      source: "plan",
      sort_order: i,
      workspace: currentWorkspace,
    }));
    const { error: insertError } = await supabase.from("shopping_list_items").insert(rows);
    if (insertError) throw insertError;
  }

  return items.length;
}

// --------------------------- Vorrat / Inventar ---------------------------
//
// inventory_items bildet den aktuellen Lebensmittelbestand ab (je Eintrag
// eine "Charge", z. B. eine gekaufte Packung, mit eigener Menge/MHD).
// expiry_date ist optional, da nicht jedes Lebensmittel ein MHD hat.

function normalizeInventoryItem(row) {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
    expiryDate: row.expiry_date,
    source: row.source,
  };
}

/** Lädt den gesamten Bestand, sortiert nach MHD (bald ablaufend zuerst, kein MHD am Ende). */
export async function listInventoryItems() {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("workspace", currentWorkspace)
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .order("name");
  if (error) throw error;
  return data.map(normalizeInventoryItem);
}

export async function getExpiringInventoryItems(days = 3) {
    const today = new Date();
    const limit = new Date(today);
    limit.setDate(limit.getDate() + days);
    const limitIso = limit.toISOString().slice(0, 10);
    const { data, error } = await supabase
          .from("inventory_items")
          .select("*")
          .eq("workspace", currentWorkspace)
          .not("expiry_date", "is", null)
          .lte("expiry_date", limitIso)
          .order("expiry_date", { ascending: true });
    if (error) throw error;
    return data.map(normalizeInventoryItem);
}

export async function addInventoryItem(item) {
  const { error } = await supabase.from("inventory_items").insert({
    name: item.name,
    quantity: item.quantity ?? null,
    unit: item.unit || null,
    expiry_date: item.expiryDate || null,
    source: item.source || "manual",
    workspace: currentWorkspace,
  });
  if (error) throw error;
}

export async function addInventoryItemsBulk(items) {
const missing = items.find((it) => !it.expiryDate);
if (missing) {
throw new Error(`MHD fehlt bei "${missing.name}" - bitte fuer alle Posten ein Mindesthaltbarkeitsdatum angeben.`);
}
const rows = items.map((item) => ({
name: item.name,
quantity: item.quantity ?? null,
unit: item.unit || null,
expiry_date: item.expiryDate,
source: item.source || "photo_import",
workspace: currentWorkspace,
}));
const { error } = await supabase.from("inventory_items").insert(rows);
if (error) throw error;
}

/** Bulk-Insert fuer die Foto-Inventur (und die Sammel-Uebernahme aus der Einkaufsliste): legt mehrere Posten auf einmal an. Jeder Posten braucht ein MHD (Pflichtfeld, siehe Vorrat-UI) - wird hier nochmal serverseitig abgesichert, falls die Frontend-Pruefung je umgangen wird. */
/** changes: beliebige Teilmenge aus { quantity, unit, expiryDate }. */
export async function updateInventoryItem(id, changes) {
  const payload = {};
  if ("quantity" in changes) payload.quantity = changes.quantity;
  if ("unit" in changes) payload.unit = changes.unit;
  if ("expiryDate" in changes) payload.expiry_date = changes.expiryDate;
  const { error } = await supabase.from("inventory_items").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteInventoryItem(id) {
  const { error } = await supabase.from("inventory_items").delete().eq("id", id);
  if (error) throw error;
}


async function recordPurchaseHistory(items) {
    const todayIso = formatDateISO(new Date());
    const weekStartIso = formatDateISO(getWeekStart(new Date()));

    let plannedSum = 0;
    let actualSum = 0;
    const priceHistoryRows = [];

    for (const item of items) {
          const planned = item.planned_price === null || item.planned_price === undefined ? 0 : Number(item.planned_price);
          const actual = item.actual_price === null || item.actual_price === undefined ? 0 : Number(item.actual_price);
          plannedSum += planned;
          actualSum += actual;
          if (item.actual_price !== null && item.actual_price !== undefined) {
                  priceHistoryRows.push({
                            ingredient_name: item.name,
                            price: actual,
                            unit: item.unit || null,
                            recorded_date: todayIso,
                            is_spontaneous: item.source === "receipt_spontaneous",
                            workspace: currentWorkspace,
                  });
          }
    }

    if (priceHistoryRows.length > 0) {
          const { error } = await supabase.from("price_history").insert(priceHistoryRows);
          if (error) throw error;
    }

    if (plannedSum > 0 || actualSum > 0) {
          const { data: existing, error: findError } = await supabase
            .from("weekly_household_costs")
            .select("*")
            .eq("week_start", weekStartIso)
            .eq("workspace", currentWorkspace)
            .maybeSingle();
          if (findError) throw findError;

          if (existing) {
                  const { error: updError } = await supabase
                    .from("weekly_household_costs")
                    .update({
                                planned_total: Number(existing.planned_total) + plannedSum,
                                actual_total: Number(existing.actual_total) + actualSum,
                                updated_at: new Date().toISOString(),
                    })
                    .eq("week_start", weekStartIso)
                    .eq("workspace", currentWorkspace);
                  if (updError) throw updError;
          } else {
                  const { error: insError } = await supabase.from("weekly_household_costs").insert({
                            week_start: weekStartIso,
                            planned_total: plannedSum,
                            actual_total: actualSum,
                            workspace: currentWorkspace,
                  });
                  if (insError) throw insError;
          }
    }
}

export async function getAveragePrice(ingredientName) {
    const trimmed = (ingredientName || "").trim();
    if (!trimmed) return null;
    const { data, error } = await supabase.from("price_history").select("price").eq("workspace", currentWorkspace).ilike("ingredient_name", trimmed);
    if (error) throw error;
    if (!data || data.length === 0) return null;
    const sum = data.reduce((acc, row) => acc + Number(row.price), 0);
    return sum / data.length;
}

export async function getPriceHistoryInRange(startDate, endDate) {
    const { data, error } = await supabase
      .from("price_history")
      .select("*")
      .eq("workspace", currentWorkspace)
      .gte("recorded_date", startDate)
      .lte("recorded_date", endDate)
      .order("recorded_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.map((row) => ({
          id: row.id,
          ingredientName: row.ingredient_name,
          price: Number(row.price),
          unit: row.unit,
          recordedDate: row.recorded_date,
          isSpontaneous: !!row.is_spontaneous,
    }));
}

export async function getRecentPriceHistory(limit = 8) {
    const { data, error } = await supabase
      .from("price_history")
      .select("*")
      .eq("workspace", currentWorkspace)
      .order("recorded_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data.map((row) => ({
          id: row.id,
          ingredientName: row.ingredient_name,
          price: Number(row.price),
          unit: row.unit,
          recordedDate: row.recorded_date,
    }));
}

export async function getWeeklyHouseholdCosts(limitWeeks = 26) {
    const { data, error } = await supabase
      .from("weekly_household_costs")
      .select("*")
      .eq("workspace", currentWorkspace)
      .order("week_start", { ascending: false })
      .limit(limitWeeks);
    if (error) throw error;
    return data.map((row) => ({
          weekStart: row.week_start,
          plannedTotal: Number(row.planned_total),
          actualTotal: Number(row.actual_total),
    }));
}

// Wochenplan-Eintraege ohne Rezept ("Anderes") mit hinterlegten Kosten im Datumsbereich - fuer den Kosten-Tracker.
export async function getCustomMealCostsInRange(startDate, endDate) {
    const { data, error } = await supabase
      .from("meal_plan_entries")
      .select("id, planned_date, custom_title, custom_price")
      .eq("workspace", currentWorkspace)
      .is("recipe_id", null)
      .not("custom_price", "is", null)
      .gte("planned_date", startDate)
      .lte("planned_date", endDate)
      .order("planned_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((row) => ({
          id: row.id,
          date: row.planned_date,
          title: row.custom_title || "Anderes",
          price: Number(row.custom_price),
    }));
}

/* Alle Zutaten-Namen, für die mindestens ein Preis erfasst wurde (alphabetisch, für die Auswahl im Preis-Trend). */
export async function listPricedIngredientNames() {
    const { data, error } = await supabase.from("price_history").select("ingredient_name").eq("workspace", currentWorkspace);
    if (error) throw error;
    const names = [...new Set((data || []).map((row) => row.ingredient_name))];
    return names.sort((a, b) => a.localeCompare(b, "de"));
}

/*
 * Preisverlauf einer einzelnen Zutat über die Zeit, inkl. Trend-Kennzahlen.
  * Liefert null, wenn noch keine Preise erfasst wurden, sonst
   * { ingredientName, points: [{date, price, unit}], average, latest, trend: { direction, percent } }.
    */
export async function getPriceTrendForIngredient(ingredientName) {
    const trimmed = (ingredientName || "").trim();
    if (!trimmed) return null;

    const { data, error } = await supabase
      .from("price_history")
      .select("*")
      .eq("workspace", currentWorkspace)
      .ilike("ingredient_name", trimmed)
      .order("recorded_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) return null;

    const points = data.map((row) => ({
          date: row.recorded_date,
          price: Number(row.price),
          unit: row.unit,
    }));

    const average = points.reduce((sum, p) => sum + p.price, 0) / points.length;
    const latest = points[points.length - 1].price;

    let trend = { direction: "stable", percent: 0 };
    if (points.length >= 2) {
          const compareCount = Math.max(1, Math.min(3, Math.floor(points.length / 2)));
          const earlierSlice = points.slice(0, compareCount);
          const laterSlice = points.slice(-compareCount);
          const earlierAvg = earlierSlice.reduce((sum, p) => sum + p.price, 0) / earlierSlice.length;
          const laterAvg = laterSlice.reduce((sum, p) => sum + p.price, 0) / laterSlice.length;
          if (earlierAvg > 0) {
                  const percent = ((laterAvg - earlierAvg) / earlierAvg) * 100;
                  trend = {
                            direction: percent > 3 ? "up" : percent < -3 ? "down" : "stable",
                            percent,
                  };
          }
    }

    return {
          ingredientName: data[0].ingredient_name,
          points,
          average,
          latest,
          trend,
    };
}

  export function normalizeIngredientName(name) {
      return (name || "").trim().toLowerCase();
  }

export function ingredientNamesMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));
}

export async function suggestRecipesFromInventory(limit = 6) {
    const [inventory, recipes] = await Promise.all([listInventoryItems(), listRecipes()]);
    if (inventory.length === 0 || recipes.length === 0) return [];

    const soonLimit = new Date();
    soonLimit.setDate(soonLimit.getDate() + 4);

    const inventoryEntries = inventory.map((item) => ({
          name: normalizeIngredientName(item.name),
          expiringSoon: !!item.expiryDate && new Date(`${item.expiryDate}T00:00:00`) <= soonLimit,
    }));

    const suggestions = [];
    for (const recipe of recipes) {
          if (!recipe.ingredients || recipe.ingredients.length === 0) continue;
          const matchedIngredients = [];
          let expiringMatchedCount = 0;
          for (const ing of recipe.ingredients) {
                  const ingName = normalizeIngredientName(ing.ingredientName);
                  if (!ingName) continue;
                  const hit = inventoryEntries.find((inv) => ingredientNamesMatch(inv.name, ingName));
                  if (hit) {
                            matchedIngredients.push(ing.ingredientName);
                            if (hit.expiringSoon) expiringMatchedCount++;
                  }
          }
          if (matchedIngredients.length === 0) continue;
          const matchRatio = matchedIngredients.length / recipe.ingredients.length;
          const score = matchRatio * 100 + expiringMatchedCount * 15;
          suggestions.push({
                  recipe,
                  matchedCount: matchedIngredients.length,
                  totalCount: recipe.ingredients.length,
                  matchRatio,
                  matchedIngredients,
                  expiringMatchedCount,
                  score,
          });
    }

    suggestions.sort((a, b) => b.score - a.score);
    return suggestions.slice(0, limit);
}


// --------------------------- Waste-Score (Gamification, Phase A) ---------------------------
//
// Event-sourced: waste_score_events wird nur angehaengt, nie veraendert oder
// geloescht. Alles Abgeleitete (Summen, Level, Stimmung, Badges) wird in
// einer spaeteren Phase aus diesem Log berechnet, nicht hier schon gepflegt.

async function logWasteScoreEvent({
  eventType,
  points,
  inventoryItemId = null,
  recipeId = null,
  mealPlanEntryId = null,
  estimatedValue = null,
  note = null,
}) {
  const { error } = await supabase.from("waste_score_events").insert({
    workspace: currentWorkspace,
    event_type: eventType,
    points,
    inventory_item_id: inventoryItemId,
    recipe_id: recipeId,
    meal_plan_entry_id: mealPlanEntryId,
    estimated_value: estimatedValue,
    note,
  });
  if (error) throw error;
}

/**
 * Markiert einen Vorratsposten als aufgebraucht (statt kommentarlos geloescht).
 * Punkte gestaffelt danach, wie knapp vor Ablauf des MHD noch verwendet wurde.
 * Gibt die vergebenen Punkte zurueck (fuer eine kurze UI-Rueckmeldung).
 */
export async function markInventoryItemUsed(id) {
  const { data: item, error: findError } = await supabase
    .from("inventory_items")
    .select("name, expiry_date")
    .eq("id", id)
    .maybeSingle();
  if (findError) throw findError;

  let points = 5;
  if (item?.expiry_date) {
    const days = daysUntil(item.expiry_date);
    if (days === null) points = 5;
    else if (days < 0) points = 3;
    else if (days <= 1) points = 20;
    else if (days <= 3) points = 15;
    else if (days <= 7) points = 10;
    else points = 5;
  }

  await deleteInventoryItem(id);
  await logWasteScoreEvent({
    eventType: "used_before_expiry",
    points,
    note: item?.name || null,
  });
  return points;
}

/**
 * Markiert einen Vorratsposten als weggeworfen. Punktabzug gestaffelt nach
 * geschaetztem Wert (falls Preishistorie fuer den Namen existiert), sonst
 * ein moderater Pauschalabzug. Bewusst gedeckelt, damit es nie hart bestrafend
 * wirkt, nur ein spielerischer Denkzettel.
 */
export async function markInventoryItemWasted(id) {
  const { data: item, error: findError } = await supabase
    .from("inventory_items")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (findError) throw findError;

  let points = -8;
  let estimatedValue = null;
  if (item?.name) {
    try {
      const avg = await getAveragePrice(item.name);
      if (avg !== null) {
        estimatedValue = avg;
        points = -Math.min(25, Math.max(5, Math.round(avg * 4)));
      }
    } catch {
      // Preis-Schaetzung ist optional - Score-Vergabe darf daran nicht scheitern.
    }
  }

  await deleteInventoryItem(id);
  await logWasteScoreEvent({
    eventType: "thrown_away",
    points,
    estimatedValue,
    note: item?.name || null,
  });
  return points;
}

/**
 * Schaltet den "gekocht"-Status einer Rezept-Komponente im Wochenplan um.
 * Beim erstmaligen Markieren wird geprueft, ob das Rezept mindestens eine
 * aktuell bald ablaufende Vorrats-Zutat verwendet - wenn ja, gibt es einen
 * Bonus (staerkstes positives Signal: aktiv Reste verwertet statt nur
 * "zufaellig" aufgebraucht). Beim Zuruecksetzen werden KEINE Punkte wieder
 * abgezogen (Score-Log bleibt rein additiv).
 */
export async function markMealPlanEntryCooked(id) {
  const { data: entry, error: findError } = await supabase
    .from("meal_plan_entries")
    .select("id, recipe_id, cooked_at")
    .eq("id", id)
    .single();
  if (findError) throw findError;

  if (entry.cooked_at) {
    const { error } = await supabase.from("meal_plan_entries").update({ cooked_at: null }).eq("id", id);
    if (error) throw error;
    return { cooked: false, bonusPoints: 0 };
  }

  const { error: updateError } = await supabase
    .from("meal_plan_entries")
    .update({ cooked_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) throw updateError;

  let bonusPoints = 0;
  if (entry.recipe_id) {
    try {
      const [recipe, expiring] = await Promise.all([getRecipe(entry.recipe_id), getExpiringInventoryItems(4)]);
      const expiringNames = expiring.map((i) => normalizeIngredientName(i.name));
      let matchCount = 0;
      for (const ing of recipe.ingredients) {
        const ingName = normalizeIngredientName(ing.ingredientName);
        if (expiringNames.some((n) => ingredientNamesMatch(n, ingName))) matchCount++;
      }
      if (matchCount > 0) {
        bonusPoints = 15 * Math.min(3, matchCount);
        await logWasteScoreEvent({
          eventType: "used_via_recipe",
          points: bonusPoints,
          recipeId: entry.recipe_id,
          mealPlanEntryId: id,
          note: recipe.title,
        });
      }
    } catch {
      // Score-Bonus ist ein Nice-to-have - darf das eigentliche Markieren
      // nicht verhindern (z.B. wenn das Rezept inzwischen geloescht wurde).
    }
  }

  return { cooked: true, bonusPoints };
}
