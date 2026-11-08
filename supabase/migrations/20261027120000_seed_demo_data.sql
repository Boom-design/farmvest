-- Demo data for the defense.
--
-- Eight customer accounts, five projects, investments with signed agreements,
-- progress updates, six rentals spread across every stage of the rental flow,
-- a review, an open dispute and one flagged verification. Every account signs
-- in with the password Farmvest@2026.
--
-- Like the test-account clear before it, this is data in migration history
-- only because the CLI offers no other way to reach the database. It is
-- guarded: if the first demo account already exists, nothing runs, so pushing
-- it twice cannot double the data.
--
-- Uploaded files are not created. Project documents and IDs point at paths
-- that hold no file, so opening one from the Admin review shows an error; the
-- project cover and progress photos use /seed/farm.png from the app itself.

do $$
declare
  pw text := extensions.crypt('Farmvest@2026', extensions.gen_salt('bf'));
  cdo text := 'Cagayan De Oro City (Capital)';
  mo text := 'Misamis Oriental';
  photo text := '/seed/farm.png';

  u_juan uuid := gen_random_uuid();
  u_maria uuid := gen_random_uuid();
  u_pedro uuid := gen_random_uuid();
  u_rosa uuid := gen_random_uuid();
  u_carlo uuid := gen_random_uuid();
  u_ana uuid := gen_random_uuid();
  u_mark uuid := gen_random_uuid();
  u_liza uuid := gen_random_uuid();

  p_broiler uuid := gen_random_uuid();
  p_swine uuid := gen_random_uuid();
  p_goat uuid := gen_random_uuid();
  p_tilapia uuid := gen_random_uuid();
  p_native uuid := gen_random_uuid();

  e uuid[];
  pm uuid;
  r uuid;
  i uuid;
  acct record;
