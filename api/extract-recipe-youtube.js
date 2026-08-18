// ============================================================================
// Vercel Serverless Function: nimmt einen YouTube-Video-Link entgegen, liest
// Titel, Kanalname und Videobeschreibung von der YouTube-Seite aus (ohne
// offizielle API/Key nötig) und lässt daraus per Anthropic API (Claude) ein
// strukturiertes Rezept extrahieren. Viele Koch-Kanäle schreiben das
// vollständige Rezept in die Videobeschreibung - das ist die Hauptquelle
// hier. Ein echtes Video-Transkript wird bewusst NICHT abgerufen (dafür
// bräuchte es zusätzliche Untertitel-Infrastruktur); reicht die Beschreibung
// nicht aus, liefert Claude ein bestmögliches Teilergebnis, das die Nutzerin
// im Formular danach ergänzen kann.
//
// Benötigt die Umgebungsvariable ANTHROPIC_API_KEY (wie beim Foto-Import).
// ============================================================================

export const config = {
  maxDuration: 45,
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `Du bist ein Assistent, der Kochrezepte aus YouTube-Videobeschreibungen in strukturierte Daten umwandelt. Du bekommst Videotitel, Kanalname und die Videobeschreibung (kein Transkript des gesprochenen Inhalts).

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
- "title": prägnanter Rezeptname (meist nah am Videotitel, ohne Clickbait-Zusätze wie "BESTES Rezept!!").
- "sourceType": immer "link".
- "sourceText": Kanalname und/oder Videotitel als kurze Quellenangabe.
- "prepTimeMinutes": Zubereitungszeit in Minuten falls in der Beschreibung angegeben, sonst null.
- "servingsBase": Portionenanzahl als Zahl, falls nicht erkennbar schätze plausibel (z. B. 4).
- "unitAbbreviation": gängige deutsche Kochabkürzungen (g, kg, ml, l, TL, EL, Stk, Prise, Bund, Dose, Päckchen ...), leerer String wenn keine Einheit.
- "quantity": nur die Zahl, keine Einheit im Feld.
- "steps": jeder Zubereitungsschritt als eigenes Objekt, in der richtigen Reihenfolge. Falls die Beschreibung nur Zutaten aber keine nummerierten Schritte enthält, leite plausible, knappe Schritte aus dem Kontext ab statt das Feld leer zu lassen.
- "tags": 1 bis 4 kurze Kategorie-Schlagwörter (z. B. Küche, Gericht-Art), leeres Array wenn nichts Sinnvolles erkennbar.
- "notes": falls die Beschreibung offensichtlich unvollständig ist (z. B. keine erkennbaren Zutaten), trage hier einen kurzen Hinweis ein wie "Automatisch aus Videobeschreibung erkannt - bitte Zutaten/Mengen prüfen." Ansonsten leerer String oder sonstige Zubereitungshinweise.
- Wenn ein Feld nicht erkennbar ist, verwende einen sinnvollen leeren Wert (leerer String, null oder leeres Array) statt zu raten oder zu erfinden. Erfinde keine Zutaten oder Schritte, die nicht im Text stehen bzw. sich nicht plausibel daraus ableiten lassen.`;

function extractVideoId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const shortsMatch = u.pathname.match(/^\/shorts\/([\w-]+)/);
      if (shortsMatch) return shortsMatch[1];
      const embedMatch = u.pathname.match(/^\/embed\/([\w-]+)/);
      if (embedMatch) return embedMatch[1];
      const liveMatch = u.pathname.match(/^\/live\/([\w-]+)/);
      if (liveMatch) return liveMatch[1];
    }
  } catch {
    return null;
  }
  return null;
}

function extractMetaContent(html, property) {
  const re = new RegExp(`<meta property="${property}" content="([^"]*)"`, "i");
  const m = html.match(re);
  return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&") : "";
}

function extractDescription(html) {
  const m = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
  if (m) {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
    }
  }
  return extractMetaContent(html, "og:description");
}

function extractChannelName(html) {
  const m = html.match(/"author":"([^"]+)"/);
  return m ? m[1] : "";
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
    res.status(400).json({ error: "Bitte einen YouTube-Link angeben." });
    return;
  }

  const videoId = extractVideoId(url.trim());
  if (!videoId) {
    res.status(400).json({ error: "Der Link wurde nicht als gültiger YouTube-Link erkannt." });
    return;
  }

  let title = "";
  let description = "";
  let channel = "";
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "de-DE,de;q=0.9,en;q=0.8",
        cookie: "CONSENT=YES+cb.20210328-17-p0.de+FX+119",
      },
    });
    if (!pageRes.ok) {
      throw new Error("YouTube-Seite konnte nicht geladen werden (Status " + pageRes.status + ").");
    }
    const html = await pageRes.text();
    globalThis.__lastHtml = html;
    globalThis.__lastStatus = pageRes.status;
    title = extractMetaContent(html, "og:title");
    description = extractDescription(html);
    channel = extractChannelName(html);
  } catch (err) {
    res.status(502).json({
      error:
        "Videodaten konnten nicht von YouTube geladen werden: " +
        (err && err.message ? err.message : String(err)),
    });
    return;
  }

  if (!title && !description) {
    const h = globalThis.__lastHtml || "";
    const ogIdx = h.indexOf('property="og:title"');
    const shortDescIdx = h.indexOf('"shortDescription"');
    const consentIdx = h.toLowerCase().indexOf("consent.youtube.com");
    const captchaIdx = h.toLowerCase().indexOf("captcha");
    const errorPlayabilityIdx = h.indexOf('"playabilityStatus"');
    const statusIdx = h.indexOf('"status":"');
    res.status(422).json({
      error:
        "Für dieses Video konnten weder Titel noch Beschreibung gelesen werden. Bitte den Link prüfen oder das Rezept manuell anlegen.",
      debugStatus: globalThis.__lastStatus,
      debugHtmlLength: h.length,
      debugOgTitleFound: ogIdx !== -1,
      debugOgTitleSnippet: ogIdx !== -1 ? h.slice(ogIdx, ogIdx + 200) : null,
      debugShortDescFound: shortDescIdx !== -1,
      debugConsentIdx: consentIdx,
      debugCaptchaIdx: captchaIdx,
      debugPlayabilityFound: errorPlayabilityIdx !== -1,
      debugPlayabilitySnippet: errorPlayabilityIdx !== -1 ? h.slice(errorPlayabilityIdx, errorPlayabilityIdx + 300) : null,
      debugStatusSnippet: statusIdx !== -1 ? h.slice(statusIdx, statusIdx + 100) : null,
    });
    return;
  }

  const userText = `Videotitel: ${title || "(unbekannt)"}
Kanal: ${channel || "(unbekannt)"}
Video-URL: https://www.youtube.com/watch?v=${videoId}

Videobeschreibung:
${description || "(keine Beschreibung verfügbar)"}`;

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
