// ============================================================================
// Kleine Helfer-Funktionen, die von mehreren Views genutzt werden.
// ============================================================================

/** Verzögert Funktionsaufrufe (z. B. für Live-Suche ohne Tastatur-Ruckeln). */
export function debounce(fn, delayMs = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

/** Wandelt beliebigen Text in HTML-sicheren Text um (verhindert HTML-Injektion). */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\'", "&#39;");
}

const FRACTIONS = [
  { value: 0.25, glyph: "¼" },
  { value: 0.333, glyph: "⅓" },
  { value: 0.5, glyph: "½" },
  { value: 0.667, glyph: "⅔" },
  { value: 0.75, glyph: "¾" },
];

/**
 * Formatiert eine (ggf. skalierte) Mengenangabe für die Anzeige.
 * Erkennt gängige Koch-Brüche (½, ¼ ...) und rundet ansonsten sauber.
 */
export function formatQuantity(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const whole = Math.floor(value);
  const rest = value - whole;

  const closeFraction = FRACTIONS.find((f) => Math.abs(rest - f.value) < 0.05);
  if (closeFraction) {
    return whole > 0 ? `${whole}${closeFraction.glyph}` : closeFraction.glyph;
  }

  const rounded = Math.round(value * 100) / 100;
  // Ganzzahlen ohne Nachkommastellen anzeigen, sonst max. 2 Nachkommastellen
  if (Number.isInteger(rounded)) return String(rounded);
  return String(Math.round(value * 10) / 10);
}

/** Skaliert eine Menge von der Basis-Portionszahl auf die gewünschte Portionszahl. */
export function scaleQuantity(quantity, servingsBase, servingsWanted) {
  if (quantity === null || quantity === undefined) return null;
  if (!servingsBase || servingsBase <= 0) return quantity;
  return (quantity / servingsBase) * servingsWanted;
}

