// ============================================================================
// Vercel Serverless Function: nimmt ein oder mehrere Rezept-Fotos entgegen
// (Kochbuchseite, Zeitschrift, handschriftliche Notiz, mehrere Seiten, ...)
// und lässt sie von der Anthropic API (Claude, mit Bildverständnis) in
// strukturierte Rezept-Felder umwandeln.
//
// Benötigt die Umgebungsvariable ANTHROPIC_API_KEY in den Vercel-Projekt-
// einstellungen (Settings -> Environment Variables). Ohne diesen Key liefert
// die Funktion einen klaren Fehlertext statt eines kryptischen 500ers.
// ============================================================================

// Bildverständnis kann bei mehreren/großen Fotos länger als die Vercel-
// Standardzeit von 10s dauern. Erlaubt der Funktion bis zu 60s Laufzeit.
export const config = {
  maxDuration: 60,
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `Du bist ein Assistent, der Kochrezepte aus Fotos (z. B. Kochbuchseiten, Zeitschriften, handschriftliche Notizen) in strukturierte Daten umwandelt. Manchmal bekommst du mehrere Fotos, die zusammen ein einziges Rezept zeigen (z. B. mehrere Buchseiten oder Ausschnitte) – kombiniere sie dann zu einem gemeinsamen Ergebnis.

Antworte AUSSCHLIESSLICH mit einem einzelnen validen JSON-Objekt, ohne Markdown-Codeblock, ohne Erklärtext davor oder danach. Halte dich exakt an dieses Schema:

{
  "title": string,
  "sourceType": "book" | "magazine" | "family" | "other",
  "sourceText": string,
  "prepTimeMinutes": number | null,
  "servingsBase": number,
  "notes": string,
  "ingredients": [
    { "ingredientName": string, "quantity": number | null, "unitAbbreviation": string, "note": string }
  ],
  "steps": [
    { "instruction": string }
  ],
  "tags": [string]
}

Regeln:
- "title": prägnanter Rezeptname, wie im Bild erkennbar.
- "sourceType": schätze anhand des Bild-Layouts (Kochbuchseite -> "book", Zeitschrift/Magazin -> "magazine", handschriftlich/Familienrezept -> "family", sonst -> "other").
- "sourceText": kurze Quellenangabe falls erkennbar (z. B. Buchtitel, Seitenzahl), sonst leerer String.
- "prepTimeMinutes": Zubereitungszeit in Minuten falls angegeben, sonst null.
- "servingsBase": Portionenanzahl als Zahl, falls nicht erkennbar schätze plausibel (z. B. 4).
- "unitAbbreviation": gängige deutsche Kochabkürzungen (g, kg, ml, l, TL, EL, Stk, Prise, Bund, Dose, Päckchen ...), leerer String wenn keine Einheit.
- "quantity": nur die Zahl, keine Einheit im Feld.
- "steps": jeder Zubereitungsschritt als eigenes Objekt, in der richtigen Reihenfolge.
- "tags": 1 bis 4 kurze Kategorie-Schlagwörter (z. B. Küche, Gericht-Art), leeres Array wenn nichts Sinnvolles erkennbar.
- Wenn ein Feld im Bild nicht erkennbar ist, verwende einen sinnvollen leeren Wert (leerer String, null oder leeres Array) statt zu raten oder zu erfinden.
- Erfinde keine Zutaten oder Schritte, die nicht im Bild stehen.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "ANTHROPIC_API_KEY ist nicht konfiguriert. Bitte in den Vercel-Projekteinstellungen unter Settings -> Environment Variables hinterlegen und neu deployen.",
    });
    return;
  }

  const body = req.body || {};
  let images = Array.isArray(body.images) ? body.images : null;
  if (!images && body.imageBase64 && body.mediaType) {
    images = [{ base64: body.imageBase64, mediaType: body.mediaType }];
  }
  images = (images || []).filter((img) => img && img.base64 && img.mediaType);

  if (images.length === 0) {
    res.status(400).json({ error: "Mindestens ein Foto ist erforderlich." });
    return;
  }
  if (images.length > 5) {
    res.status(400).json({ error: "Bitte maximal 5 Fotos auf einmal hochladen." });
    return;
  }

  const imageBlocks = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }));

  const instructionText =
    images.length > 1
      ? "Diese Fotos zeigen zusammen ein einzelnes Rezept (z. B. mehrere Seiten oder Ausschnitte). Kombiniere alle Informationen aus den Fotos zu einem einzigen Rezept-JSON gemäß dem vorgegebenen Schema."
      : "Extrahiere das Rezept aus diesem Foto als JSON gemäß dem vorgegebenen Schema.";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [...imageBlocks, { type: "text", text: instructionText }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({ error: "Anthropic API Fehler: " + errText });
      return;
    }

    const data = await response.json();
    const rawText = (data.content || []).map((c) => c.text || "").join("").trim();

    let parsed;
    try {
      const cleaned = rawText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      res.status(502).json({ error: "Antwort konnte nicht als JSON gelesen werden.", raw: rawText });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: "Unerwarteter Fehler: " + (err && err.message ? err.message : String(err)) });
  }
}
