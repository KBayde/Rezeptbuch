// ============================================================================
// Vercel Serverless Function: schaetzt fuer eine Zutat (Name, optional Menge
// und Einheit) einen ungefaehren Supermarktpreis in Euro per Anthropic API,
// als Fallback fuer die Einkaufsliste wenn noch keine eigene Preishistorie
// fuer diese Zutat existiert (siehe getAveragePrice in db.js).
//
// Benoetigt die Umgebungsvariable ANTHROPIC_API_KEY (siehe DEPLOYMENT.md).
// ============================================================================

export const config = {
    maxDuration: 20,
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `Du bist ein Assistent, der fuer Lebensmittel und Haushaltsartikel realistische, ungefaehre Preise in deutschen Supermaerkten (Euro, Stand heute) schaetzt.

Antworte AUSSCHLIESSLICH mit einem einzelnen validen JSON-Objekt, ohne Markdown-Codeblock, ohne Erklaertext davor oder danach. Halte dich exakt an dieses Schema:

{ "price": number }

Regeln:
- "price": geschaetzter Preis in Euro fuer die angegebene Menge (falls angegeben), sonst fuer eine uebliche Einkaufsmenge/Packungsgroesse dieser Zutat im Supermarkt.
- Runde auf 2 Nachkommastellen.
- Schaetze realistisch anhand aktueller deutscher Supermarktpreise (Rewe, Edeka, Aldi, Lidl als Referenz), nicht Bio- oder Feinkostpreise, ausser der Name deutet explizit darauf hin.
- Wenn du dir unsicher bist, gib trotzdem deine beste plausible Schaetzung ab statt 0 oder null zurueckzugeben.`;

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
    const ingredientName = (body.ingredientName || "").trim();
    const quantity = body.quantity;
    const unit = (body.unit || "").trim();

  if (!ingredientName) {
        res.status(400).json({ error: "ingredientName ist erforderlich." });
        return;
  }

  let promptText = `Zutat: ${ingredientName}`;
    if (quantity !== null && quantity !== undefined && quantity !== "") {
          promptText += `\nMenge: ${quantity}${unit ? " " + unit : ""}`;
    }
    promptText += "\n\nSchaetze den Preis in Euro als JSON gemaess dem vorgegebenen Schema.";

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

      const price = Number(parsed.price);
        if (!Number.isFinite(price) || price < 0) {
                res.status(502).json({ error: "Ungueltiger Preis in der Antwort.", raw: rawText });
                return;
        }

      res.status(200).json({ price: Math.round(price * 100) / 100 });
  } catch (err) {
        res.status(500).json({ error: "Unerwarteter Fehler: " + (err && err.message ? err.message : String(err)) });
  }
}