export function formatMinutes(minutes) {
  if (!minutes && minutes !== 0) return "–";
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

export const SOURCE_TYPE_LABELS = {
  link: "Link",
  book: "Kochbuch",
  hellofresh: "HelloFresh",
  magazine: "Zeitschrift",
  family: "Familie/Freunde",
  other: "Sonstige",
};

// --------------------------- Datum (Wochenplan) ---------------------------

export const WEEKDAY_LABELS_DE = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

/** Liefert den Montag (00:00 lokal) der Woche, in der "date" liegt. */
export function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sonntag, 1 = Montag, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Formatiert ein Datum als YYYY-MM-DD (für Supabase "date"-Spalten). */
export function formatDateISO(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Formatiert ein Datum kurz für die Anzeige, z. B. "17.08." */
export function formatDateDisplay(date) {
  const d = new Date(date);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

/** Mahlzeiten-Slots für den Wochenplan (Stundenplan-Zeilen), in Anzeigereihenfolge. */
export const MEAL_TYPES = [
  { key: "fruehstueck", label: "Frühstück", icon: "☀️" },
  { key: "mittag", label: "Mittag", icon: "🍽️" },
  { key: "snack", label: "Snack", icon: "🍏" },
  { key: "abendessen", label: "Abendessen", icon: "🌙" },
];

// --------------------------- Datum (Vorrat / MHD) ---------------------------

/** Formatiert ein Datum ausführlich mit Jahr, z. B. "17.08.2026" (für MHD-Anzeigen). */
export function formatDateDisplayFull(date) {
  const d = new Date(date);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Ganzzahlige Differenz in Tagen zwischen heute (lokal, Mitternacht) und "dateStr" (YYYY-MM-DD). */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

// Grobe Schaetzung der Haltbarkeit in Tagen ab heute, fuer Lebensmittel ohne
// aufgedrucktes MHD (z. B. lose Zitrusfruechte) oder wenn man das MHD gerade
// nicht ablesen kann/mag. Bewusst grob (keine Lebensmitteldatenbank) - dient
// nur als Startwert zum Ausfuellen des Pflichtfelds, der Mensch kann und soll
// ihn jederzeit anpassen. "override" greift vor der (groeberen) Kategorie.
const SHELF_LIFE_OVERRIDES = [
  { days: 3, keywords: ["salat", "spinat", "rucola", "kräuter", "petersilie", "basilikum", "koriander", "schnittlauch", "minze", "dill", "pilz", "champignon", "erdbeere", "himbeere", "beere"] },
  { days: 7, keywords: ["hähnchen", "huhn", "pute", "hack", "fisch", "lachs", "garnele", "milch", "joghurt", "quark", "sahne", "brot", "brötchen"] },
  { days: 21, keywords: ["zitrone", "limette", "apfel", "orange", "möhre", "karotte", "kohl", "paprika", "gurke"] },
  { days: 60, keywords: ["zwiebel", "knoblauch", "kartoffel", "kürbis"] },
];

const SHELF_LIFE_BY_CATEGORY = {
  meat: 5,
  dairy: 10,
  produce: 10,
  bakery: 5,
  frozen: 120,
  beverages: 180,
  spices: 365,
  pantry: 270,
  other: 14,
};

/** Grobe Haltbarkeits-Schätzung in Tagen ab heute für einen Lebensmittelnamen. */
export function estimateShelfLifeDays(name) {
  const n = (name || "").toLowerCase();
  const override = SHELF_LIFE_OVERRIDES.find((o) => o.keywords.some((kw) => n.includes(kw)));
  if (override) return override.days;
  const cat = categorizeIngredient(name);
  return SHELF_LIFE_BY_CATEGORY[cat.key] ?? 14;
}

/** Schätzt ein MHD (YYYY-MM-DD) ab heute für einen Lebensmittelnamen - siehe estimateShelfLifeDays. */
export function estimateExpiryDate(name) {
  const days = estimateShelfLifeDays(name);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return formatDateISO(d);
}

// --------------------------- Preise (Einkaufsliste / Kosten-Tracker) ---------------------------

/** Formatiert einen Preis mit Komma und zwei Nachkommastellen, z. B. "3,50". */
export function formatPrice(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
    return Number(value).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --------------------------- Einheiten (Vorrat / Einkaufsliste) ---------------------------

/** Gängige Mengeneinheiten für Vorrat & Einkaufsliste (Auswahl deckt die häufigsten Fälle ab). */
export const UNIT_OPTIONS = [
    "Stück", "g", "kg", "ml", "l", "Packung", "Bund", "Dose", "Glas", "Flasche", "EL", "TL", "Prise", "Portion",
  ];

/**
 * Baut <option>-Markup für eine Einheiten-Auswahl. Ein bereits gesetzter Wert,
  * der nicht in UNIT_OPTIONS steckt (z. B. Altdaten), wird mit aufgenommen,
   * damit beim Speichern nichts verloren geht.
    */
export function unitOptionsHtml(selected) {
    const options =
          !selected || UNIT_OPTIONS.includes(selected) ? UNIT_OPTIONS : [selected, ...UNIT_OPTIONS];
    return options
      .map((u) => `<option value="${escapeHtml(u)}"${u === selected ? " selected" : ""}>${escapeHtml(u)}</option>`)
      .join("");
}

// --------------------------- Zutaten-Kategorien (Einkaufsliste) ---------------------------

// Stichwort-basierte, bewusst grobe Zuordnung (keine Lebensmitteldatenbank
// vorhanden). Reihenfolge der Kategorien ist relevant: Es gewinnt die erste
// Kategorie, deren Stichwort im (kleingeschriebenen) Zutatnamen vorkommt.
// Kurze, kollisionsanfällige Stichwörter (z. B. bloßes "ei") werden bewusst
// vermieden, damit z. B. "Fleisch" nicht fälschlich bei Milchprodukten landet.
const CATEGORY_RULES = [
  {
    key: "meat",
    label: "Fleisch & Fisch",
    icon: "🥩",
    keywords: [
      "hähnchen", "huhn", "pute", "rind", "schwein", "hack", "wurst", "speck",
      "bacon", "lachs", "fisch", "garnele", "shrimp", "thunfisch", "salami",
      "schinken", "geflügel", "lamm", "ente", "leberkäse",
    ],
  },
  {
    key: "dairy",
    label: "Milchprodukte & Eier",
    icon: "🥛",
    keywords: [
      "milch", "käse", "joghurt", "quark", "sahne", "butter", "frischkäse",
      "mozzarella", "parmesan", "feta", "eier", "hühnerei", "buttermilch",
      "kefir", "schmand", "creme fraiche", "crème fraîche", "ricotta",
    ],
  },
  {
    key: "produce",
    label: "Obst & Gemüse",
    icon: "🥬",
    keywords: [
      "apfel", "banane", "tomate", "salat", "gurke", "zwiebel", "knoblauch",
      "kartoffel", "karotte", "möhre", "paprika", "zucchini", "pilz",
      "champignon", "spinat", "brokkoli", "rucola", "zitrone", "limette",
      "avocado", "ingwer", "chili", "kohl", "lauch", "sellerie", "radieschen",
      "obst", "gemüse", "beere", "birne", "orange", "mango", "ananas",
      "trauben", "kürbis", "mais", "erbsen", "aubergine", "kräuter",
      "petersilie", "basilikum", "koriander", "schnittlauch", "minze", "dill",
    ],
  },
  {
    key: "bakery",
    label: "Backwaren",
    icon: "🍞",
    keywords: ["brot", "brötchen", "baguette", "toast", "tortilla", "wrap", "pita", "croissant"],
  },
  {
    key: "frozen",
    label: "Tiefkühl",
    icon: "🧊",
    keywords: ["tiefkühl", "tiefgefroren", "tk-", "pommes", "eis"],
  },
  {
    key: "beverages",
    label: "Getränke",
    icon: "🥤",
    keywords: ["wasser", "saft", "cola", "limonade", "bier", "wein", "kaffee", "tee"],
  },
  {
    key: "spices",
    label: "Gewürze & Saucen",
    icon: "🧂",
    keywords: [
      "pfeffer", "curry", "paprikapulver", "oregano", "thymian", "rosmarin",
      "zimt", "vanille", "senf", "ketchup", "mayonnaise", "sojasauce", "salz",
      "gewürz", "essig",
    ],
  },
  {
    key: "pantry",
    label: "Trockenwaren & Vorrat",
    icon: "🥫",
    keywords: [
      "reis", "nudel", "pasta", "spaghetti", "linsen", "bohnen", "kichererbsen",
      "konserve", "dose", "brühe", "mehl", "haferflocken", "müsli", "honig",
      "marmelade", "zucker", "öl", "nüsse", "mandel",
    ],
  },
];

const OTHER_CATEGORY = { key: "other", label: "Sonstiges", icon: "🛒" };

/** Anzeigereihenfolge der Kategorien (inkl. "Sonstiges" als letzte Gruppe). */
export const CATEGORY_ORDER = [...CATEGORY_RULES.map((c) => c.key), OTHER_CATEGORY.key];

/** Anzeigeinfos (Label + Icon) je Kategorie-Schlüssel, für Dropdowns/Badges im Vorrat. */
export const CATEGORY_INFO = Object.fromEntries([
...CATEGORY_RULES.map((c) => [c.key, { label: c.label, icon: c.icon }]),
[OTHER_CATEGORY.key, { label: OTHER_CATEGORY.label, icon: OTHER_CATEGORY.icon }],
]);

/** Baut <option>-Markup für eine Lebensmittelart-Auswahl (nutzt dieselben Kategorien wie die Einkaufsliste). */
export function categoryOptionsHtml(selected) {
return CATEGORY_ORDER.map((key) => {
const info = CATEGORY_INFO[key];
return `<option value="${key}"${key === selected ? " selected" : ""}>${info.icon} ${escapeHtml(info.label)}</option>`;
}).join("");
}

// --------------------------- Lagerort (Vorrat) ---------------------------

/** Moegliche Lagerorte fuer Vorrats-Posten, fuer Dropdowns/Badges. */
export const STORAGE_LOCATIONS = [
{ key: "kuehlschrank", label: "Kühlschrank", icon: "❄️" },
{ key: "gefrierschrank", label: "Gefrierschrank", icon: "🧊" },
{ key: "vorrat", label: "Vorratsschrank", icon: "🗄️" },
];

/** Baut <option>-Markup für eine Lagerort-Auswahl. */
export function storageLocationOptionsHtml(selected) {
return STORAGE_LOCATIONS.map(
(s) => `<option value="${s.key}"${s.key === selected ? " selected" : ""}>${s.icon} ${escapeHtml(s.label)}</option>`
).join("");
}

const STORAGE_OVERRIDES = [
{ location: "kuehlschrank", keywords: ["salat", "spinat", "rucola", "kräuter", "petersilie", "basilikum", "koriander", "schnittlauch", "minze", "dill", "pilz", "champignon", "beere", "erdbeere", "himbeere"] },
{ location: "vorrat", keywords: ["zwiebel", "knoblauch", "kartoffel", "kürbis"] },
];

const STORAGE_BY_CATEGORY = {
meat: "kuehlschrank",
dairy: "kuehlschrank",
produce: "kuehlschrank",
bakery: "vorrat",
frozen: "gefrierschrank",
beverages: "vorrat",
spices: "vorrat",
pantry: "vorrat",
other: "vorrat",
};

/** Grobe Schätzung des Lagerorts (Kühlschrank/Gefrierschrank/Vorratsschrank) für einen Lebensmittelnamen. */
export function estimateStorageLocation(name) {
const n = (name || "").toLowerCase();
const override = STORAGE_OVERRIDES.find((o) => o.keywords.some((kw) => n.includes(kw)));
if (override) return override.location;
const cat = categorizeIngredient(name);
return STORAGE_BY_CATEGORY[cat.key] ?? "vorrat";
}

/** Ordnet einen Zutatnamen per Stichwortsuche einer Einkaufslisten-Kategorie zu. */
export function categorizeIngredient(name) {
  const n = (name || "").toLowerCase();
  for (const cat of CATEGORY_RULES) {
    if (cat.keywords.some((kw) => n.includes(kw))) {
      return { key: cat.key, label: cat.label, icon: cat.icon };
    }
  }
  return OTHER_CATEGORY;
}
