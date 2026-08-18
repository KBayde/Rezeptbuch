// ============================================================================
// Vercel Serverless Function: nimmt einen beliebigen Rezept-Link (Blog,
// Kochseite, ...) entgegen und lässt daraus per Anthropic API (Claude) ein
// strukturiertes Rezept extrahieren.
//
// Die meisten Rezept-Webseiten betten ihre Daten zusätzlich maschinenlesbar
// als "JSON-LD" (schema.org/Recipe) in die Seite ein - genau dafür gedacht,
// dass z. B. Google-Suche oder Rezept-Apps sie automatisch auslesen können.
// Wo vorhanden, wird das bevorzugt genutzt (zuverlässiger als Rohtext).
// Andernfalls wird als Rückfallebene der sichtbare Seitentext (grob von
// HTML-Tags befreit) verwendet, ähnlich wie beim YouTube-Import.
//
// Benötigt die Umgebungsvariable ANTHROPIC_API_KEY (wie beim Foto-/
// YouTube-Import). Kein zusätzlicher API-Key nötig - normale Webseiten
// blockieren (anders als YouTube) in der Regel keine Server-Anfragen.
// ============================================================================

export const config = {
  maxDuration: 45,
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `Du bist ein Assistent, der Kochrezepte von Webseiten in strukturierte Daten umwandelt. Du bekommst entweder bereits strukturierte Rezeptdaten (aus dem JSON-LD einer Seite) oder rohen Seitentext samt Titel.

Antworte AUSSCHLIESSLICH mit einem einzelnen validen JSON-Objekt, ohne Markdown-Codeblock, ohne Erklärtext davor oder danach. Halte dich exakt an dieses Schema:

{
  "title": string,
  "sourceType": "link",
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
- "title": prägnanter Rezeptname.
- "sourceType": immer "link".
- "sourceText": Name der Webseite/des Blogs, falls erkennbar, sonst kurze Quellenangabe.
- "prepTimeMinutes": Gesamtzeit in Minuten falls angegeben, sonst null.
- "servingsBase": Portionenanzahl als Zahl, falls nicht erkennbar schätze plausibel (z. B. 4).
- "unitAbbreviation": gängige deutsche Kochabkürzungen (g, kg, ml, l, TL, EL, Stk, Prise, Bund, Dose, Päckchen ...), leerer String wenn keine Einheit. Wandle englische Einheiten sinngemäß um (cup -> ca. 240ml als Hinweis in "note", falls keine sinnvolle direkte Umrechnung möglich ist, Originaltext in "note" belassen).
- "quantity": nur die Zahl, keine Einheit im Feld.
- "steps": jeder Zubereitungsschritt als eigenes Objekt, in der richtigen Reihenfolge.
- "tags": 1 bis 4 kurze Kategorie-Schlagwörter (z. B. Küche, Gericht-Art), leeres Array wenn nichts Sinnvolles erkennbar.
- "notes": falls die Quelle offensichtlich unvollständig ist, trage hier einen kurzen Hinweis ein wie "Automatisch von Webseite erkannt - bitte Zutaten/Mengen prüfen." Ansonsten leerer String oder sonstige Zubereitungshinweise.
- Wenn ein Feld nicht erkennbar ist, verwende einen sinnvollen leeren Wert (leerer String, null oder leeres Array) statt zu raten oder zu erfinden. Erfinde keine Zutaten oder Schritte, die nicht in der Quelle stehen bzw. sich nicht plausibel daraus ableiten lassen.`;

function isoDurationToMinutes(iso) {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const total = hours * 60 + minutes;
  return total > 0 ? total : null;
}

function stripHtmlTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // manche Seiten liefern kaputtes/mehrfaches JSON in einem Block - überspringen
    }
  }
  return blocks;
}

function isRecipeType(typeField) {
  if (!typeField) return false;
  if (Array.isArray(typeField)) return typeField.some((t) => String(t).toLowerCase() === "recipe");
  return String(typeField).toLowerCase() === "recipe";
}

