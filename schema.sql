-- ============================================================================
-- Rezeptbuch – Datenbankschema (Supabase / Postgres)
-- Phase 1 (MVP)
--
-- Design-Prinzipien:
-- 1. Zutaten sind KEIN Freitext, sondern verweisen auf eine Stammdaten-Tabelle
--    "ingredients". Das ist die wichtigste Entscheidung fürs Erweitern später:
--    Einkaufslisten (Mengen über mehrere Rezepte aufsummieren), Inventar
--    (Bestand pro Zutat) und Resteverwertungs-Vorschläge (Bestand mit
--    Rezeptzutaten abgleichen) brauchen alle eine gemeinsame Zutat-Identität
--    statt "200g Zwiebeln" als String, das nicht maschinell vergleichbar ist.
-- 2. Mengen hängen an recipe_ingredients (Menge + Einheit pro Rezept),
--    nicht an ingredients selbst – dieselbe Zutat kann in jedem Rezept eine
--    andere Menge/Einheit haben.
-- 3. servings_base an recipes ist die Portionszahl, auf die sich alle
--    Mengen in recipe_ingredients beziehen. Skalierung passiert im Frontend:
--    angezeigte Menge = quantity * (gewünschte Portionen / servings_base).
-- 4. Zugriffsmodell: "privat, aber gemeinsam nutzbar" – alle eingeloggten
--    Nutzer (du + ggf. Partner:in) sehen dieselben Daten. Kein Multi-Tenant-
--    Konzept mit getrennten Bereichen pro Person, weil ihr EINE gemeinsame
--    Sammlung wollt. Zugang wird über Supabase Auth (E-Mail/Passwort)
--    kontrolliert, nur eingeladene Accounts kommen rein.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Einheiten (Stammdaten) – "type" ist für spätere Umrechnungslogik gedacht
-- ---------------------------------------------------------------------------
create table units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  abbreviation text not null,
  type text not null check (type in ('mass', 'volume', 'count', 'other')),
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Zutaten (Stammdaten) – zentrale Liste, die über alle Rezepte hinweg
-- wiederverwendet wird. Basis für spätere Einkaufslisten/Inventar.
-- ---------------------------------------------------------------------------
create table ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_unit_id uuid references units(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tags / Kategorien (frei erweiterbar, z. B. "Hauptgericht", "Vegetarisch")
-- ---------------------------------------------------------------------------
create table tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rezepte
-- ---------------------------------------------------------------------------
create table recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_type text not null check (
    source_type in ('link', 'book', 'hellofresh', 'magazine', 'family', 'other')
  ),
  source_text text,          -- z. B. Buchtitel + Seite, "HelloFresh KW32/2024"
  source_url text,           -- optionaler Link
  prep_time_minutes integer,
  servings_base numeric not null default 4,
  notes text,
  image_path text,           -- Pfad im Storage-Bucket "recipe-images", nicht die volle URL
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Zubereitungsschritte (geordnet, damit sie einzeln editierbar bleiben)
-- ---------------------------------------------------------------------------
create table recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  step_number integer not null,
  instruction text not null
);

-- ---------------------------------------------------------------------------
-- Zutaten pro Rezept (strukturiert: Menge + Einheit statt Freitext)
-- ---------------------------------------------------------------------------
create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  quantity numeric,           -- nullable für "nach Geschmack" o.ä.
  unit_id uuid references units(id),
  note text,                  -- z. B. "gehackt", "optional"
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Rezept <-> Tags (many-to-many)
-- ---------------------------------------------------------------------------
create table recipe_tags (
  recipe_id uuid not null references recipes(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (recipe_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- updated_at automatisch pflegen
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger recipes_set_updated_at
before update on recipes
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: nur eingeloggte Nutzer dürfen lesen/schreiben.
-- Alle eingeloggten Nutzer teilen sich dieselben Daten (gemeinsame Sammlung).
-- ---------------------------------------------------------------------------
alter table units enable row level security;
alter table ingredients enable row level security;
alter table tags enable row level security;
alter table recipes enable row level security;
alter table recipe_steps enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_tags enable row level security;

create policy "authenticated read/write units" on units
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write ingredients" on ingredients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write tags" on tags
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write recipes" on recipes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write recipe_steps" on recipe_steps
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write recipe_ingredients" on recipe_ingredients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write recipe_tags" on recipe_tags
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Startdaten: gängige Einheiten
-- ---------------------------------------------------------------------------
insert into units (name, abbreviation, type, sort_order) values
  ('Gramm', 'g', 'mass', 1),
  ('Kilogramm', 'kg', 'mass', 2),
  ('Milliliter', 'ml', 'volume', 3),
  ('Liter', 'l', 'volume', 4),
  ('Esslöffel', 'EL', 'volume', 5),
  ('Teelöffel', 'TL', 'volume', 6),
  ('Stück', 'Stk', 'count', 7),
  ('Prise', 'Prise', 'other', 8),
  ('Bund', 'Bund', 'count', 9),
  ('Dose', 'Dose', 'count', 10),
  ('Packung', 'Pck', 'count', 11),
  ('Tasse', 'Tasse', 'volume', 12),
  ('Zehe', 'Zehe', 'count', 13);

-- ---------------------------------------------------------------------------
-- Startdaten: gängige Kategorien/Tags (frei löschbar/erweiterbar)
-- ---------------------------------------------------------------------------
insert into tags (name) values
  ('Frühstück'), ('Hauptgericht'), ('Vorspeise'), ('Beilage'),
  ('Suppe'), ('Salat'), ('Dessert'), ('Backen'),
  ('Vegetarisch'), ('Vegan'), ('Schnell'), ('HelloFresh');
