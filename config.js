// ============================================================================
// Konfiguration – hier trägst du nach dem Anlegen deines Supabase-Projekts
// die beiden Werte ein (siehe DEPLOYMENT.md, Schritt 2).
//
// Der "anon key" ist bewusst öffentlich im Frontend sichtbar – das ist bei
// Supabase so vorgesehen. Der eigentliche Schutz eurer Daten passiert über
// Row Level Security (siehe schema.sql): nur eingeloggte Accounts dürfen
// überhaupt lesen/schreiben.
// ============================================================================

export const SUPABASE_URL = "https://DEIN-PROJEKT.supabase.co";
export const SUPABASE_ANON_KEY = "DEIN-ANON-KEY";
