-- Verification moves to the point where it matters.
--
-- Identity was checked at registration, which put the hardest step of the whole
-- product in front of the easiest decision a visitor makes. Someone who wants
-- to look at open projects, or to fund one with their own money, was asked for
-- a government ID and a live camera capture before they had seen anything.
--
-- The question "is this a real farmer" is only worth asking when someone starts
-- asking other people for money, so that is where it is asked. Registration is
-- now name, email, contact number and a password, and the account is usable
-- immediately. Posting a project is what requires the government ID and the
-- face match.
--
-- verification_status keeps its name and its values. What changed is what it
-- gates: it used to decide whether an account could sign in, and now it decides
-- whether an account can post a project. Browsing, investing and renting are
-- open to anyone signed in, because in all three the customer is spending their
-- own money rather than asking for someone else's.

comment on column public.users.verification_status is
  'Pending until the customer verifies their identity, which is required to post a project and to nothing else. Approved on a clear automatic face match, Flagged when the match was borderline and an Admin should look, Rejected when an Admin decided against it.';

-- ---------------------------------------------------------------------------
-- A new account is usable straight away
-- ---------------------------------------------------------------------------

-- The ID is no longer collected at signup, so the two columns that carried it
-- from the metadata have nothing to carry. They stay on the table: they are
-- filled in later, when the customer verifies in order to post.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_type text;
begin
  if new.email = public.admin_email() then
    resolved_type := 'Admin';
  else
    resolved_type := 'Customer';
  end if;

  insert into public.users (
    users_id, name, email, contact_number, user_type, verification_status, verified_at,
    suspended_reason, valid_id_type, valid_id_url
  )
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), 'None'),
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'contact_number'), ''), 'None'),
    resolved_type,
    -- The Admin is verified by being the Admin. A customer is Pending until
    -- they choose to post a project, which is not a queue anyone is waiting in.
    case when resolved_type = 'Admin' then 'Approved' else 'Pending' end,
    case when resolved_type = 'Admin' then now() else null end,
    'None',
    'None',
    null
  )
  on conflict (users_id) do nothing;

  if resolved_type = 'Customer' then
    insert into public.customers (
      customers_id, farm_location, farm_province, farm_city, farm_barangay
    )
    values (new.id, 'None', 'None', 'None', 'None')
    on conflict (customers_id) do nothing;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The ID arrives with the verification, not with the account
-- ---------------------------------------------------------------------------

create or replace function public.submit_identity_verification(
  p_selfie_url    text,
  p_match_score   numeric,
  p_liveness_ok   boolean,
  p_valid_id_url  text default null,
  p_valid_id_type text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Tuned against the face-api.js recognition net, whose useful range for a
  -- genuine match against a photographed ID sits well below a webcam-to-webcam
  -- comparison. Set deliberately loose: a false Flag costs an Admin a minute,
  -- a false Approve costs the platform its only identity check.
  v_pass_mark  constant numeric := 0.62;
  v_floor      constant numeric := 0.35;
  v_me         uuid := auth.uid();
  v_id_url     text;
  v_outcome    text;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  if coalesce(btrim(p_selfie_url), '') = '' then
    raise exception 'A live camera capture is required.';
  end if;

  -- The ID now comes in with this call, because it is uploaded at the moment of
  -- verification rather than at signup. An earlier one is reused if the
  -- customer is verifying a second time.
  select coalesce(nullif(btrim(p_valid_id_url), ''), valid_id_url)
  into v_id_url
  from public.users
  where users_id = v_me;

  if v_id_url is null then
    raise exception 'Upload your valid ID to verify.';
  end if;

  -- A capture that was never proven live is worth nothing, however well it
  -- scores: a photograph held up to the camera scores perfectly.
  if not p_liveness_ok then
    v_outcome := 'Flagged';
  elsif p_match_score >= v_pass_mark then
    v_outcome := 'Approved';
  elsif p_match_score >= v_floor then
    v_outcome := 'Flagged';
  else
    v_outcome := 'Rejected';
  end if;

  update public.users
  set valid_id_url = v_id_url,
      valid_id_type = coalesce(nullif(btrim(p_valid_id_type), ''), valid_id_type),
      selfie_url = p_selfie_url,
      face_match_score = round(p_match_score, 3),
      liveness_passed_at = case when p_liveness_ok then now() else null end,
      verification_status = v_outcome,
      verified_at = case when v_outcome = 'Approved' then now() else null end,
      verification_notes = case
        when not p_liveness_ok then
          'Liveness challenge not completed. The capture may not be of a live person.'
        when v_outcome = 'Approved' then
          'Automatic pass. Face on the live capture matched the face on the government ID.'
        when v_outcome = 'Flagged' then
          'Borderline match. Compare the ID and the selfie by eye before deciding.'
        else
          'The face in the capture does not match the face on the government ID.'
      end
  where users_id = v_me;

  return v_outcome;
end;
$$;

comment on function public.submit_identity_verification(text, numeric, boolean, text, text) is
  'Records the result of the in-browser identity check and is the only path that may write a verification outcome. Called when a customer verifies in order to post a project, so it also files the government ID that was uploaded with it.';

-- The old three-argument version would otherwise remain callable alongside it.
drop function if exists public.submit_identity_verification(text, numeric, boolean);

revoke all on function public.submit_identity_verification(text, numeric, boolean, text, text) from public;
grant execute on function public.submit_identity_verification(text, numeric, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Only a verified customer may post
-- ---------------------------------------------------------------------------

-- Enforced here and not only in the form. The form is a convenience; this is
-- the rule.
--
-- The original policy was a single "for all", which covered insert, update and
-- delete together. Only insert needs the verification test -- a customer who is
-- later flagged must still be able to edit or cancel what they already posted
-- -- so the one policy becomes three.

drop policy if exists "Farm owners manage their own projects" on public.projects;
drop policy if exists "Customers create their own projects" on public.projects;
drop policy if exists "Customers edit their own projects" on public.projects;
drop policy if exists "Customers delete their own projects" on public.projects;

create policy "Customers create their own projects"
  on public.projects for insert to authenticated
  with check (
    auth.uid() = customers_id
    and exists (
      select 1 from public.users u
      where u.users_id = auth.uid()
        and u.verification_status = 'Approved'
        and u.account_status = 'Active'
    )
  );

create policy "Customers edit their own projects"
  on public.projects for update to authenticated
  using (auth.uid() = customers_id)
  with check (auth.uid() = customers_id);

create policy "Customers delete their own projects"
  on public.projects for delete to authenticated
  using (auth.uid() = customers_id);
