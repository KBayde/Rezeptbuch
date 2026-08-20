// ============================================================================
// Vercel Serverless Function: schlaegt anhand von Titel, Zutaten und Notizen
// eine plausible Zubereitungsanleitung vor - fuer Rezepte, bei denen (z. B.
// nach einem Foto-Scan eines handschriftlichen Rezepts) nur Zutaten/Mengen
// und ggf. Ofentemperatur/Backdauer vorliegen, aber keine Zubereitungsschritte.
//
// Benoetigt die Umgebungsvariable ANTHROPIC_API_KEY (bereits konfiguriert,
// siehe DEPLOYMENT.md - wird schon von api/estimate-price.js genutzt).
// ============================================================================

export const config = {
  maxDuration: 30,
  };

  const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const ANTHROPIC_VERSION = "2023-06-01";

  const SYSTEM_PROMPT = `Du bist ein erfahrener Koch und hilfst dabei, aus einer Zutatenliste eine plausible, gut nachvollziehbare Zubereitungsanleitung auf Deutsch zu entwerfen - zum Beispiel wenn bei einem handschriftlich eingescannten Rezept nur Zutaten, Mengen und ggf. Ofentemperatur/Backdauer vorliegen, aber keine Schritte.

  Antworte AUSSCHLIESSLICH mit einem einzelnen validen JSON-Objekt, ohne Markdown-Codeblock, ohne Erklaertext davor oder danach. Halte dich exakt an dieses Schema:

  { "steps": ["Schritt 1 Text", "Schritt 2 Text", ...] }

  Regeln:
  - Nutze ausschliesslich die angegebenen Zutaten, Mengen und Notizen als Grundlage - erfinde keine zusaetzlichen Hauptzutaten.
  - Schreibe klare, kurze, nummerierbare Einzelschritte (jeder Array-Eintrag = ein Schritt), praxisnah und in ueblicher Reihenfolge.
  - Wenn Ofentemperatur/Backdauer erkennbar ist (aus Notizen oder Zutaten), baue sie als eigenen Schritt mit ein.
  - Fehlen Details (z. B. exakte Garzeit), nimm einen plausiblen, ueblichen Wert an statt die Angabe wegzulassen - aber erfinde nichts, was nicht ableitbar ist.
  - 4 bis 12 Schritte, je nach Komplexitaet des Gerichts.
  - Dies ist ein Entwurf, den die Person vor dem Speichern noch prueft/anpasst - sei hilfreich und konkret, aber nicht uebertrieben ausfuehrlich.`;


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
                                                    const notes = (body.notes || "").trim();
                                                      const prepTimeMinutes = body.prepTimeMinutes;
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
                                                                                                                            
                                                                                                                              let promptText = `Rezept: ${title || "(ohne Titel)"}\n`;
                                                                                                                                if (prepTimeMinutes) promptText += `Zubereitungszeit: ca. ${prepTimeMinutes} Minuten\n`;
                                                                                                                                  promptText += `\nZutaten:\n${ingredientLines}\n`;
                                                                                                                                    if (notes) promptText += `\nNotizen: ${notes}\n`;
                                                                                                                                      promptText += "\nErstelle die Zubereitungsschritte als JSON gemaess dem vorgegebenen Schema.";
                                                                                                                                      
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
                                                                                                                                                                                                            max_tokens: 1024,
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
                                                                                                                                                                                                                                                                                                                
                                                                                                                                                                                                                                                                                                                    const steps = Array.isArray(parsed.steps)
                                                                                                                                                                                                                                                                                                                          ? parsed.steps.map((s) => String(s).trim()).filter(Boolean)
                                                                                                                                                                                                                                                                                                                                : [];
                                                                                                                                                                                                                                                                                                                                    if (steps.length === 0) {
                                                                                                                                                                                                                                                                                                                                          res.status(502).json({ error: "Keine Zubereitungsschritte in der Antwort gefunden.", raw: rawText });
                                                                                                                                                                                                                                                                                                                                                return;
                                                                                                                                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                                                                                                                                    
                                                                                                                                                                                                                                                                                                                                                        res.status(200).json({ steps });
                                                                                                                                                                                                                                                                                                                                                          } catch (err) {
                                                                                                                                                                                                                                                                                                                                                              res.status(500).json({ error: "Unerwarteter Fehler: " + (err && err.message ? err.message : String(err)) });
                                                                                                                                                                                                                                                                                                                                                                }
                                                                                                                                                                                                                                                                                                                                                                }
                                                                                                                                                                                                                                                                                                                                                                
