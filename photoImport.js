import { navigate } from "./router.js";

const DRAFT_KEY = "cookcook-photo-draft";
const MAX_IMAGES = 5;

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
      Ein oder mehrere Fotos hochladen (z. B. mehrere Seiten desselben Rezepts) –
      Titel, Zutaten und Zubereitungsschritte werden automatisch erkannt. Im nächsten
      Schritt kannst du alles noch im gewohnten Formular prüfen und anpassen.
    </p>

    <div class="card stack-md">
      <label class="field">
        <span>Fotos auswählen (bis zu ${MAX_IMAGES})</span>
        <input type="file" id="photo-input" accept="image/*" capture="environment" multiple />
      </label>
      <div id="photo-thumbs" class="photo-thumbs"></div>
      <button type="button" id="analyze-btn" class="btn btn-primary" disabled>Rezept erkennen</button>
      <p id="photo-error" class="form-error" hidden></p>
      <p id="photo-status" class="text-muted" hidden></p>
    </div>
  `;

  const input = container.querySelector("#photo-input");
  const thumbsWrap = container.querySelector("#photo-thumbs");
  const analyzeBtn = container.querySelector("#analyze-btn");
  const errorEl = container.querySelector("#photo-error");
  const statusEl = container.querySelector("#photo-status");

  let selectedFiles = [];

  function renderThumbs() {
    thumbsWrap.innerHTML = selectedFiles
      .map(
        (file, i) => `
        <div class="photo-thumb" data-index="${i}">
          <img src="${URL.createObjectURL(file)}" alt="" />
          <button type="button" class="photo-thumb-remove" data-remove-photo="${i}" aria-label="Foto entfernen">×</button>
        </div>
      `
      )
      .join("");
    analyzeBtn.disabled = selectedFiles.length === 0;
  }

  input.addEventListener("change", () => {
    errorEl.hidden = true;
    const newFiles = Array.from(input.files || []);
    for (const file of newFiles) {
      if (selectedFiles.length >= MAX_IMAGES) break;
      selectedFiles.push(file);
    }
    input.value = "";
    renderThumbs();
  });

  thumbsWrap.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-photo]");
    if (!btn) return;
    selectedFiles.splice(Number(btn.dataset.removePhoto), 1);
    renderThumbs();
  });

  analyzeBtn.addEventListener("click", async () => {
    if (selectedFiles.length === 0) return;
    errorEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent =
      selectedFiles.length > 1
        ? "Fotos werden analysiert – das kann einen Moment dauern…"
        : "Foto wird analysiert – das kann einen Moment dauern…";
    analyzeBtn.disabled = true;
    input.disabled = true;

    try {
      const images = await Promise.all(selectedFiles.map((file) => fileToResizedBase64(file)));
      const res = await fetch("/api/extract-recipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          "Der Server hat keine gültige Antwort geliefert (evtl. Zeitüberschreitung bei großen oder vielen Fotos). Bitte mit weniger oder kleineren Fotos erneut versuchen."
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
