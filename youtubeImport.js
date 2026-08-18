import { navigate } from "./router.js";

const DRAFT_KEY = "cookcook-youtube-draft";

export async function renderYoutubeImport(container) {
  container.innerHTML = `
    <a href="#/" class="back-link">← Zurück</a>
    <h1>Rezept per YouTube-Link erfassen</h1>
    <p class="text-muted">
      Link zu einem Koch-Video einfügen – Titel, Zutaten und Zubereitungsschritte werden
      aus der Videobeschreibung automatisch erkannt (kein Transkript, nur der von der
      Kanal-Betreiberin geschriebene Beschreibungstext). Im nächsten Schritt kannst du
      alles noch im gewohnten Formular prüfen und anpassen.
    </p>

    <div class="card stack-md">
      <label class="field">
        <span>YouTube-Link</span>
        <input
          type="url" id="youtube-url-input" class="search-input"
          placeholder="https://www.youtube.com/watch?v=..." inputmode="url"
        />
      </label>
      <button type="button" id="youtube-analyze-btn" class="btn btn-primary" disabled>Rezept erkennen</button>
      <p id="youtube-error" class="form-error" hidden></p>
      <p id="youtube-status" class="text-muted" hidden></p>
    </div>
  `;

  const input = container.querySelector("#youtube-url-input");
  const analyzeBtn = container.querySelector("#youtube-analyze-btn");
  const errorEl = container.querySelector("#youtube-error");
  const statusEl = container.querySelector("#youtube-status");

  input.addEventListener("input", () => {
    errorEl.hidden = true;
    analyzeBtn.disabled = input.value.trim().length === 0;
  });

  analyzeBtn.addEventListener("click", async () => {
    const url = input.value.trim();
    if (!url) return;
    errorEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent = "Video wird gelesen und Rezept erkannt – das kann einen Moment dauern…";
    analyzeBtn.disabled = true;
    input.disabled = true;

    try {
      const res = await fetch("/api/extract-recipe-youtube", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          "Der Server hat keine gültige Antwort geliefert (evtl. Zeitüberschreitung). Bitte erneut versuchen."
        );
      }
      if (!res.ok) {
        throw new Error(data.error || "Rezept konnte nicht erkannt werden.");
      }
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      navigate("/rezepte/neu");
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      statusEl.hidden = true;
      analyzeBtn.disabled = false;
      input.disabled = false;
    }
  });
}

/** Liest einen evtl. hinterlegten YouTube-Entwurf einmalig aus (und löscht ihn danach). */
export function consumeYoutubeDraft() {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(DRAFT_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
