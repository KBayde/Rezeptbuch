import { getSetting, setSetting } from "./db.js";
import { escapeHtml } from "./utils.js";

export async function renderSettings(container) {
  container.innerHTML = `<p class="text-muted">Lade Einstellungen…</p>`;

  let dailyCalorieTarget = null;
  let weekStartDay = 1;
  try {
    dailyCalorieTarget = await getSetting("daily_calorie_target");
    const rawWeekStartDay = await getSetting("week_start_day");
    weekStartDay = rawWeekStartDay !== null && rawWeekStartDay !== undefined && rawWeekStartDay !== "" ? Number(rawWeekStartDay) : 1;
  } catch (err) {
    container.innerHTML = `<p class="form-error">Einstellungen konnten nicht geladen werden: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const weekdayOptions = [
    { value: 1, label: "Montag" },
    { value: 2, label: "Dienstag" },
    { value: 3, label: "Mittwoch" },
    { value: 4, label: "Donnerstag" },
    { value: 5, label: "Freitag" },
    { value: 6, label: "Samstag" },
    { value: 0, label: "Sonntag" },
  ];
  const weekdayOptionsHtml = weekdayOptions
    .map((o) => `<option value="${o.value}"${o.value === weekStartDay ? " selected" : ""}>${o.label}</option>`)
    .join("");

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Einstellungen</h1>
        <p class="text-muted">Gemeinsame Ziele für den Haushalt.</p>
      </div>
    </div>

    <section class="card stack-md">
      <h2>Kalorien</h2>
      <label class="field">
        <span>Tages-Kalorienziel (optional, gemeinsam für den Haushalt)</span>
        <input type="number" id="daily-calorie-target-input" min="0" step="10"
          placeholder="z. B. 2000" value="${dailyCalorieTarget ?? ""}" />
      </label>
      <p class="text-muted text-small">
        Im Wochenplan wird pro Tag die Summe der geplanten Kalorien angezeigt. Bei Überschreitung dieses Ziels gibt es einen Warnhinweis.
      </p>

      <label class="field">
        <span>Wochenstart-Tag</span>
        <select id="week-start-day-input">${weekdayOptionsHtml}</select>
      </label>
      <p class="text-muted text-small">
        Bestimmt, an welchem Wochentag der Wochenplan und die daraus erzeugte Einkaufsliste beginnen (z. B. praktisch, wenn ihr immer donnerstags einkaufen geht). Der Kosten-Tracker rechnet weiterhin in normalen Kalenderwochen.
      </p>

      <div class="form-actions">
        <button type="button" id="save-settings-btn" class="btn btn-primary">Speichern</button>
        <span id="save-settings-status" class="text-small text-muted"></span>
      </div>
    </section>
  `;

  const input = container.querySelector("#daily-calorie-target-input");
  const weekStartDayInput = container.querySelector("#week-start-day-input");
  const saveBtn = container.querySelector("#save-settings-btn");
  const status = container.querySelector("#save-settings-status");

  saveBtn.addEventListener("click", async () => {
    const raw = input.value.trim();
    const value = raw === "" ? null : Number(raw);
    saveBtn.disabled = true;
    status.textContent = "Speichere…";
    try {
      await setSetting("daily_calorie_target", value);
      await setSetting("week_start_day", Number(weekStartDayInput.value));
      status.textContent = "Gespeichert.";
      setTimeout(() => {
        status.textContent = "";
      }, 2000);
    } catch (err) {
      status.textContent = "Fehler: " + err.message;
    } finally {
      saveBtn.disabled = false;
    }
  });
}
