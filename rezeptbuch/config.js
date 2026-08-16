// ============================================================================
// Konfiguration – hier trägst du nach dem Anlegen deines Supabase-Projekts
// die beiden Werte ein (siehe DEPLOYMENT.md, Schritt 2).
//
// Der "anon key" ist bewusst öffentlich im Frontend sichtbar – das ist bei
// Supabase so vorgesehen. Der eigentliche Schutz eurer Daten passiert über
// Row Level Security (siehe schema.sql): nur eingeloggte Accounts dürfen
// überhaupt lesen/schreiben.
// ============================================================================

export const SUPABASE_URL = "https://zntkbvubuxlrzuxiufbi.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpudGtidnVidXhscnp1eGl1ZmJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTQwMTQsImV4cCI6MjEwMjQ3MDAxNH0.x3H0_HKciniuB7GmgWvvNph7GdJkZQMbC0XBBmhpNvk";
