# Rezeptbuch – Einrichtung & Deployment

Diese Anleitung bringt die App von "Code auf der Festplatte" zu einer echten URL, die du dir auf iPad und Smartphone auf den Homescreen legen kannst. Dauer: ca. 20–30 Minuten, einmalig.

Kosten: 0 € (beide Dienste haben einen kostenlosen Tarif, der für eine private Rezeptsammlung völlig ausreicht).

---

## Schritt 1 – Supabase-Projekt anlegen (Datenbank)

1. Gehe auf **https://supabase.com** → "Start your project" → mit GitHub- oder E-Mail-Account registrieren.
2. "New project" klicken. Name z. B. `rezeptbuch`, ein Datenbank-Passwort setzen (irgendwo notieren), Region z. B. Frankfurt (`eu-central-1`) wählen.
3. Warten, bis das Projekt fertig eingerichtet ist (~2 Minuten).

## Schritt 2 – Datenbankschema anlegen

1. Im Supabase-Dashboard links auf **SQL Editor** klicken → "New query".
2. Öffne die Datei `schema.sql` (liegt neben dieser Anleitung), kopiere den kompletten Inhalt.
3. Füge ihn im SQL-Editor ein und klicke **Run**.
4. Das legt alle Tabellen (Rezepte, Zutaten, Einheiten, Tags …), Sicherheitsregeln und ein paar Start-Einheiten/Kategorien an.

## Schritt 3 – API-Zugangsdaten holen

1. Im Dashboard: **Project Settings** (Zahnrad) → **API**.
2. Kopiere **Project URL** und den **anon public**-Key.
3. Öffne im Projektordner die Datei `js/config.js` und trage beide Werte ein:

   ```js
   export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```

   Der `anon key` ist bewusst öffentlich sichtbar – das ist bei Supabase normal. Der eigentliche Schutz eurer Daten kommt aus den Sicherheitsregeln aus Schritt 2 (nur eingeloggte Accounts dürfen etwas lesen/schreiben).

## Schritt 4 – Login-Accounts anlegen

Es gibt in Phase 1 bewusst **keine öffentliche Registrierung** – Accounts werden von dir direkt in Supabase angelegt (sicherer, und ihr seid ja nur zu zweit).

1. Im Dashboard: **Authentication** → **Users** → **Add user** → **Create new user**.
2. E-Mail und Passwort eingeben, Haken bei **Auto Confirm User** setzen (sonst müsste erst eine Bestätigungs-Mail konfiguriert werden).
3. Für einen zweiten Zugang (z. B. Partner:in) Schritt wiederholen.

## Schritt 5 – Code auf GitHub hochladen

1. Falls noch kein Account: **https://github.com** → kostenlos registrieren.
2. Neues, **privates** Repository anlegen, z. B. `rezeptbuch`.
3. Den Ordnerinhalt (alles neben dieser Datei, außer `schema.sql`/`DEPLOYMENT.md` können ruhig mit hochgeladen werden) hochladen – entweder per "Upload files" im Browser (einfachster Weg: Ordner per Drag & Drop auf die GitHub-Seite ziehen) oder mit Git, falls du das schon nutzt.

## Schritt 6 – Auf Vercel deployen

1. **https://vercel.com** → "Sign up" → mit GitHub anmelden (dann ist Schritt 5 direkt verbunden).
2. "Add New…" → "Project" → dein `rezeptbuch`-Repository auswählen → **Import**.
3. Vercel erkennt automatisch, dass es eine statische Seite ohne Build-Schritt ist ("Other" Framework Preset) – du musst nichts einstellen. Einfach **Deploy** klicken.
4. Nach ca. 30 Sekunden bekommst du eine URL wie `https://rezeptbuch-xyz.vercel.app`.

Änderungen später einbauen: Datei in GitHub aktualisieren → Vercel deployt automatisch neu.

## Schritt 6b – Foto-Import einrichten (optional)

Die Funktion "Rezept per Foto erfassen" liest ein Foto (Kochbuchseite, Zeitschrift,
handschriftliche Notiz) automatisch aus und schlägt Titel, Zutaten und Zubereitungs-
schritte vor. Dafür wird ein Anthropic-API-Key benötigt (Kosten: wenige Cent pro
erkanntem Rezept, kein Abo). Ohne diesen Schritt funktioniert der Rest der App
weiterhin ganz normal – nur der Foto-Import zeigt dann eine Fehlermeldung an.

1. Gehe auf **https://console.anthropic.com** → registrieren bzw. einloggen.
2. Links im Menü auf **API Keys** → **Create Key**. Name z. B. `rezeptbuch`, dann kopieren
   (der Key wird nur einmal angezeigt).
