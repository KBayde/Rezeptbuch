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

/** Lädt eine Bilddatei in den Storage-Bucket hoch und gibt den Speicherpfad zurück. */
export async function uploadRecipeImage(file) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** Baut aus einem gespeicherten Bildpfad die öffentliche Bild-URL. */
export function getRecipeImageUrl(imagePath) {
  if (!imagePath) return null;
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(imagePath).data.publicUrl;
}

// --------------------------- Rezepte lesen ---------------------------

const RECIPE_SELECT = `
  id, title, source_type, source_text, source_url, prep_time_minutes,
  servings_base, notes, image_path, created_at, updated_at,
  recipe_steps ( id, step_number, instruction ),
  recipe_ingredients ( id, quantity, note, sort_order,
    ingredients ( id, name ),
    units ( id, name, abbreviation )
  ),
  recipe_tags ( tags ( id, name ) )
`;

function normalizeRecipe(row) {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceText: row.source_text,
    sourceUrl: row.source_url,
    prepTimeMinutes: row.prep_time_minutes,
    servingsBase: Number(row.servings_base),
    notes: row.notes,
    imagePath: row.image_path,
    imageUrl: getRecipeImageUrl(row.image_path),
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
      image_path: form.imagePath || null,
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
      image_path: form.imagePath || null,
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
