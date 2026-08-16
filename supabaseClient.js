// Supabase-JS wird direkt im Browser von einem CDN geladen (esm.sh baut das
// npm-Paket "on the fly" zu einem ES-Modul um). Dadurch braucht dieses
// Projekt keinerlei Build-Schritt und kein npm install.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
