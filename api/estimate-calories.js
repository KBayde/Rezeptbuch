// ============================================================================
// Vercel Serverless Function: schaetzt die Kalorien pro Portion eines Rezepts
// anhand von Titel, Portionenzahl und Zutatenliste per Anthropic API - Basis
// fuer das Tages-Kalorienziel im Wochenplan. Nutzer kann den geschaetzten
// Wert im Formular jederzeit ueberschreiben.
//
// Benoetigt die Umgebungsvariable ANTHROPIC_API_KEY (bereits konfiguriert,
// siehe DEPLOYMENT.md - wird schon von api/estimate-price.js genutzt).
// ============================================================================

export const config = {
  maxDuration: 20,
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `Du bist ein Ernaehrungsassistent, der fuer Rezepte eine realistische, ungefaehre Kalorienangabe PRO PORTION schaetzt.

Antworte AUSSCHLIESSLICH mit einem einzelnen validen JSON-Objekt, ohne Markdown-Codeblock, ohne Erklaertext davor oder danach. Halte dich exakt an dieses Schema:

{ "calories": number }

Regeln:
- "calories": geschaetzte Kalorien (kcal) fuer EINE Portion des Rezepts, nicht fuer das gesamte Rezept.
- Teile die Gesamtkalorien aller Zutaten durch die angegebene Portionenzahl.
- Runde auf eine ganze Zahl.
- Schaetze realistisch anhand ueblicher Naehrwerte der angegebenen Zutaten und Mengen.
- Wenn Mengenangaben fehlen oder unklar sind, nimm plausible uebliche Mengen an statt 0 zurueckzugeben.
- Wenn du dir unsicher bist, gib trotzdem deine beste plausible Schaetzung ab.`;

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
  const title = (body.title || "").trim();
  const servingsBase = Number(body.servingsBase) || 1;
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];

  if (ingredients.length === 0) {
    res.status(400).json({ error: "Mindestens eine Zutat ist erforderlich." });
    return;
  }

  const ingredientLines = ingredients
    .map((ing) => {
      const parts = [];
      if (ing.quantity !== null && ing.quantity !== undefined && ing.quantity !== "") parts.push(String(ing.quantity));
      if (ing.unit) parts.push(ing.unit);
      parts.push(ing.name);
      let line = "- " + parts.join(" ");
      if (ing.note) line += ` (${ing.note})`;
      return line;
    })
    .join("\n");

  const promptText = `Rezept: ${title || "(ohne Titel)"}\nPortionen (gesamt): ${servingsBase}\n\nZutaten (fuer alle ${servingsBase} Portionen zusammen):\n${ingredientLines}\n\nSchaetze die Kalorien PRO PORTION als JSON gemaess dem vorgegebenen Schema.`;

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
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: promptText }],
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

    const calories = Number(parsed.calories);
    if (!Number.isFinite(calories) || calories < 0) {
      res.status(502).json({ error: "Ungueltige Kalorienangabe in der Antwort.", raw: rawText });
      return;
    }

    res.status(200).json({ calories: Math.round(calories) });
  } catch (err) {
    res.status(500).json({ error: "Unerwarteter Fehler: " + (err && err.message ? err.message : String(err)) });
  }
}
