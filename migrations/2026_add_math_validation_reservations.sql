-- BrightBridge PH: quota/attempt reservation system for server-authoritative
-- Math validation. NOT YET APPLIED -- run manually in the Supabase SQL
-- Editor only after approval. See the accompanying deployment notes.

-- ---------- 1. New columns on usage_logs ----------
alter table public.usage_logs
  add column if not exists provider_call_count integer not null default 1,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists validation_status text,
  add column if not exists is_chargeable boolean not null default true,
  add column if not exists reservation_expires_at timestamptz;

-- Existing historical rows must remain chargeable. This is also the
-- column's DEFAULT (and in modern Postgres, ADD COLUMN ... DEFAULT true is
-- a metadata-only operation that already backfills every existing row --
-- no table rewrite), stated explicitly here for clarity and safety.
update public.usage_logs set is_chargeable = true where is_chargeable is null;

create index if not exists usage_logs_user_created_idx
  on public.usage_logs (user_id, created_at);

alter table public.usage_logs
  add constraint usage_logs_validation_status_check
  check (validation_status is null or validation_status in (
    'reserved', 'retrying', 'validated', 'failed_validation',
    'provider_error', 'expired_after_success', 'expired'
  ));


-- ---------- 2. reserve_usage_slot ----------
-- Atomically checks AND consumes one quota slot and one provider-attempt
-- slot in a single transaction, so concurrent requests from the same user
-- can never double-book either. SECURITY DEFINER with an empty search_path
-- and fully schema-qualified references, per the RPC execution security
-- requirement below.
create or replace function public.reserve_usage_slot(
  p_user_id uuid,
  p_quota_since timestamptz,
  p_quota_limit integer,
  p_attempt_since timestamptz,
  p_attempt_limit integer,
  p_subject text,
  p_mode text,
  p_grade text,
  p_topic text,
  p_difficulty text,
  p_activity_type text,
  p_dysgraphia boolean,
  p_simplified boolean,
  p_attention boolean,
  p_processing boolean,
  p_email text,
  p_reservation_ttl interval default interval '5 minutes'
) returns table (reserved boolean, reservation_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_count integer;
  v_quota_count integer;
  v_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  -- Serializes only THIS user's concurrent requests against each other;
  -- no contention with other users' traffic.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user_id::text));

  -- PERMANENT provider-attempt accounting: unconditional sum, no expiry
  -- filter. Once a real (or about-to-be-real) attempt is recorded it
  -- always counts, even if the surrounding reservation later expires.
  select coalesce(sum(provider_call_count), 0) into v_attempt_count
  from public.usage_logs
  where user_id = p_user_id
    and created_at >= p_attempt_since;

  if v_attempt_count >= p_attempt_limit then
    return query select false, null::uuid, 'provider_attempt_limit_exceeded';
    return;
  end if;

  -- TEMPORARY quota accounting: validated chargeable rows PLUS active
  -- (non-expired) reservations only.
  select count(*) into v_quota_count
  from public.usage_logs
  where user_id = p_user_id
    and created_at >= p_quota_since
    and (
      is_chargeable = true
      or (validation_status in ('reserved', 'retrying') and reservation_expires_at > v_now)
    );

  if v_quota_count >= p_quota_limit then
    return query select false, null::uuid, 'quota_exceeded';
    return;
  end if;

  -- Claim both slots NOW, while still holding the lock: provider_call_count
  -- = 1 represents the imminent first Anthropic call.
  insert into public.usage_logs (
    user_id, email, subject, mode, grade, topic, difficulty, activity_type,
    dysgraphia_support, simplified_support, attention_support, processing_support,
    is_chargeable, validation_status, provider_call_count, reservation_expires_at
  ) values (
    p_user_id, p_email, p_subject, p_mode, p_grade, p_topic, p_difficulty, p_activity_type,
    p_dysgraphia, p_simplified, p_attention, p_processing,
    false, 'reserved', 1, v_now + p_reservation_ttl
  ) returning id into v_id;

  return query select true, v_id, null::text;
end;
$$;

revoke execute on function public.reserve_usage_slot(
  uuid, timestamptz, integer, timestamptz, integer,
  text, text, text, text, text, text, boolean, boolean, boolean, boolean, text, interval
) from public, anon, authenticated;
grant execute on function public.reserve_usage_slot(
  uuid, timestamptz, integer, timestamptz, integer,
  text, text, text, text, text, text, boolean, boolean, boolean, boolean, text, interval
) to service_role;


-- ---------- 3. reserve_provider_retry ----------
-- Called only when the first attempt fails Math validation. Re-checks the
-- provider-attempt budget AND that the reservation has not already expired
-- before allowing the transition reserved -> retrying.
create or replace function public.reserve_provider_retry(
  p_reservation_id uuid,
  p_user_id uuid,
  p_attempt_since timestamptz,
  p_attempt_limit integer,
  p_reservation_ttl interval default interval '5 minutes'
) returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
  v_expires_at timestamptz;
  v_attempt_count_excluding_self integer;
  v_now timestamptz := pg_catalog.now();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user_id::text));

  select validation_status, reservation_expires_at
    into v_current_status, v_expires_at
  from public.usage_logs
  where id = p_reservation_id and user_id = p_user_id
  for update;

  if v_current_status is null then
    return query select false, 'reservation_not_found';
    return;
  end if;

  if v_current_status <> 'reserved' then
    return query select false, 'reservation_not_retryable';
    return;
  end if;

  -- A row still labeled 'reserved' whose TTL has already silently elapsed
  -- must not be allowed to spring back to life via a retry.
  if v_expires_at <= v_now then
    return query select false, 'reservation_expired';
    return;
  end if;

  select coalesce(sum(provider_call_count), 0) into v_attempt_count_excluding_self
  from public.usage_logs
  where user_id = p_user_id
    and created_at >= p_attempt_since
    and id <> p_reservation_id;

  -- This reservation is about to become worth 2 total attempts (it already
  -- holds 1; we're adding 1 more) -- check the resulting TOTAL against the
  -- ceiling before committing to the second call.
  if v_attempt_count_excluding_self + 2 > p_attempt_limit then
    return query select false, 'provider_attempt_limit_exceeded';
    return;
  end if;

  update public.usage_logs
  set provider_call_count = 2,
      validation_status = 'retrying',
      reservation_expires_at = v_now + p_reservation_ttl
  where id = p_reservation_id;

  return query select true, null::text;
end;
$$;

revoke execute on function public.reserve_provider_retry(
  uuid, uuid, timestamptz, integer, interval
) from public, anon, authenticated;
grant execute on function public.reserve_provider_retry(
  uuid, uuid, timestamptz, integer, interval
) to service_role;


-- ---------- 4. finalize_validated_generation ----------
-- The ONLY path that may mark a reservation chargeable. Atomic, locked, and
-- re-verifies the reservation has not expired before granting -- this is
-- what closes the "late finalization after expiry" race.
create or replace function public.finalize_validated_generation(
  p_reservation_id uuid,
  p_user_id uuid,
  p_input_tokens integer,
  p_output_tokens integer
) returns table (finalized boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_expires_at timestamptz;
  v_now timestamptz := pg_catalog.now();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user_id::text));

  select validation_status, reservation_expires_at into v_status, v_expires_at
  from public.usage_logs
  where id = p_reservation_id and user_id = p_user_id
  for update;

  if v_status is null then
    return query select false, 'reservation_not_found';
    return;
  end if;

  if v_status not in ('reserved', 'retrying') then
    return query select false, 'already_finalized';
    return;
  end if;

  if v_expires_at <= v_now then
    -- Late success after expiry: do NOT reclaim the quota slot or mark
    -- chargeable. The API call genuinely happened and was genuinely
    -- billed, so the token spend is still recorded -- just not the
    -- worksheet delivery or the charge.
    update public.usage_logs
    set validation_status = 'expired_after_success',
        input_tokens = p_input_tokens,
        output_tokens = p_output_tokens
    where id = p_reservation_id;

    return query select false, 'reservation_expired';
    return;
  end if;

  update public.usage_logs
  set is_chargeable = true,
      validation_status = 'validated',
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      reservation_expires_at = null
  where id = p_reservation_id;

  return query select true, null::text;
end;
$$;

revoke execute on function public.finalize_validated_generation(
  uuid, uuid, integer, integer
) from public, anon, authenticated;
grant execute on function public.finalize_validated_generation(
  uuid, uuid, integer, integer
) to service_role;


-- ---------- 5. Failure-path finalization: NOT an RPC, by design ----------
-- generate.js marks a reservation FAILED (releasing, never granting,
-- capacity) via a plain PATCH to /rest/v1/usage_logs?id=eq...&user_id=eq...
-- using the service-role key. This needs no lock/expiry-check machinery
-- because releasing capacity can never race against a concurrent request
-- the way granting it can. It is already restricted to service_role in
-- practice: the existing usage_logs RLS policies (see original schema)
-- grant INSERT/SELECT to the owning user but no UPDATE policy exists for
-- anon/authenticated at all -- only a role that bypasses RLS (service_role)
-- can UPDATE this table today. The id+user_id filter in the PATCH URL is
-- an additional, defensive ownership check on top of that.
