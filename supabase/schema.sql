-- Convoy trail-follow MVP schema
create extension if not exists pgcrypto;

create table if not exists public.convoy_sessions (
  id uuid primary key default gen_random_uuid(),
  share_code text not null unique,
  leader_client_id text not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now()
);

create table if not exists public.convoy_location_points (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.convoy_sessions(id) on delete cascade,
  user_id text not null,
  latitude double precision not null,
  longitude double precision not null,
  speed_mps double precision,
  heading_deg double precision,
  sequence_no integer not null,
  recorded_at timestamptz not null default now()
);

create unique index if not exists convoy_location_unique_seq
  on public.convoy_location_points (session_id, sequence_no);

create index if not exists convoy_location_session_idx
  on public.convoy_location_points (session_id, recorded_at);

alter table public.convoy_sessions enable row level security;
alter table public.convoy_location_points enable row level security;

-- MVP-open policies for rapid prototyping. Lock this down with auth before production.
create policy "mvp read sessions"
  on public.convoy_sessions
  for select
  using (true);

create policy "mvp insert sessions"
  on public.convoy_sessions
  for insert
  with check (true);

create policy "mvp update sessions"
  on public.convoy_sessions
  for update
  using (true)
  with check (true);

create policy "mvp read points"
  on public.convoy_location_points
  for select
  using (true);

create policy "mvp insert points"
  on public.convoy_location_points
  for insert
  with check (true);

-- Realtime replication
alter publication supabase_realtime add table public.convoy_location_points;
