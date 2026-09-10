-- Proves the thing that matters most about this schema: one household cannot
-- see or touch another's data. Run it against a scratch database, never a real
-- one — it inserts users and households.
--
--   createdb mp_test
--   psql -v ON_ERROR_STOP=1 -d mp_test -f supabase/local-prelude.sql
--   psql -v ON_ERROR_STOP=1 -d mp_test -f supabase/schema.sql
--   psql -v ON_ERROR_STOP=1 -d mp_test -f supabase/rls-test.sql
--
-- Every "SECURITY FAIL" below is an exception that stops the script. Silence
-- plus the expected counts is a pass.

-- Supabase grants these by default; do the same so `authenticated` can reach
-- the tables at all and RLS is the only thing deciding what it sees.
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','rich@example.com'),
  ('22222222-2222-2222-2222-222222222222','wife@example.com'),
  ('33333333-3333-3333-3333-333333333333','stranger@example.com')
on conflict do nothing;

\echo '--- A: creates a household ---'
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
select id as household_a, invite_code from create_household('Ours') \gset
\echo 'A inserts a meal'
insert into meals (household_id, data) values (current_household(), '{"name":"A secret traybake"}');
insert into pantry (household_id, items) values (current_household(), '[{"name":"olive oil"}]')
  on conflict (household_id) do update set items = excluded.items;
select count(*) as a_sees_meals from meals;

\echo '--- A cannot create a second household ---'
do $$ begin
  perform create_household('Another');
  raise exception 'SECURITY FAIL: a second household was allowed';
exception when others then
  if sqlerrm like '%already in a household%' then raise notice 'refused correctly: %', sqlerrm;
  else raise; end if;
end $$;

\echo '--- B: joins with the code ---'
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);
select * from join_household(:'invite_code');
select count(*) as b_sees_meals from meals;
select data->>'name' as b_sees_name from meals;

\echo '--- B can write to the shared list ---'
insert into meals (household_id, data) values (current_household(), '{"name":"B added this"}');
select count(*) as shared_total from meals;

\echo '--- C: a stranger with no household ---'
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', false);
select count(*) as c_sees_meals from meals;
select count(*) as c_sees_pantry from pantry;
select count(*) as c_sees_households from households;

\echo '--- C cannot join with a wrong code ---'
do $$ begin
  perform join_household('BADCODE1');
  raise exception 'SECURITY FAIL: a bad code was accepted';
exception when others then
  if sqlerrm like '%no household with that code%' then raise notice 'refused correctly: %', sqlerrm;
  else raise; end if;
end $$;

\echo '--- C makes their own household and still sees nothing of As ---'
select id from create_household('Theirs') \gset
select count(*) as c_sees_meals_after from meals;
insert into meals (household_id, data) values (current_household(), '{"name":"C private"}');
select count(*) as c_sees_own from meals;

\echo '--- and A still sees only their two ---'
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
select count(*) as a_final from meals;
select string_agg(data->>'name', ', ' order by data->>'name') as a_names from meals;

\echo '--- C cannot write into As household even naming it directly ---'
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', false);
do $$
declare a_hh uuid;
begin
  select household_id into a_hh from household_members
    where user_id = '11111111-1111-1111-1111-111111111111';
  -- current_household() is definer so it can see this; the INSERT must not.
  begin
    insert into meals (household_id, data) values (a_hh, '{"name":"injected"}');
    raise exception 'SECURITY FAIL: wrote into another household';
  exception when insufficient_privilege or check_violation then
    raise notice 'blocked correctly by row-level security';
  end;
end $$;
reset role;
