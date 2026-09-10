-- Meal Planner schema.
--
-- One idea runs through all of it: every row belongs to a HOUSEHOLD, not to a
-- user. Two accounts in the same household see one shared list, which is the
-- shape a couple needs and also the shape a third person would need later.
-- Retrofitting that after there is live data is the expensive kind of
-- migration, so it is here from the first line.
--
-- Run this once in the Supabase SQL editor.

-- ---------------------------------------------------------------- households

create table if not exists households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Our kitchen',
  -- Short human-typable code so a second person can join without an email
  -- round-trip. Rotatable: see rotate_invite_code() below.
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at  timestamptz not null default now()
);

create table if not exists household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists household_members_user_idx on household_members(user_id);

-- Which household the current request belongs to. SECURITY DEFINER so the
-- policies below can call it without recursing through their own RLS.
create or replace function current_household()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id
  from household_members
  where user_id = auth.uid()
  limit 1
$$;

-- ---------------------------------------------------------------- app tables
--
-- Recipe bodies stay as jsonb rather than being shredded into columns. The app
-- already normalises every field on read (normalizeMeal), the shapes change
-- with the app, and nothing here is queried by ingredient. Trading SQL
-- expressiveness for one fewer place to keep in sync is the right way round at
-- this size; if a "find every meal using butter beans" query ever matters, a
-- generated column or a jsonb index can be added without a rewrite.

create table if not exists meals (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null
);
create index if not exists meals_household_idx on meals(household_id);

-- One row per household. The week is a single mutable document in the app, so
-- the primary key IS the household id — there is no way to end up with two.
create table if not exists weeks (
  household_id uuid primary key references households(id) on delete cascade,
  data         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

create table if not exists pantry (
  household_id uuid primary key references households(id) on delete cascade,
  items        jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

create table if not exists history (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  data         jsonb not null,
  archived_at  timestamptz not null default now()
);
create index if not exists history_household_idx on history(household_id, archived_at desc);

-- ------------------------------------------------------------------- updated_at

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists meals_touch on meals;
create trigger meals_touch before update on meals
  for each row execute function touch_updated_at();

drop trigger if exists weeks_touch on weeks;
create trigger weeks_touch before update on weeks
  for each row execute function touch_updated_at();

drop trigger if exists pantry_touch on pantry;
create trigger pantry_touch before update on pantry
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------------------ RLS
--
-- Default deny. Every policy is the same sentence: you may touch a row if it
-- belongs to your household.

alter table households        enable row level security;
alter table household_members enable row level security;
alter table meals             enable row level security;
alter table weeks             enable row level security;
alter table pantry            enable row level security;
alter table history           enable row level security;

drop policy if exists households_read on households;
create policy households_read on households
  for select using (id = current_household());

drop policy if exists households_update on households;
create policy households_update on households
  for update using (id = current_household()) with check (id = current_household());

-- A member may see who else is in their household, and remove only themselves.
drop policy if exists members_read on household_members;
create policy members_read on household_members
  for select using (household_id = current_household());

drop policy if exists members_leave on household_members;
create policy members_leave on household_members
  for delete using (user_id = auth.uid());

-- The four data tables share one shape.
do $$
declare t text;
begin
  foreach t in array array['meals', 'weeks', 'pantry', 'history'] loop
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format(
      'create policy %I_rw on %I for all
         using (household_id = current_household())
         with check (household_id = current_household())', t, t);
  end loop;
end $$;

-- --------------------------------------------------------------- joining flows
--
-- Both run as SECURITY DEFINER because a user who is not yet in any household
-- has no household to pass an RLS check against — the chicken-and-egg every
-- multi-tenant schema hits. They are the ONLY way to gain membership, they
-- take no household id from the caller, and each one re-checks that the caller
-- isn't already a member. That is what keeps "definer" from meaning "wide open".

create or replace function create_household(household_name text default 'Our kitchen')
returns households
language plpgsql
security definer
set search_path = public
as $$
declare h households;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;

  insert into households (name) values (coalesce(nullif(trim(household_name), ''), 'Our kitchen'))
  returning * into h;

  insert into household_members (household_id, user_id, role)
  values (h.id, auth.uid(), 'owner');

  -- Every household starts with its two singleton rows, so the app never has
  -- to distinguish "no week yet" from "week not loaded".
  insert into weeks  (household_id) values (h.id) on conflict do nothing;
  insert into pantry (household_id) values (h.id) on conflict do nothing;

  return h;
end $$;

create or replace function join_household(code text)
returns households
language plpgsql
security definer
set search_path = public
as $$
declare h households;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;

  select * into h from households
  where invite_code = upper(trim(code));

  if h.id is null then
    raise exception 'no household with that code';
  end if;

  insert into household_members (household_id, user_id, role)
  values (h.id, auth.uid(), 'member');

  return h;
end $$;

-- Anyone in the household can burn the current code and mint a new one, which
-- is the only remedy if a code gets shared further than intended.
create or replace function rotate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare new_code text;
begin
  if current_household() is null then
    raise exception 'not in a household';
  end if;
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update households set invite_code = new_code where id = current_household();
  return new_code;
end $$;

revoke all on function create_household(text)  from public, anon;
revoke all on function join_household(text)    from public, anon;
revoke all on function rotate_invite_code()    from public, anon;
grant execute on function create_household(text) to authenticated;
grant execute on function join_household(text)   to authenticated;
grant execute on function rotate_invite_code()   to authenticated;

-- ------------------------------------------------------------------- realtime

-- Adding a table that is already published raises an error, which would make
-- re-running this whole file fail. Everything above is idempotent; this is too.
do $$
declare t text;
begin
  foreach t in array array['meals', 'weeks', 'pantry', 'history'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
