import { navigate } from "./router.js";

const DRAFT_KEY = "cookcook-photo-draft";

/**
 * Verkleinert ein Bild clientseitig (max. Kantenlänge + JPEG-Kompression),
 * bevor es an die Serverless Function geschickt wird. Hält die Anfrage klein
 * und schnell, unabhängig davon wie groß das Originalfoto vom Handy ist.
 */
async function fileToResizedBase64(file, maxDim = 1600, quality = 0.85) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

  return { base64: btoa(binary), mediaType: "image/jpeg" };
}

export async function renderPhotoImport(container) {
  container.innerHTML = `
    <a href="#/" class="back-link">← Zurück</a>
    <h1>Rezept per Foto erfassen</h1>
    <p class="text-muted">
      Foto von einer Kochbuchseite, Zeitschrift oder einem handschriftlichen Rezept hochladen –
      Titel, Zutaten und Zubereitungsschritte werden automatisch erkannt. Im nächsten Schritt
      kannst du alles noch im gewohnten Formular prüfen und anpassen.
    </p>

    <div class="card stack-md">
      <label class="field">
        <span>Foto auswählen</span>
        <input type="file" id="photo-input" accept="image/*" capture="environment" />
      </label>
      <div id="photo-preview-wrap" class="image-preview-wrap" hidden>
        <img id="photo-preview" class="image-preview" alt="" />
      </div>
      <button type="button" id="analyze-btn" class="btn btn-primary" disabled>Rezept erkennen</button>
      <p id="photo-error" class="form-error" hidden></p>
      <p id="photo-status" class="text-muted" hidden></p>
    </div>
  `;

  const input = container.querySelector("#photo-input");
  const previewWrap = container.querySelector("#photo-preview-wrap");
  const preview = container.querySelector("#photo-preview");
  const analyzeBtn = container.querySelector("#analyze-btn");
  const errorEl = container.querySelector("#photo-error");
  const statusEl = container.querySelector("#photo-status");

  let selectedFile = null;

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    errorEl.hidden = true;
    if (!file) {
      selectedFile = null;
      analyzeBtn.disabled = true;
      previewWrap.hidden = true;
      return;
    }
    selectedFile = file;
    preview.src = URL.createObjectURL(file);
    previewWrap.hidden = false;
    analyzeBtn.disabled = false;
  });

  analyzeBtn.addEventListener("click", async () => {
    if (!selectedFile) return;
    errorEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent = "Foto wird analysiert – das kann einen Moment dauern…";
    analyzeBtn.disabled = true;
    input.disabled = true;

    try {
      const { base64, mediaType } = await fileToResizedBase64(selectedFile);
      const res = await fetch("/api/extract-recipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      const data = await res.json();
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

/** Liest einen evtl. hinterlegten Foto-Entwurf einmalig aus (und löscht ihn danach). */
export function consumePhotoDraft() {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(DRAFT_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
