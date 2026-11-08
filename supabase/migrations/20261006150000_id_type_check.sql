-- Flag a document that is not the kind the customer said it was.
--
-- The form asks which ID is being uploaded, and until now nothing compared the
-- answer with the document. Someone could choose Passport and upload a Postal
-- ID, and only an Admin opening the file by eye would ever notice.
--
-- The browser now reads the card with OCR and looks for the printed header. The
-- result is passed in here as advice, not as a verdict: OCR on a photographed
-- Philippine ID fails often enough -- laminate glare, holograms over the text, a
-- dozen typefaces, a card held at an angle -- that refusing on a failed read
-- would turn away the honest majority to catch the careless few.
--
-- So a mismatch downgrades an otherwise clean pass to Flagged, where a human
-- looks. An unreadable card changes nothing.

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
  -- Tuned against the face-api.js recognition net, whose useful range for a
  -- genuine match against a photographed ID sits well below a webcam-to-webcam
  -- comparison. Set deliberately loose: a false Flag costs an Admin a minute,
  -- a false Approve costs the platform its only identity check.
  v_pass_mark  constant numeric := 0.62;
  v_floor      constant numeric := 0.35;
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
