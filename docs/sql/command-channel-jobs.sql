-- TimOS-Agent command channel jobs (deployable durable store)
-- Apply in Supabase SQL editor or migration pipeline.
-- Server API uses service role key server-side only; do not expose to clients.

create table if not exists public.command_channel_jobs (
  id uuid primary key,
  requested_by text not null default 'xiaoju',
  target_worker_profile text not null,
  repo_ref text not null,
  task_type text not null,
  risk_level text not null default 'low',
  auto_run_requested boolean not null default true,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  errors jsonb,
  claimed_by text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint command_channel_jobs_task_type_check
    check (task_type in ('inspect_only', 'summarize_repo')),

  constraint command_channel_jobs_risk_level_check
    check (risk_level = 'low'),

  constraint command_channel_jobs_status_check
    check (status in ('pending', 'claimed', 'completed', 'failed', 'cancelled'))
);

create index if not exists command_channel_jobs_status_idx
  on public.command_channel_jobs (status);

create index if not exists command_channel_jobs_target_worker_profile_idx
  on public.command_channel_jobs (target_worker_profile);

create index if not exists command_channel_jobs_created_at_idx
  on public.command_channel_jobs (created_at);

-- RLS: recommended for defense in depth if direct client access is ever added.
-- The command channel HTTP API should use SUPABASE_SERVICE_ROLE_KEY server-side only.
-- If enabling RLS, deny all direct anon/authenticated access and rely on service role
-- from the coordinator API process. Example (optional, apply separately if desired):
--
-- alter table public.command_channel_jobs enable row level security;
-- create policy "service role only" on public.command_channel_jobs
--   for all using (false);
