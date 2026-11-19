-- Reels Autopilot schema. Run once in Supabase SQL editor.

create extension if not exists pgcrypto;

-- ─── People ──────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text check (role in ('owner', 'admin', 'reviewer')),
  created_at timestamptz not null default now()
);

create table public.invitations (
  email text primary key,
  role text not null check (role in ('admin', 'reviewer')),
  page_ids uuid[] not null default '{}',
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─── Styles and pages ────────────────────────────────────────────────────────

create table public.styles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  fb_page_id text not null unique,
  name text not null,
  picture_url text,
  followers integer,
  enabled boolean not null default false,
  categories text[] not null default '{}',
  clips_per_day integer not null default 5 check (clips_per_day between 1 and 8),
  post_window_start time not null default '07:00',
  post_window_end time not null default '22:00',
  style_id uuid references public.styles(id) on delete set null,
  require_approval boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.page_members (
  user_id uuid not null references public.profiles(id) on delete cascade,
  page_id uuid not null references public.pages(id) on delete cascade,
  primary key (user_id, page_id)
);

create table public.fb_connections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  fb_user_name text,
  token_enc text not null,
  role text not null check (role in ('primary', 'backup')),
  status text not null default 'ok' check (status in ('ok', 'invalid')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (page_id, user_id)
);

-- ─── Clips ───────────────────────────────────────────────────────────────────

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  plan_date date,
  category text not null,
  style_id uuid references public.styles(id) on delete set null,
  topic text,
  source_url text,
  source_title text,
  script jsonb,
  status text not null default 'planned'
    check (status in ('planned', 'producing', 'ready', 'failed', 'cancelled')),
  produce_after timestamptz not null default now(),
  video_path text,
  thumb_path text,
  duration_sec numeric,
  attempts integer not null default 0,
  error text,
  tg_message_id bigint,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clips_status_idx on public.clips (status, produce_after);
create index clips_plan_date_idx on public.clips (plan_date);

create table public.clip_posts (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  page_id uuid not null references public.pages(id) on delete cascade,
  caption text,
  scheduled_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'notified', 'awaiting_approval', 'posting',
                      'posted', 'failed', 'cancelled', 'delete_requested', 'deleted')),
  post_now boolean not null default false,
  approved_by uuid references public.profiles(id) on delete set null,
  fb_video_id text,
  posted_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clip_posts_status_idx on public.clip_posts (status, scheduled_at);
create index clip_posts_clip_idx on public.clip_posts (clip_id);

-- ─── Settings ────────────────────────────────────────────────────────────────

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Encrypted API keys. Only the service role can read this table.
create table public.secrets (
  key text primary key,
  value_enc text not null,
  updated_at timestamptz not null default now()
);

-- ─── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.can_see_page(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'owner' from public.profiles where id = auth.uid()), false)
    or exists (select 1 from public.page_members where user_id = auth.uid() and page_id = pid)
$$;

create or replace function public.can_see_clip(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'owner'
    or exists (select 1 from public.clips c where c.id = cid and c.created_by = auth.uid())
    or exists (select 1 from public.clip_posts p
               join public.page_members m on m.page_id = p.page_id and m.user_id = auth.uid()
               where p.clip_id = cid)
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger clips_touch before update on public.clips for each row execute function public.touch_updated_at();
create trigger clip_posts_touch before update on public.clip_posts for each row execute function public.touch_updated_at();

-- First user becomes owner; invited users get their invited role; anyone else gets no access.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.invitations;
begin
  if not exists (select 1 from public.profiles where role = 'owner') then
    insert into public.profiles (id, email, role) values (new.id, new.email, 'owner');
    return new;
  end if;
  select * into inv from public.invitations where lower(email) = lower(new.email);
  if found then
    insert into public.profiles (id, email, role) values (new.id, new.email, inv.role);
    insert into public.page_members (user_id, page_id)
      select new.id, unnest(inv.page_ids)
      on conflict do nothing;
    delete from public.invitations where email = inv.email;
  else
    insert into public.profiles (id, email, role) values (new.id, new.email, null);
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── API access ──────────────────────────────────────────────────────────────
-- Explicit grants, so the API works even when the project does not expose new tables automatically.
-- Row level security below still decides which rows each person can see.

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated, service_role;

-- ─── Row level security ──────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.styles enable row level security;
alter table public.pages enable row level security;
alter table public.page_members enable row level security;
alter table public.fb_connections enable row level security;
alter table public.clips enable row level security;
alter table public.clip_posts enable row level security;
alter table public.settings enable row level security;
alter table public.secrets enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() is not null);
create policy profiles_owner_update on public.profiles for update to authenticated
  using (public.my_role() = 'owner') with check (public.my_role() = 'owner');
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role is not distinct from public.my_role());

