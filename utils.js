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
    .replaceAll("'", "&#39;");
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
