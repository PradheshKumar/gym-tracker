-- Gym Tracker cloud schema. Run once in the Supabase SQL editor (safe to re-run).
--
-- The app is offline-first: every on-device record is mirrored as one row here.
--   tbl/id      which local table and record
--   data        the record as JSON (null once deleted)
--   updated_at  client clock in ms; last write wins
--   rev         server sequence, used as the pull cursor
-- Typed views at the bottom make the data easy to query with SQL.

create sequence if not exists public.records_rev_seq;

create table if not exists public.records (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  tbl        text    not null,
  id         text    not null,
  data       jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null,
  rev        bigint  not null default nextval('public.records_rev_seq'),
  primary key (user_id, tbl, id)
);

create index if not exists records_user_rev on public.records (user_id, rev);

-- Last write wins: ignore updates older than what is stored; bump rev on every accepted write.
create or replace function public.records_lww()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at <= old.updated_at then
    return null;
  end if;
  new.rev := nextval('public.records_rev_seq');
  return new;
end;
$$;

drop trigger if exists records_lww on public.records;
create trigger records_lww
  before insert or update on public.records
  for each row execute function public.records_lww();

-- Row-level security: each signed-in user sees and writes only their own rows.
alter table public.records enable row level security;

drop policy if exists "own rows" on public.records;
create policy "own rows" on public.records
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant usage on sequence public.records_rev_seq to authenticated;

-- ---------- Typed views (read-only, respect RLS) ----------

create or replace view public.workout_sets with (security_invoker = true) as
select user_id,
       id,
       (data ->> 'date')::date            as date,
       data ->> 'sessionId'               as session_id,
       data ->> 'exerciseId'              as exercise_id,
       (data ->> 'setNo')::int            as set_no,
       (data ->> 'weight')::numeric       as weight_kg,
       (data ->> 'reps')::int             as reps,
       (data ->> 'rir')::int              as rir,
       (data ->> 'isWarmup')::boolean     as is_warmup
from public.records
where tbl = 'sets' and not deleted;

create or replace view public.workout_sessions with (security_invoker = true) as
select user_id,
       id,
       (data ->> 'date')::date            as date,
       (data ->> 'weekday')::int          as weekday,
       data ->> 'kind'                    as kind,
       data ->> 'status'                  as status,
       to_timestamp((data ->> 'startedAt')::bigint / 1000.0) as started_at,
       to_timestamp((data ->> 'endedAt')::bigint / 1000.0)   as ended_at,
       data ->> 'notes'                   as notes
from public.records
where tbl = 'sessions' and not deleted;

create or replace view public.weigh_ins with (security_invoker = true) as
select user_id,
       (data ->> 'date')::date            as date,
       (data ->> 'kg')::numeric           as kg
from public.records
where tbl = 'weighins' and not deleted;

create or replace view public.body_measurements with (security_invoker = true) as
select user_id,
       (data ->> 'date')::date            as date,
       data ->> 'site'                    as site,
       (data ->> 'cm')::numeric           as cm
from public.records
where tbl = 'measurements' and not deleted;

create or replace view public.body_fat with (security_invoker = true) as
select user_id,
       (data ->> 'date')::date            as date,
       data ->> 'method'                  as method,
       (data ->> 'value')::numeric        as percent
from public.records
where tbl = 'bodyfat' and not deleted;

create or replace view public.treadmill_sessions with (security_invoker = true) as
select user_id,
       (data ->> 'date')::date            as date,
       (data ->> 'minutes')::numeric      as minutes,
       (data ->> 'speedKmh')::numeric     as speed_kmh,
       (data ->> 'inclinePct')::numeric   as incline_pct,
       (data ->> 'netKcal')::numeric      as net_kcal
from public.records
where tbl = 'treadmill' and not deleted;

create or replace view public.food_log with (security_invoker = true) as
select user_id,
       (data ->> 'date')::date            as date,
       data ->> 'name'                    as name,
       (data ->> 'kcal')::numeric         as kcal,
       (data ->> 'p')::numeric            as protein_g,
       (data ->> 'c')::numeric            as carbs_g,
       (data ->> 'f')::numeric            as fat_g
from public.records
where tbl = 'foodlog' and not deleted;

-- ---------- Push reminders ----------

-- One row per device that allowed background notifications.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  tz         text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- What the send-reminders function already sent today (one push per reminder per day).
-- No policies: only the function (service role) reads and writes it.
create table if not exists public.push_log (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  reminder text not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, day, reminder)
);

alter table public.push_log enable row level security;
