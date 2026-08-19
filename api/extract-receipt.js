// ============================================================================
// Vercel Serverless Function: liest ein oder mehrere Fotos eines Kassenbons
// (z. B. Supermarkt-Kassenzettel) und extrahiert die gekauften Produkte samt
// tatsaechlich bezahlter Preise per Anthropic API (Claude, Bildverstaendnis).
//
// Benoetigt die Umgebungsvariable ANTHROPIC_API_KEY (siehe DEPLOYMENT.md).
// ============================================================================

export const config = {
    maxDuration: 60,
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `Du bist ein Assistent, der Fotos von Kassenbons (Kassenzetteln) deutscher Supermaerkte liest und die gekauften Produkte mit tatsaechlich bezahlten Preisen extrahiert. Manchmal bekommst du mehrere Fotos, die zusammen einen einzigen (langen) Kassenbon zeigen - kombiniere sie dann zu einer gemeinsamen Liste.

Antworte AUSSCHLIESSLICH mit einem einzelnen validen JSON-Objekt, ohne Markdown-Codeblock, ohne Erklaertext davor oder danach. Halte dich exakt an dieses Schema:

{ "items": [ { "name": string, "price": number } ] }

Regeln:
- "name": lesbarer, normaler Produktname (Kassenbons nutzen oft Abkuerzungen/Grossschreibung, z. B. "H-MILCH 3,5%" -> "Milch", "BIO EIER 10ST" -> "Eier"). Uebersetze Abkuerzungen sinnvoll ins Alltagsdeutsch.
- "price": der tatsaechlich fuer diese Position bezahlte Gesamtpreis in Euro (nach Rabatt, falls auf dem Bon ersichtlich), nicht der Einzelpreis pro Stueck.
- Wenn eine Position mehrfach gekauft wurde (z. B. "2 x Apfel 0,75"), fasse sie zu EINER Zeile mit dem Gesamtpreis fuer diese Position zusammen.
- Ignoriere Zeilen, die keine Produkte sind: Pfand-Gesamtsummen, Zwischensumme, Gesamtsumme, MwSt-Angaben, Kartenzahlungsdetails, Bonuspunkte, Rabattaktionen als eigene Zeile, Kassiererinfo, Filialadresse.
- Wenn der Bon unleserlich ist oder es sich erkennbar nicht um einen Kassenbon handelt, gib { "items": [] } zurueck statt zu raten oder zu erfinden.`;

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
    if (images.length > 3) {
          res.status(400).json({ error: "Bitte maximal 3 Fotos auf einmal hochladen." });
          return;
    }

  const imageBlocks = images.map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }));

  const instructionText =
        images.length > 1
        ? "Diese Fotos zeigen zusammen einen einzigen (langen) Kassenbon. Kombiniere alle Positionen aus den Fotos zu einer gemeinsamen Liste als JSON gemaess dem vorgegebenen Schema."
          : "Extrahiere die Produkte und Preise von diesem Kassenbon-Foto als JSON gemaess dem vorgegebenen Schema.";

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
                          max_tokens: 2048,
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

      const items = Array.isArray(parsed.items)
          ? parsed.items
                  .map((it) => ({
                                name: String(it.name || "").trim(),
                                price: Number(it.price),
                  }))
                  .filter((it) => it.name && Number.isFinite(it.price) && it.price >= 0)
                  .map((it) => ({ ...it, price: Math.round(it.price * 100) / 100 }))
              : [];

      res.status(200).json({ items });
  } catch (err) {
        res.status(500).json({ error: "Unerwarteter Fehler: " + (err && err.message ? err.message : String(err)) });
  }
}
