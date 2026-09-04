// ============================================================================
// Vercel Serverless Function: nimmt ein Rezept-PDF entgegen und laesst daraus
// per Anthropic API (Claude, natives PDF-Verstehen) ein strukturiertes Rezept
// extrahieren. Analog zu extract-recipe-link.js / extract-recipe.js, aber mit
// einem "document"-Content-Block statt Linktext bzw. Bild.
//
// Benoetigt die Umgebungsvariable ANTHROPIC_API_KEY (wie bei den anderen
// Import-Wegen). Aus Vercel-Plattformgruenden ist der Request-Body von
// Serverless Functions auf ca. 4.5 MB begrenzt - das Frontend (pdfImport.js)
// blockt daher schon vorher PDFs > ca. 3 MB Rohgroesse ab (Base64 blaeht die
// Datei um ca. 1/3 auf).
// ============================================================================

export const config = {
  maxDuration: 60,
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `Du bist ein Assistent, der Kochrezepte aus PDF-Dokumenten in strukturierte Daten umwandelt. Das PDF kann eine eingescannte Rezeptseite, eine exportierte Kochbuch-Seite oder ein digital erstelltes Rezept-Dokument sein.

Antworte AUSSCHLIESSLICH mit einem einzelnen validen JSON-Objekt, ohne Markdown-Codeblock, ohne Erklaertext davor oder danach. Halte dich exakt an dieses Schema:

{
  "title": string,
  "sourceType": "pdf",
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
- "title": praegnanter Rezeptname.
- "sourceType": immer "pdf".
- "sourceText": kurze Quellenangabe, falls im PDF erkennbar (z. B. Kochbuchtitel, Autor), sonst leerer String.
- "prepTimeMinutes": Gesamtzeit in Minuten falls angegeben, sonst null.
- "servingsBase": Portionenanzahl als Zahl, falls nicht erkennbar schaetze plausibel (z. B. 4).
- "unitAbbreviation": gaengige deutsche Kochabkuerzungen (g, kg, ml, l, TL, EL, Stk, Prise, Bund, Dose, Paeckchen ...), leerer String wenn keine Einheit.
- "quantity": nur die Zahl, keine Einheit im Feld.
- "steps": jeder Zubereitungsschritt als eigenes Objekt, in der richtigen Reihenfolge.
- "tags": 1 bis 4 kurze Kategorie-Schlagwoerter (z. B. Kueche, Gericht-Art), leeres Array wenn nichts Sinnvolles erkennbar.
- "notes": falls das PDF handschriftlich, schlecht lesbar oder offensichtlich unvollstaendig ist, trage hier einen kurzen Hinweis ein wie "Automatisch aus PDF erkannt - bitte Zutaten/Mengen pruefen." Ansonsten leerer String oder sonstige Zubereitungshinweise aus dem Dokument.
- Wenn ein Feld nicht erkennbar ist, verwende einen sinnvollen leeren Wert (leerer String, null oder leeres Array) statt zu raten oder zu erfinden. Erfinde keine Zutaten oder Schritte, die nicht im Dokument stehen bzw. sich nicht plausibel daraus ableiten lassen. Enthaelt das PDF mehrere Rezepte, waehle das erste/hauptsaechliche Rezept.`;

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

  const pdfBase64 = (req.body || {}).pdfBase64;
  if (!pdfBase64 || typeof pdfBase64 !== "string") {
    res.status(400).json({ error: "Bitte eine PDF-Datei auswaehlen." });
    return;
  }

  // Grobe Plausibilitaetspruefung der Groesse (Base64-String-Laenge * 0.75 ~ Rohgroesse).
  const approxBytes = Math.floor((pdfBase64.length * 3) / 4);
  if (approxBytes > 4 * 1024 * 1024) {
    res.status(413).json({
      error: "Die PDF ist zu groß fuer die Verarbeitung. Bitte eine kleinere Datei verwenden (max. ca. 3 MB).",
    });
    return;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": "pdfs-2024-09-25",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64,
                },
              },
              {
                type: "text",
                text: "Extrahiere das Rezept aus diesem PDF-Dokument gemaess dem vorgegebenen JSON-Schema.",
              },
            ],
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
