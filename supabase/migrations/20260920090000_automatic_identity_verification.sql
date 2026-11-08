-- Identity verified by the system, with the Admin kept for the hard cases.
--
-- Approval used to be entirely manual: every new account sat Pending until an
-- Admin opened the uploaded government ID and decided. That is slow, it does
-- not scale, and it made the Admin the bottleneck on the one step standing
-- between a stranger and the platform.
--
-- The check is now done in the browser: the camera is opened, a random liveness
-- challenge is issued, and the face in the live capture is matched against the
-- face on the uploaded ID. A clear pass is approved on the spot. Anything
-- borderline is Flagged and reaches an Admin with the score and both images
-- attached, so a real farmer whose ID photograph is fifteen years old is not
-- permanently locked out by a threshold.
--
-- ---------------------------------------------------------------------------
-- What this is not
-- ---------------------------------------------------------------------------
--
-- The match runs on the user's own device, so the score arriving here is
-- asserted by the client and cannot be trusted the way a server-side check
-- could be. Re-running the model in an Edge Function would fix that and is the
-- right answer at scale.
--
-- What this design does instead is make the assertion expensive to abuse and
-- cheap to audit: the selfie and the ID are both stored, the score is recorded
-- beside them, only this function may write a verification outcome, and an
-- Admin can pull up any account and look at the two pictures. A forged score
-- still leaves two photographs on the record that do not match, which is
-- exactly the evidence a dispute would turn on.

-- ---------------------------------------------------------------------------
-- The evidence
-- ---------------------------------------------------------------------------

alter table public.users
  -- Object path in the private valid-ids bucket, beside the ID it was matched
  -- against. Never a public URL: this is a photograph of someone's face.
  add column if not exists selfie_url text,
  -- 0 to 1. Distance-based, so higher is more alike.
  add column if not exists face_match_score numeric(4, 3),
  add column if not exists liveness_passed_at timestamptz,
  -- Why the system decided what it decided, in words the Admin can act on.
  add column if not exists verification_notes text not null default 'None';

comment on column public.users.selfie_url is
  'Live camera capture taken during verification, stored as evidence beside the government ID it was matched against.';

comment on column public.users.face_match_score is
  'Similarity between the face on the ID and the face in the live capture, 0 to 1. Asserted by the client, so it is evidence rather than proof; the two images are kept so an Admin can check it by eye.';

comment on column public.users.liveness_passed_at is
  'When the random liveness challenge was completed. Null means the capture was never proven live.';

-- ---------------------------------------------------------------------------
-- A third outcome
-- ---------------------------------------------------------------------------

alter table public.users drop constraint if exists users_verification_status_check;

alter table public.users
  add constraint users_verification_status_check
  check (verification_status in ('Pending', 'Flagged', 'Approved', 'Rejected'));

comment on column public.users.verification_status is
  'Pending before verification is attempted, Approved on a clear automatic pass, Flagged when the score was borderline and a human should look, Rejected when an Admin decided against it.';

-- ---------------------------------------------------------------------------
-- Users may not grade their own homework
-- ---------------------------------------------------------------------------

-- The existing policy allows a user to update their own row, and a row policy
-- cannot restrict which columns. That means any signed-in user could until now
-- have set their own verification_status to 'Approved' with one PATCH, and the
-- same for account_status and user_type. Column privileges are the only thing
-- that actually closes it.
revoke update on public.users from authenticated;

grant update (name, contact_number, avatar_url) on public.users to authenticated;

-- The Admin acts through policies that call is_admin(), which runs as its
-- owner, so this revoke does not touch the Admin's own screens.

-- ---------------------------------------------------------------------------
-- The only writer of a verification outcome
-- ---------------------------------------------------------------------------

create or replace function public.submit_identity_verification(
  p_selfie_url    text,
  p_match_score   numeric,
  p_liveness_ok   boolean
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
  v_has_id     boolean;
  v_outcome    text;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  if coalesce(btrim(p_selfie_url), '') = '' then
    raise exception 'A live camera capture is required.';
  end if;

  -- There is nothing to match against without the government ID, so this is a
  -- state error rather than a failed check.
  select valid_id_url is not null into v_has_id
  from public.users
  where users_id = v_me;

  if not coalesce(v_has_id, false) then
    raise exception 'Upload your valid ID before verifying.';
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
  set selfie_url = p_selfie_url,
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

comment on function public.submit_identity_verification(text, numeric, boolean) is
  'Records the result of the in-browser identity check and is the only path that may write a verification outcome. Approves a clear pass, flags a borderline one for an Admin, and rejects a clear failure.';

revoke all on function public.submit_identity_verification(text, numeric, boolean) from public;
grant execute on function public.submit_identity_verification(text, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The signup trigger stops pretending an Admin is coming
-- ---------------------------------------------------------------------------

comment on column public.users.verified_at is
  'When verification passed. Set by submit_identity_verification on an automatic pass, or by an Admin clearing a flag.';
