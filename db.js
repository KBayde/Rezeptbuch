// ============================================================================
// Datenzugriffs-Schicht: alle Supabase-Aufrufe leben hier gebündelt.
// Views rufen nur diese Funktionen auf und wissen nichts von Tabellen/SQL.
// Das hält die spätere Erweiterung (Einkaufsliste, Inventar, Webhook-Import)
// einfach: neue Funktionen hier ergänzen, Views bleiben unangetastet.
// ============================================================================
import { supabase } from "./supabaseClient.js";
import { formatQuantity, getWeekStart, formatDateISO } from "./utils.js";

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
  servings_base, notes, meal_types, created_at, updated_at,
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
      plannedPrice: row.planned_price === null || row.planned_price === undefined ? null : Number(row.planned_price),
      actualPrice: row.actual_price === null || row.actual_price === undefined ? null : Number(row.actual_price),
}));
}

export async function addShoppingListItem(name, plannedPrice = null) {
    const { error } = await supabase
      .from("shopping_list_items")
      .insert({ name, source: "manual", sort_order: 999, planned_price: plannedPrice });
    if (error) throw error;
}

export async function toggleShoppingListItem(id, checked) {
  const { error } = await supabase.from("shopping_list_items").update({ checked }).eq("id", id);
  if (error) throw error;
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
      .select("name, unit, planned_price, actual_price")
      .eq("checked", true);
    if (fetchError) throw fetchError;

    if (checkedItems && checkedItems.length > 0) {
          await recordPurchaseHistory(checkedItems);
    }

    const { error } = await supabase.from("shopping_list_items").delete().eq("checked", true);
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
  // Zutaten werden zuerst nur nach NAME gruppiert (nicht mehr nach
  // Name+Einheit) – die konkreten Mengen/Einheiten sammeln sich in
  // "subgroups" darunter und werden erst danach zusammengeführt.
  const byName = new Map(); // nameLower -> { name, subgroups: Map(subKey -> {quantity, unit, canonical}) }

  for (const entry of entries) {
    const recipe = recipesById.get(entry.recipeId);
    if (!recipe) continue;
    const base = Number(recipe.servings_base) || 1;
    const ratio = entry.servings / base;

    for (const ri of recipe.recipe_ingredients) {
      const name = ri.ingredients?.name?.trim();
      if (!name) continue;
      const nameKey = name.toLowerCase();
      const rawUnit = ri.units?.abbreviation || "";

      if (!byName.has(nameKey)) byName.set(nameKey, { name, subgroups: new Map() });
      const group = byName.get(nameKey);

      if (ri.quantity === null) {
        // z. B. "nach Geschmack" – ohne Menge, nur einmal je Einheit auflisten
        const subKey = `text|${rawUnit}`;
        if (!group.subgroups.has(subKey)) {
          group.subgroups.set(subKey, { quantity: null, unit: rawUnit });
        }
        continue;
      }

      const scaled = Number(ri.quantity) * ratio;
      const conversion = UNIT_CONVERSIONS[rawUnit];

      if (conversion) {
        const subKey = `unit|${conversion.canonical}`;
        const amount = scaled * conversion.factor;
        const existing = group.subgroups.get(subKey);
        if (existing) {
          existing.quantity += amount;
        } else {
          group.subgroups.set(subKey, { quantity: amount, unit: conversion.canonical, canonical: true });
        }
      } else {
        const subKey = `unit|${rawUnit}`;
        const existing = group.subgroups.get(subKey);
        if (existing) {
          existing.quantity += scaled;
        } else {
          group.subgroups.set(subKey, { quantity: scaled, unit: rawUnit });
        }
      }
    }
  }

  const items = [];
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
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .order("name");
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
  });
  if (error) throw error;
}

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
                    .eq("week_start", weekStartIso);
                  if (updError) throw updError;
          } else {
                  const { error: insError } = await supabase.from("weekly_household_costs").insert({
                            week_start: weekStartIso,
                            planned_total: plannedSum,
                            actual_total: actualSum,
                  });
                  if (insError) throw insError;
          }
    }
}

export async function getAveragePrice(ingredientName) {
    const trimmed = (ingredientName || "").trim();
    if (!trimmed) return null;
    const { data, error } = await supabase.from("price_history").select("price").ilike("ingredient_name", trimmed);
    if (error) throw error;
    if (!data || data.length === 0) return null;
    const sum = data.reduce((acc, row) => acc + Number(row.price), 0);
    return sum / data.length;
}

export async function getPriceHistoryInRange(startDate, endDate) {
    const { data, error } = await supabase
      .from("price_history")
      .select("*")
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
    }));
}

export async function getRecentPriceHistory(limit = 8) {
    const { data, error } = await supabase
      .from("price_history")
      .select("*")
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
      .order("week_start", { ascending: false })
      .limit(limitWeeks);
    if (error) throw error;
    return data.map((row) => ({
          weekStart: row.week_start,
          plannedTotal: Number(row.planned_total),
          actualTotal: Number(row.actual_total),
    }));
}