begin
  if exists (select 1 from auth.users where email = 'juan.delacruz@farmvest.test') then
    raise notice 'Demo data already present; nothing to do.';
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- Accounts. The signup trigger writes users and customers from the metadata.
  -- -------------------------------------------------------------------------
  for acct in
    select * from (values
      (u_juan,  'juan.delacruz@farmvest.test',  'Juan Dela Cruz',   '09171234501', 'Lumbia',    cdo),
      (u_maria, 'maria.santos@farmvest.test',   'Maria Santos',     '09171234502', 'Poblacion', 'Opol'),
      (u_pedro, 'pedro.reyes@farmvest.test',    'Pedro Reyes',      '09171234503', 'Poblacion', 'City Of El Salvador'),
      (u_rosa,  'rosa.villanueva@farmvest.test','Rosa Villanueva',  '09171234504', 'Poblacion', 'Tagoloan'),
      (u_carlo, 'carlo.mendoza@farmvest.test',  'Carlo Mendoza',    '09171234505', 'Bulua',     cdo),
      (u_ana,   'ana.lim@farmvest.test',        'Ana Lim',          '09171234506', 'Bulua',     cdo),
      (u_mark,  'mark.bautista@farmvest.test',  'Mark Bautista',    '09171234507', 'Lumbia',    cdo),
      (u_liza,  'liza.gomez@farmvest.test',     'Liza Gomez',       '09171234508', 'Poblacion', 'Opol')
    ) as t(id, email, name, phone, barangay, city)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    )
    values (
      '00000000-0000-0000-0000-000000000000', acct.id, 'authenticated', 'authenticated',
      acct.email, pw, now() - interval '30 days',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'name', acct.name,
        'contact_number', acct.phone,
        'farm_location', acct.barangay || ', ' || acct.city || ', ' || mo,
        'farm_province', mo,
        'farm_city', acct.city,
        'farm_barangay', acct.barangay
      ),
      now() - interval '30 days', now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
    )
    values (
      gen_random_uuid(), acct.id, acct.id::text, 'email',
      jsonb_build_object('sub', acct.id::text, 'email', acct.email, 'email_verified', true),
      now(), now(), now()
    );
  end loop;

  -- Farm owners verified through the face check; Carlo left Flagged for review.
  update public.users
  set verification_status = 'Approved',
      verified_at = now() - interval '25 days',
      liveness_passed_at = now() - interval '25 days',
      face_match_score = 0.680,
      valid_id_type = 'PhilSys National ID',
      valid_id_url = users_id || '/seed-id.jpg',
      verification_notes = 'Clear match at verification.'
  where users_id in (u_juan, u_maria, u_pedro, u_rosa);

  update public.users
  set verification_status = 'Flagged',
      liveness_passed_at = now() - interval '2 hours',
      face_match_score = 0.520,
      valid_id_type = 'Driver''s License',
      valid_id_url = users_id || '/seed-id.jpg',
      verification_notes = 'Face match 52%, under the automatic pass mark. Needs a human look.'
  where users_id = u_carlo;

  update public.customers set investment_budget = 50000 where customers_id = u_ana;
  update public.customers set investment_budget = 20000 where customers_id = u_mark;
  update public.customers set investment_budget = 100000 where customers_id = u_liza;

  -- -------------------------------------------------------------------------
  -- Projects
  -- -------------------------------------------------------------------------
  insert into public.projects (
    projects_id, customers_id, title, description, category, image_url, funding_goal,
    current_funding, status, rejection_reason, reviewed_at, rsbsa_name, rsbsa_number,
    expected_roi_percent, expected_cycle_days, collateral_type, collateral_description,
    collateral_value, created_at
  )
  values
    (p_broiler, u_juan, 'Broiler Production - 500 Heads',
     'A 45-day broiler cycle for 500 heads in an existing coop in Lumbia. Funds cover chicks, feed and vaccines.',
     'Poultry', photo, 60000, 35000, 'Open', 'None', now() - interval '20 days',
     'Juan Dela Cruz', '10-43-05-001-00123', 12, 45,
     'Land Title (TCT or OCT)', 'TCT No. T-12345, Juan Dela Cruz, 800 square metres in Lumbia.',
     150000, now() - interval '21 days'),
    (p_swine, u_maria, 'Swine Fattening - 10 Heads',
     'Ten weanlings raised to market weight over four months in Opol. Funds cover piglets, feed and pen repair.',
     'Swine', photo, 80000, 80000, 'Funded', 'None', now() - interval '18 days',
     'Maria Santos', '10-43-17-002-00456', 15, 120,
     'Tax Declaration on Land', 'Tax Declaration No. 2024-0789, Poblacion, Opol, assessed at PHP 120,000.',
     120000, now() - interval '19 days'),
    (p_goat, u_pedro, 'Goat Breeding Expansion',
     'Adds five does and one buck to a small herd in El Salvador. Funds cover the animals and a raised shelter.',
     'Goat', photo, 25000, 5000, 'Open', 'None', now() - interval '10 days',
     'None', 'None', 10, 180,
     'Vehicle (OR and CR)', 'Honda XRM 125, 2019, plate number 123ABC.',
     60000, now() - interval '11 days'),
    (p_tilapia, u_rosa, 'Tilapia Grow-Out Pond',
     'A 4-month tilapia grow-out in a 300 square metre pond in Tagoloan. Funds cover fingerlings and feed.',
     'Fish', photo, 40000, 0, 'Pending Approval', 'None', null,
     'None', 'None', 12, 120,
     'Farm Equipment or Machinery', 'Kubota hand tractor, serial KHT-20931.',
     50000, now() - interval '1 day'),
    (p_native, u_juan, 'Native Chicken Layer Flock',
     'Fifty native hens for egg production.',
     'Poultry', null, 30000, 0, 'Rejected',
     'The collateral document is unreadable. Upload a clearer copy of the land title.',
     now() - interval '5 days', 'Juan Dela Cruz', '10-43-05-001-00123', 10, 90,
     'Livestock in this Project', 'Fifty native hens.', 30000, now() - interval '6 days');

  insert into public.project_documents (projects_id, doc_type, file_url, file_name)
  select p, d, p || '/' || f, f
  from (values
    (p_broiler, 'RSBSA Registration', 'rsbsa.jpg'),
    (p_broiler, 'Barangay or LGU Certification', 'barangay-cert.jpg'),
    (p_broiler, 'Collateral Proof', 'land-title.jpg'),
    (p_broiler, 'Farm Photo', 'coop.jpg'),
    (p_swine, 'RSBSA Registration', 'rsbsa.jpg'),
    (p_swine, 'Proof of Land', 'tax-declaration.jpg'),
    (p_swine, 'Collateral Proof', 'tax-declaration.jpg'),
    (p_swine, 'Farm Photo', 'pen.jpg'),
    (p_goat, 'Barangay or LGU Certification', 'barangay-cert.jpg'),
    (p_goat, 'Proof of Land', 'land-proof.jpg'),
    (p_goat, 'Collateral Proof', 'or-cr.jpg'),
    (p_goat, 'Farm Photo', 'shelter.jpg'),
    (p_tilapia, 'Barangay or LGU Certification', 'barangay-cert.jpg'),
    (p_tilapia, 'Business Permit', 'business-permit.jpg'),
    (p_tilapia, 'Veterinary or Facility Permit', 'bfar-permit.jpg'),
    (p_tilapia, 'Collateral Proof', 'equipment-receipt.jpg'),
    (p_tilapia, 'Farm Photo', 'pond.jpg')
  ) as t(p, d, f);

  -- -------------------------------------------------------------------------
  -- Investments, each with the agreement it was signed under
  -- -------------------------------------------------------------------------
  for acct in
    select * from (values
      (u_ana,  p_broiler, 20000::numeric, 'Ana Lim',       12, now() - interval '15 days'),
      (u_mark, p_broiler, 15000::numeric, 'Mark Bautista', 12, now() - interval '12 days'),
      (u_liza, p_swine,   50000::numeric, 'Liza Gomez',    15, now() - interval '16 days'),
      (u_ana,  p_swine,   30000::numeric, 'Ana Lim',       15, now() - interval '14 days'),
      (u_mark, p_goat,     5000::numeric, 'Mark Bautista', 10, now() - interval '3 days')
    ) as t(investor, project, amount, signer, roi, at)
  loop
    i := gen_random_uuid();
    insert into public.investments (investments_id, customers_id, projects_id, amount, milestone_stage, created_at)
    values (i, acct.investor, acct.project, acct.amount, 'Initial', acct.at);

    insert into public.contracts (investments_id, signatory_name, signed_at, terms_version, terms_snapshot, agreed_amount)
    values (
      i, acct.signer, acct.at, 'v1',
      'FarmVest Investment Agreement. The investor funds PHP ' || to_char(acct.amount, 'FM999,999,990.00')
        || ' toward this project. The farm owner undertakes to return the amount plus '
        || acct.roi || '% at the end of the production cycle, secured by the pledged collateral. '
        || 'FarmVest records the agreement and charges a 5% platform commission.',
      acct.amount
    );
  end loop;

  insert into public.progress_updates (projects_id, photo_url, notes, captured_at, created_at)
  values
    (p_swine, photo, 'Ten weanlings delivered and settled in the repaired pen. All eating well.',
     now() - interval '9 days', now() - interval '9 days'),
    (p_swine, photo, 'Week 2: average weight up to 22 kg. First deworming done.',
     now() - interval '2 days', now() - interval '2 days'),
    (p_broiler, photo, 'Coop cleaned and disinfected ahead of the chicks arriving.',
     now() - interval '4 days', now() - interval '4 days');

  -- -------------------------------------------------------------------------
  -- Rentals, one at each stage. Units are taken from the existing fleet.
  -- -------------------------------------------------------------------------
  select array_agg(equipment_id order by unit_code) into e from public.equipment;

  if coalesce(array_length(e, 1), 0) < 6 then
    raise notice 'Fewer than six equipment units; rentals skipped.';
  else
    select payment_methods_id into pm from public.payment_methods where is_active order by created_at limit 1;
    if pm is null then
      insert into public.payment_methods (method, account_name, account_number, instructions)
      values ('GCash', 'FarmVest Agri Ventures', '09170000000', 'Send the exact amount and keep the reference number.')
      returning payment_methods_id into pm;
    end if;

    -- Completed, returned with minor damage and charged for the repair.
    r := gen_random_uuid();
    insert into public.rentals (rentals_id, customers_id, equipment_id, start_date, end_date, status,
      dispatched_at, delivery_window, driver_name, driver_contact, delivered_at, received_by,
      returned_at, return_condition, damage_notes, damage_charge, created_at)
    values (r, u_juan, e[1], current_date - 17, current_date - 15, 'Completed',
      now() - interval '17 days', 'morning (8AM to 12NN)', 'Rodel Cabahug', '09181112233',
      now() - interval '17 days', 'Juan Dela Cruz',
      current_date - 15, 'Minor Damage', 'Flat left tire and a broken throttle cable.', 1200,
      now() - interval '20 days');
    insert into public.payments (rentals_id, payment_methods_id, amount, payment_type, reference_no, status, submitted_at, reviewed_at, reviewed_by)
    select r, pm, 3 * price_per_day, 'Full', '1002345678901', 'Confirmed', now() - interval '20 days', now() - interval '19 days', public.admin_email()
    from public.equipment where equipment_id = e[1];
    insert into public.contracts (rentals_id, signatory_name, signed_at, terms_snapshot, agreed_amount)
    select r, 'Juan Dela Cruz', now() - interval '20 days',
      'FarmVest Rental Agreement. Daily rate, inclusive day count. The renter is liable for damage beyond normal wear.', 3 * price_per_day
    from public.equipment where equipment_id = e[1];
    insert into public.maintenance_logs (equipment_id, rentals_id, service_date, service_type, description, cost)
    values (e[1], r, current_date - 14, 'Repair', 'Flat left tire and a broken throttle cable.', 1200);

    -- Active: delivered and confirmed by the farm owner.
    r := gen_random_uuid();
    insert into public.rentals (rentals_id, customers_id, equipment_id, start_date, end_date, status,
      dispatched_at, delivery_window, driver_name, driver_contact, delivered_at, received_by, created_at)
    values (r, u_maria, e[2], current_date - 1, current_date + 2, 'Active',
      now() - interval '1 day', 'morning (8AM to 12NN)', 'Rodel Cabahug', '09181112233',
      now() - interval '1 day', 'Maria Santos', now() - interval '5 days');
    insert into public.payments (rentals_id, payment_methods_id, amount, payment_type, reference_no, status, submitted_at, reviewed_at, reviewed_by)
    select r, pm, 4 * price_per_day, 'Full', '1002345678902', 'Confirmed', now() - interval '5 days', now() - interval '4 days', public.admin_email()
    from public.equipment where equipment_id = e[2];
    insert into public.contracts (rentals_id, signatory_name, signed_at, terms_snapshot, agreed_amount)
    select r, 'Maria Santos', now() - interval '5 days',
      'FarmVest Rental Agreement. Daily rate, inclusive day count. The renter is liable for damage beyond normal wear.', 4 * price_per_day
    from public.equipment where equipment_id = e[2];

    -- Out for Delivery: waiting for Pedro to confirm receipt.
    r := gen_random_uuid();
    insert into public.rentals (rentals_id, customers_id, equipment_id, start_date, end_date, status,
      dispatched_at, delivery_window, driver_name, driver_contact, created_at)
    values (r, u_pedro, e[3], current_date + 1, current_date + 3, 'Out for Delivery',
      now(), to_char(current_date + 1, 'Mon FMDD, YYYY') || ', morning (8AM to 12NN)', 'Jun Pacana', '09184445566',
      now() - interval '4 days');
    insert into public.payments (rentals_id, payment_methods_id, amount, payment_type, reference_no, status, submitted_at, reviewed_at, reviewed_by)
    select r, pm, 1.5 * price_per_day, '50% Downpayment', '1002345678903', 'Confirmed', now() - interval '4 days', now() - interval '3 days', public.admin_email()
    from public.equipment where equipment_id = e[3];
    insert into public.contracts (rentals_id, signatory_name, signed_at, terms_snapshot, agreed_amount)
    select r, 'Pedro Reyes', now() - interval '4 days',
      'FarmVest Rental Agreement. Daily rate, inclusive day count. The renter is liable for damage beyond normal wear.', 3 * price_per_day
    from public.equipment where equipment_id = e[3];

    -- Pending with a submitted payment: the Admin's next job.
    r := gen_random_uuid();
    insert into public.rentals (rentals_id, customers_id, equipment_id, start_date, end_date, status, created_at)
    values (r, u_rosa, e[4], current_date + 7, current_date + 8, 'Pending', now() - interval '3 hours');
    insert into public.payments (rentals_id, payment_methods_id, amount, payment_type, reference_no, status, submitted_at)
    select r, pm, 2 * price_per_day, 'Full', '1002345678904', 'Submitted', now() - interval '3 hours'
    from public.equipment where equipment_id = e[4];
    insert into public.contracts (rentals_id, signatory_name, signed_at, terms_snapshot, agreed_amount)
    select r, 'Rosa Villanueva', now() - interval '3 hours',
      'FarmVest Rental Agreement. Daily rate, inclusive day count. The renter is liable for damage beyond normal wear.', 2 * price_per_day
    from public.equipment where equipment_id = e[4];

    -- Confirmed: paid, waiting to be dispatched.
    r := gen_random_uuid();
    insert into public.rentals (rentals_id, customers_id, equipment_id, start_date, end_date, status, created_at)
    values (r, u_juan, e[5], current_date + 9, current_date + 11, 'Confirmed', now() - interval '2 days');
    insert into public.payments (rentals_id, payment_methods_id, amount, payment_type, reference_no, status, submitted_at, reviewed_at, reviewed_by)
    select r, pm, 3 * price_per_day, 'Full', '1002345678905', 'Confirmed', now() - interval '2 days', now() - interval '1 day', public.admin_email()
    from public.equipment where equipment_id = e[5];
    insert into public.contracts (rentals_id, signatory_name, signed_at, terms_snapshot, agreed_amount)
    select r, 'Juan Dela Cruz', now() - interval '2 days',
      'FarmVest Rental Agreement. Daily rate, inclusive day count. The renter is liable for damage beyond normal wear.', 3 * price_per_day
    from public.equipment where equipment_id = e[5];

    -- Cancelled under a weather advisory.
    insert into public.rentals (customers_id, equipment_id, start_date, end_date, status, admin_notes, created_at)
    values (u_maria, e[6], current_date - 8, current_date - 7, 'Cancelled',
      'Cancelled under a PAGASA wind signal for Misamis Oriental. No penalty to either side.',
      now() - interval '10 days');
  end if;

  -- -------------------------------------------------------------------------
  -- A review and an open dispute, for the Reports and Disputes page
  -- -------------------------------------------------------------------------
  insert into public.reviews (reviewer_customers_id, reviewee_customers_id, rating, comment, transaction_type)
  values (u_ana, u_maria, 5, 'Regular updates with clear photos. Very transparent.', 'Investment');

  insert into public.reports (reporter_customers_id, reported_customers_id, projects_id, category, reason, status)
  values (u_mark, u_pedro, p_goat, 'No progress updates',
    'No update posted since I invested. Messages have not been answered.', 'Open');
end;
$$;
