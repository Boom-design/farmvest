-- Correct the face-match thresholds.
--
-- They were set against a similarity scale that divided by 0.6, which made
-- face-api's own published same-person distance score exactly zero. A genuine
-- match between a photographed ID and a webcam frame came out between 0.08 and
-- 0.33, well under a pass mark of 0.62, so every real customer was refused and
-- only a near-identical pair of images could pass.
--
-- The scale in src/lib/face.ts now runs to 1.0, and these marks are set for
-- what an ID-to-selfie comparison actually measures.

create or replace function public.submit_identity_verification(
  p_selfie_url    text,
  p_match_score   numeric,
  p_liveness_ok   boolean,
  p_valid_id_url  text default null,
  p_valid_id_type text default null,
  -- Null or empty when the card could not be read. 'mismatch' is the only
  -- value that changes the outcome.
  p_id_text_check text default null,
  -- What the document appeared to be instead, for the note the Admin reads.
  p_id_looks_like text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The similarity the client sends is 1 - distance, against a scale that runs
  -- to 1.0. face-api publishes 0.6 distance as its same-person mark for two
  -- ordinary photographs, which lands at 0.40 here; a photographed ID against a
  -- webcam frame is harder still and the same person routinely measures 0.40 to
  -- 0.55 distance, or 0.45 to 0.60 similarity.
  --
  -- The previous marks were set against a 0.6 scale and were therefore far
  -- stricter than the model itself recommends: a genuine ID match scored 0.08
  -- to 0.33 and every real customer was refused outright.
  --
  -- Loose on purpose. A false Flag costs an Admin a minute. A false Reject
  -- costs a real farmer their account, and they do not come back.
  v_pass_mark  constant numeric := 0.55;
  v_floor      constant numeric := 0.30;
  v_me         uuid := auth.uid();
  v_id_url     text;
  v_outcome    text;
  v_mismatch   boolean := coalesce(p_id_text_check, '') = 'mismatch';
  v_note       text;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  if coalesce(btrim(p_selfie_url), '') = '' then
    raise exception 'A live camera capture is required.';
  end if;

  -- The ID comes in with this call, because it is uploaded at the moment of
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

  -- A wrong document type is a reason to look, never a reason to refuse: the
  -- face still matched, and the likeliest explanation is that the customer
  -- picked the wrong line from a list of ten.
  if v_mismatch and v_outcome = 'Approved' then
    v_outcome := 'Flagged';
  end if;

  v_note := case
    when not p_liveness_ok then
      'Liveness challenge not completed. The capture may not be of a live person.'
    when v_outcome = 'Rejected' then
      'The face in the capture does not match the face on the government ID.'
    when v_mismatch then
      format(
        'Face matched, but the document does not read as %s. It appears to be %s. Open both and check.',
        coalesce(nullif(btrim(p_valid_id_type), ''), 'the selected type'),
        coalesce(nullif(btrim(p_id_looks_like), ''), 'another document')
      )
    when v_outcome = 'Approved' then
      'Automatic pass. Face on the live capture matched the face on the government ID.'
    else
      'Borderline match. Compare the ID and the selfie by eye before deciding.'
  end;

  update public.users
  set valid_id_url = v_id_url,
      valid_id_type = coalesce(nullif(btrim(p_valid_id_type), ''), valid_id_type),
      selfie_url = p_selfie_url,
      face_match_score = round(p_match_score, 3),
      liveness_passed_at = case when p_liveness_ok then now() else null end,
      verification_status = v_outcome,
      verified_at = case when v_outcome = 'Approved' then now() else null end,
      verification_notes = v_note
  where users_id = v_me;

  return v_outcome;
end;
$$;

comment on function public.submit_identity_verification(text, numeric, boolean, text, text, text, text) is
  'Records the result of the in-browser identity check and is the only path that may write a verification outcome. A document that reads as the wrong type downgrades a pass to Flagged rather than refusing it, because OCR on a photographed ID is unreliable and the face match is the check that matters.';

-- The five-argument version would otherwise remain callable alongside it.
drop function if exists public.submit_identity_verification(text, numeric, boolean, text, text);

revoke all on function public.submit_identity_verification(text, numeric, boolean, text, text, text, text) from public;
grant execute on function public.submit_identity_verification(text, numeric, boolean, text, text, text, text) to authenticated;