3. Im Vercel-Dashboard: dein `rezeptbuch`-Projekt öffnen → **Settings** → **Environment Variables**.
4. Neue Variable anlegen:
   - Name: `ANTHROPIC_API_KEY`
   - Value: der eben kopierte Key
   - Environment: Production (und optional Preview/Development)
5. **Save** klicken, danach im Tab **Deployments** beim neuesten Deployment auf die drei
   Punkte → **Redeploy**, damit die neue Umgebungsvariable aktiv wird.

Der Key wird ausschließlich serverseitig verwendet (in `api/extract-recipe.js`) und ist
im Browser nie sichtbar.

## Schritt 6c – YouTube-Import einrichten (optional)

Die Funktion "Rezept per YouTube-Link erfassen" liest Titel und Beschreibung eines
Kochvideos aus und lässt daraus (wie beim Foto-Import) automatisch ein Rezept
vorschlagen. Dafür wird zusätzlich zum Anthropic-Key ein **kostenloser** YouTube-API-Key
benötigt (Google-Konto vorausgesetzt, kein Kreditkarten-Setup nötig für die geringe
Nutzung hier). Ohne diesen Schritt funktioniert der Rest der App weiterhin ganz normal
– nur der YouTube-Import zeigt dann eine Fehlermeldung an.

1. Gehe auf **https://console.cloud.google.com** → mit deinem Google-Konto einloggen.
2. Oben ein neues Projekt anlegen (z. B. `rezeptbuch`) oder ein bestehendes auswählen.
3. Im Menü links: **APIs & Dienste** → **Bibliothek** → nach "YouTube Data API v3" suchen
   → öffnen → **Aktivieren** klicken.
4. Im Menü links: **APIs & Dienste** → **Anmeldedaten** → **+ Anmeldedaten erstellen** →
   **API-Schlüssel**. Der Key wird sofort angezeigt – kopieren.
   (Optional, aber empfohlen: Klick auf den neuen Key → unter "API-Einschränkungen" nur
   "YouTube Data API v3" erlauben, das schützt den Key vor Missbrauch.)
5. Im Vercel-Dashboard: dein `rezeptbuch`-Projekt öffnen → **Settings** → **Environment
   Variables**.
6. Neue Variable anlegen:
   - Name: `YOUTUBE_API_KEY`
   - Value: der eben kopierte Key
   - Environment: Production (und optional Preview/Development)
7. **Save** klicken, danach im Tab **Deployments** beim neuesten Deployment auf die drei
   Punkte → **Redeploy**, damit die neue Umgebungsvariable aktiv wird.

Die YouTube Data API v3 hat ein kostenloses Kontingent von 10.000 Anfragen pro Tag –
jeder Videoabruf hier kostet nur 1 Einheit, das reicht für eine private Rezeptsammlung
bei weitem aus.

## Schritt 7 – Auf dem Homescreen installieren

**iPad / iPhone (Safari):**
1. Die Vercel-URL in Safari öffnen.
2. Teilen-Symbol (Quadrat mit Pfeil nach oben) → **Zum Home-Bildschirm**.
3. Name bestätigen → **Hinzufügen**. Die App startet danach ohne Browser-Leiste, wie eine echte App.

**Android:** Chrome → Menü (⋮) → "App installieren" bzw. "Zum Startbildschirm hinzufügen".

## Schritt 8 – Testen

1. App öffnen, mit einem der in Schritt 4 angelegten Accounts einloggen.
2. Ein Testrezept anlegen, Zutaten mit Menge/Einheit eingeben, Portionszahl auf dem Detail-Screen hoch-/runterzählen und prüfen, ob sich die Mengen sinnvoll anpassen.
3. Auf dem zweiten Gerät einloggen und prüfen, ob das Rezept dort ebenfalls sichtbar ist (Cloud-Sync).

---

## Wenn etwas nicht funktioniert

- **Login schlägt fehl:** Prüfen, ob in Schritt 4 "Auto Confirm User" gesetzt war.
- **Leere Seite / Fehler in der Konsole:** meist ein Tippfehler in `js/config.js` (URL oder Key). Browser-Konsole öffnen (iPad: über Mac + Safari-Entwicklertools, oder am Desktop testen) und Fehlermeldung prüfen.
- **"row-level security policy" Fehler beim Speichern:** Das bedeutet, du bist nicht eingeloggt oder die Session ist abgelaufen – neu einloggen.
- **Foto-Import meldet "ANTHROPIC_API_KEY ist nicht konfiguriert":** Schritt 6b nachholen und danach ein Redeploy in Vercel auslösen (Umgebungsvariablen werden erst beim nächsten Deploy aktiv).
- **YouTube-Import meldet "YOUTUBE_API_KEY ist nicht konfiguriert":** Schritt 6c nachholen und danach ein Redeploy in Vercel auslösen.

Bei Bedarf kannst du mir jederzeit die Fehlermeldung schicken, dann schauen wir gemeinsam drauf.
