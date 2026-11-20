-- Performance stats: follower count per page per day, and Facebook numbers per posted Reel.
-- Filled by the worker; the web only reads them.

create table if not exists public.page_stats (
  page_id uuid not null references public.pages(id) on delete cascade,
  day date not null,
  followers integer,
  primary key (page_id, day)
);

create table if not exists public.post_stats (
  post_id uuid primary key references public.clip_posts(id) on delete cascade,
  page_id uuid not null references public.pages(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  plays integer,          -- Reel plays
  reach integer,          -- unique accounts that saw it
  avg_watch_sec numeric,  -- average watch time
  likes integer,
  comments integer,
  shares integer,
  follows integer,        -- new page followers from this Reel
  raw jsonb,
  error text
);
create index if not exists post_stats_page_idx on public.post_stats (page_id);

alter table public.page_stats enable row level security;
alter table public.post_stats enable row level security;

drop policy if exists page_stats_read on public.page_stats;
create policy page_stats_read on public.page_stats for select to authenticated
  using (public.can_see_page(page_id));
drop policy if exists post_stats_read on public.post_stats;
create policy post_stats_read on public.post_stats for select to authenticated
  using (public.can_see_page(page_id));