create policy invitations_owner on public.invitations for select to authenticated
  using (public.my_role() = 'owner');

create policy styles_read on public.styles for select to authenticated
  using (public.my_role() is not null);
create policy styles_write on public.styles for insert to authenticated
  with check (public.my_role() in ('owner', 'admin'));
create policy styles_update on public.styles for update to authenticated
  using (public.my_role() in ('owner', 'admin'));
create policy styles_delete on public.styles for delete to authenticated
  using (public.my_role() = 'owner');

create policy pages_read on public.pages for select to authenticated
  using (public.can_see_page(id));
create policy pages_update on public.pages for update to authenticated
  using (public.my_role() = 'owner' or (public.my_role() = 'admin' and public.can_see_page(id)));
create policy pages_delete on public.pages for delete to authenticated
  using (public.my_role() = 'owner');

create policy members_read on public.page_members for select to authenticated
  using (user_id = auth.uid() or public.my_role() = 'owner');
create policy members_owner_insert on public.page_members for insert to authenticated
  with check (public.my_role() = 'owner');
create policy members_owner_delete on public.page_members for delete to authenticated
  using (public.my_role() = 'owner');

-- Tokens never leave the database through the API: authenticated users get every column except token_enc.
create policy fbconn_read on public.fb_connections for select to authenticated
  using (public.my_role() = 'owner' or user_id = auth.uid());
create policy fbconn_owner_delete on public.fb_connections for delete to authenticated
  using (public.my_role() = 'owner');
revoke all on public.fb_connections from anon, authenticated;
grant select (id, page_id, user_id, fb_user_name, role, status, last_checked_at, created_at)
  on public.fb_connections to authenticated;
grant delete on public.fb_connections to authenticated;

create policy clips_read on public.clips for select to authenticated
  using (public.can_see_clip(id));
create policy posts_read on public.clip_posts for select to authenticated
  using (public.can_see_page(page_id) or public.can_see_clip(clip_id));

create policy settings_read on public.settings for select to authenticated
  using (public.my_role() is not null);
create policy settings_owner_write on public.settings for update to authenticated
  using (public.my_role() = 'owner');
create policy settings_owner_insert on public.settings for insert to authenticated
  with check (public.my_role() = 'owner');

revoke all on public.secrets from anon, authenticated;

-- ─── Storage ─────────────────────────────────────────────────────────────────
-- Public bucket: Facebook and Telegram fetch videos by URL. Paths are random UUIDs.

insert into storage.buckets (id, name, public) values ('clips', 'clips', true)
  on conflict (id) do nothing;

create policy clips_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and public.my_role() in ('owner', 'admin')
              and (storage.foldername(name))[1] in ('uploads', 'logos'));

-- ─── Seed data ───────────────────────────────────────────────────────────────

insert into public.styles (name, config) values
  ('ตะเกียงใจ', '{
    "hook_color": "#FF2A2A", "keyword_color": "#FF9500", "body_color": "#FFFFFF", "cta_color": "#FFE066",
    "background": "video", "background_hint": "sunset sky clouds nature",
    "voice": "female", "voice_rate": "+0%", "duration": 45,
    "show_logo": true, "logo_path": null, "dim": 0.25
  }'),
  ('ข่าวด่วน', '{
    "hook_color": "#FFFFFF", "keyword_color": "#FFD60A", "body_color": "#FFFFFF", "cta_color": "#5AC8FA",
    "background": "photo", "background_hint": "",
    "voice": "male", "voice_rate": "+5%", "duration": 45,
    "show_logo": false, "logo_path": null, "dim": 0.45
  }');

insert into public.settings (key, value) values
  ('automation_enabled', 'true'),
  ('notify_minutes_before', '30'),
  ('summary_hour', '22'),
  ('max_posts_per_page', '8'),
  ('page_gap_minutes', '[20, 40]'),
  ('telegram_chat_id', 'null'),
  ('telegram_link_code', to_jsonb(upper(substr(md5(random()::text), 1, 6)))),
  ('providers', '{"llm": "gemini", "llm_model": "", "tts": "gemini", "images": "pixabay"}'),
  ('news_feeds', '["https://www.matichon.co.th/feed", "https://www.khaosod.co.th/feed", "https://www.prachachat.net/feed"]'),
  ('worker_state', '{}');
