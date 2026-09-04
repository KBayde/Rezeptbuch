import { navigate } from "./router.js";

const DRAFT_KEY = "cookcook-pdf-draft";
const MAX_PDF_BYTES = 3 * 1024 * 1024; // ~3 MB Rohdatei (Vercel-Funktionen begrenzen den Request-Body auf ca. 4.5 MB, Base64 blaeht Dateien um ca. 1/3 auf)

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = String(result).split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("PDF konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

export async function renderPdfImport(container) {
  container.innerHTML = `
    <a href="#/" class="back-link">← Zurück</a>
    <h1>Rezept per PDF erfassen</h1>
    <p class="text-muted">
      PDF mit einem Rezept hochladen (z. B. exportierte Kochbuch-Seite oder gespeichertes
      Rezept-PDF) – Titel, Zutaten und Zubereitungsschritte werden automatisch erkannt. Im
      nächsten Schritt kannst du alles noch im gewohnten Formular prüfen und anpassen.
      Maximal ca. 3 MB Dateigröße.
    </p>

    <div class="card stack-md">
      <label class="field">
        <span>Rezept-PDF</span>
        <input type="file" id="pdf-file-input" accept="application/pdf" />
      </label>
      <button type="button" id="pdf-analyze-btn" class="btn btn-primary" disabled>Rezept erkennen</button>
      <p id="pdf-error" class="form-error" hidden></p>
      <p id="pdf-status" class="text-muted" hidden></p>
    </div>
  `;

  const fileInput = container.querySelector("#pdf-file-input");
  const analyzeBtn = container.querySelector("#pdf-analyze-btn");
  const errorEl = container.querySelector("#pdf-error");
  const statusEl = container.querySelector("#pdf-status");

  let selectedFile = null;

  fileInput.addEventListener("change", () => {
    errorEl.hidden = true;
    selectedFile = fileInput.files?.[0] || null;
    if (selectedFile && selectedFile.size > MAX_PDF_BYTES) {
      errorEl.textContent = `Diese PDF ist zu groß (${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB). Bitte eine PDF bis ca. 3 MB verwenden, oder das Rezept stattdessen per Foto erfassen.`;
      errorEl.hidden = false;
      selectedFile = null;
      analyzeBtn.disabled = true;
      return;
    }
    analyzeBtn.disabled = !selectedFile;
  });

  analyzeBtn.addEventListener("click", async () => {
    if (!selectedFile) return;
    errorEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent = "PDF wird gelesen und Rezept erkannt – das kann einen Moment dauern…";
    analyzeBtn.disabled = true;
    fileInput.disabled = true;

    try {
      const pdfBase64 = await fileToBase64(selectedFile);
      const res = await fetch("/api/extract-recipe-pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pdfBase64, filename: selectedFile.name }),
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
      fileInput.disabled = false;
    }
  });
}

/** Liest einen evtl. hinterlegten PDF-Entwurf einmalig aus (und löscht ihn danach). */
export function consumePdfDraft() {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(DRAFT_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
