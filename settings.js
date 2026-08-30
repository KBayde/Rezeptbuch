import { getSetting, setSetting } from "./db.js";
import { escapeHtml } from "./utils.js";

export async function renderSettings(container) {
  container.innerHTML = `<p class="text-muted">Lade Einstellungen…</p>`;

  let dailyCalorieTarget = null;
  try {
    dailyCalorieTarget = await getSetting("daily_calorie_target");
  } catch (err) {
    container.innerHTML = `<p class="form-error">Einstellungen konnten nicht geladen werden: ${escapeHtml(err.message)}</p>`;
    return;
  }

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
      <div class="form-actions">
        <button type="button" id="save-settings-btn" class="btn btn-primary">Speichern</button>
        <span id="save-settings-status" class="text-small text-muted"></span>
      </div>
    </section>
  `;

  const input = container.querySelector("#daily-calorie-target-input");
  const saveBtn = container.querySelector("#save-settings-btn");
  const status = container.querySelector("#save-settings-status");

  saveBtn.addEventListener("click", async () => {
    const raw = input.value.trim();
    const value = raw === "" ? null : Number(raw);
    saveBtn.disabled = true;
    status.textContent = "Speichere…";
    try {
      await setSetting("daily_calorie_target", value);
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
