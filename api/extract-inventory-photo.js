// ============================================================================
// Vercel Serverless Function: liest ein oder mehrere Fotos von Lebensmitteln
// (Kuehlschrank, Vorratsschrank, Speisekammer, frisch eingekaufte Sachen auf
// dem Tisch) und extrahiert eine Liste moeglicher Vorrats-Posten (Name,
// geschaetzte Menge/Einheit, MHD falls auf der Verpackung lesbar) per
// Anthropic API (Claude, Bildverstaendnis). Dient als Ausgangspunkt fuer die
// Erst-Inventur bzw. spontane Vorrats-Ergaenzung - die Liste wird danach im
// Frontend geprueft/ergaenzt, bevor sie uebernommen wird (MHD ist dort
// Pflichtfeld, falls die KI keins erkennen konnte).
//
// Benoetigt die Umgebungsvariable ANTHROPIC_API_KEY (siehe DEPLOYMENT.md).
// ============================================================================

export const config = {
maxDuration: 60,
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `Du bist ein Assistent, der Fotos von Lebensmitteln (z. B. Kuehlschrank, Vorratsschrank, Speisekammer, frisch eingekaufte Sachen auf dem Tisch) liest und daraus eine Liste einzelner Vorrats-Posten fuer eine Haushalts-App extrahiert. Manchmal bekommst du mehrere Fotos, die zusammen denselben Vorrat aus verschiedenen Blickwinkeln oder verschiedene Bereiche (z. B. Kuehlschrank + Schrank) zeigen - kombiniere sie zu einer gemeinsamen Liste ohne Dopplungen.

Antworte AUSSCHLIESSLICH mit einem einzelnen validen JSON-Objekt, ohne Markdown-Codeblock, ohne Erklaertext davor oder danach. Halte dich exakt an dieses Schema:

{ "items": [ { "name": string, "quantity": number|null, "unit": string|null, "expiryDate": string|null } ] }

Regeln:
- "name": kurzer, alltagssprachlicher Produktname auf Deutsch (z. B. "Milch", "Eier", "Passierte Tomaten"), keine Markennamen sofern nicht eindeutig Teil der Alltagsbezeichnung.
- "quantity" + "unit": plausible Schaetzung anhand des Fotos (z. B. eine sichtbare Packung Milch -> quantity 1, unit "Stück"; ein Netz Zwiebeln -> quantity 1, unit "Netz"). Wenn die Menge nicht sinnvoll schaetzbar ist, quantity null und unit null lassen statt zu raten.
- "expiryDate": NUR setzen, wenn ein Mindesthaltbarkeitsdatum oder Verbrauchsdatum tatsaechlich lesbar auf der Verpackung im Foto zu sehen ist, im Format "YYYY-MM-DD". Ist kein Datum lesbar (der allermeiste Regelfall), gib expiryDate: null zurueck - erfinde niemals ein Datum.
- Jede erkennbare, einzelne Produktart wird eine eigene Zeile, auch wenn mehrere Exemplare sichtbar sind (dann quantity entsprechend hoeher, keine Duplikat-Zeilen fuer dasselbe Produkt).
- Ignoriere nicht essbare Dinge, Verpackungsmuell, unklare/nicht identifizierbare Gegenstaende.
- Wenn kein Foto erkennbar Lebensmittel zeigt, gib { "items": [] } zurueck statt zu raten oder zu erfinden.`;

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
? "Diese Fotos zeigen zusammen denselben Vorrat. Kombiniere alle erkennbaren Lebensmittel aus den Fotos zu einer gemeinsamen Liste als JSON gemaess dem vorgegebenen Schema, ohne Dopplungen."
: "Extrahiere die erkennbaren Lebensmittel von diesem Foto als JSON gemaess dem vorgegebenen Schema.";

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
quantity: it.quantity !== null && Number.isFinite(Number(it.quantity)) ? Number(it.quantity) : null,
unit: it.unit ? String(it.unit).trim() : null,
expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(String(it.expiryDate || "")) ? it.expiryDate : null,
}))
.filter((it) => it.name)
: [];

res.status(200).json({ items });
} catch (err) {
res.status(500).json({ error: "Unerwarteter Fehler: " + (err && err.message ? err.message : String(err)) });
}
}