function findRecipeNode(node, depth = 0) {
  if (!node || depth > 4) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    if (isRecipeType(node["@type"])) return node;
    if (node["@graph"]) {
      const found = findRecipeNode(node["@graph"], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function instructionsToLines(instructions) {
  if (!instructions) return [];
  if (typeof instructions === "string") {
    return instructions
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(instructions)) {
    const lines = [];
    for (const step of instructions) {
      if (typeof step === "string") {
        lines.push(step.trim());
      } else if (step && typeof step === "object") {
        if (step["@type"] === "HowToSection" && Array.isArray(step.itemListElement)) {
          lines.push(...instructionsToLines(step.itemListElement));
        } else if (step.text) {
          lines.push(String(step.text).trim());
        } else if (step.name) {
          lines.push(String(step.name).trim());
        }
      }
    }
    return lines.filter(Boolean);
  }
  return [];
}

function buildHintFromRecipeNode(node) {
  const name = node.name || "";
  const ingredients = Array.isArray(node.recipeIngredient)
    ? node.recipeIngredient
    : Array.isArray(node.ingredients)
    ? node.ingredients
    : [];
  const instructionLines = instructionsToLines(node.recipeInstructions);
  const minutes =
    isoDurationToMinutes(node.totalTime) ||
    isoDurationToMinutes(node.cookTime) ||
    isoDurationToMinutes(node.prepTime);
  let yieldText = node.recipeYield;
  if (Array.isArray(yieldText)) yieldText = yieldText[0];

  const parts = [];
  if (name) parts.push(`Titel: ${name}`);
  if (yieldText) parts.push(`Portionen/Menge laut Seite: ${yieldText}`);
  if (minutes) parts.push(`Gesamtzeit: ca. ${minutes} Minuten`);
  if (ingredients.length) {
    parts.push("Zutaten (roh von der Seite):");
    parts.push(ingredients.map((i) => "- " + String(i).trim()).join("\n"));
  }
  if (instructionLines.length) {
    parts.push("Zubereitungsschritte (roh von der Seite):");
    parts.push(instructionLines.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  }
  if (node.description) {
    parts.push("Beschreibung: " + String(node.description).trim());
  }
  return parts.join("\n\n");
}

function extractTitleFallback(html) {
  const og = html.match(/<meta property="og:title" content="([^"]*)"/i);
  if (og) return og[1];
  const t = html.match(/<title>([^<]*)<\/title>/i);
  if (t) return t[1];
  return "";
}

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

  const url = (req.body || {}).url;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Bitte einen Link angeben." });
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url.trim());
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch {
    res.status(400).json({ error: "Der Link wurde nicht als gültige Webadresse erkannt." });
    return;
  }

  let html = "";
  let siteName = parsedUrl.hostname.replace(/^www\./, "");
  try {
    const pageRes = await fetch(parsedUrl.toString(), {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "de-DE,de;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });
    if (!pageRes.ok) {
      throw new Error("Seite konnte nicht geladen werden (Status " + pageRes.status + ").");
    }
    html = await pageRes.text();
  } catch (err) {
    res.status(502).json({
      error:
        "Die Seite konnte nicht geladen werden: " +
        (err && err.message ? err.message : String(err)) +
        ". Manche Seiten blockieren automatisierte Anfragen - in dem Fall bitte das Rezept manuell anlegen.",
    });
    return;
  }

  let hintText = "";
  const jsonLdBlocks = extractJsonLdBlocks(html);
  let recipeNode = null;
  for (const block of jsonLdBlocks) {
    recipeNode = findRecipeNode(block);
    if (recipeNode) break;
  }

  if (recipeNode) {
    hintText = buildHintFromRecipeNode(recipeNode);
  }

  const title = extractTitleFallback(html);

  if (!hintText || hintText.trim().length < 30) {
    // Kein brauchbares JSON-LD gefunden - Rückfallebene: sichtbaren Text
    // grob extrahieren und begrenzen, damit der Claude-Aufruf handhabbar bleibt.
    const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[0] : html;
    const text = stripHtmlTags(bodyHtml).slice(0, 8000);
    hintText = `Seitentitel: ${title || "(unbekannt)"}\n\nSeitentext (automatisch extrahiert, kann Navigation/Werbung enthalten):\n${text}`;
  }

  if (!hintText || hintText.trim().length < 20) {
    res.status(422).json({
      error:
        "Von dieser Seite konnten keine verwertbaren Inhalte gelesen werden. Bitte den Link prüfen oder das Rezept manuell anlegen.",
    });
    return;
  }

  const userText = `Quelle: ${siteName}\nURL: ${parsedUrl.toString()}\n${title ? "Seitentitel: " + title + "\n" : ""}\n${hintText}`;

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
        messages: [{ role: "user", content: userText }],
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
