-- A larger body of demo data, so every report has something to show.
--
-- The first seed gave one example of each state. This one adds volume and
-- history: 32 more customers, 30 projects across every status including
-- Completed and Cancelled, six months of rentals for the revenue charts,
-- maintenance logs, reviews, and disputes in every state so Case History is
-- not empty. Passwords are Farmvest@2026, like the first seed.
--
-- Guarded on the first account it creates, so a second push does nothing.
-- History rentals all end before the first seed's rentals begin, and each unit
-- gets one rental per 30 days, so no booking overlaps another.

do $$
declare
  pw text := extensions.crypt('Farmvest@2026', extensions.gen_salt('bf'));
  mo text := 'Misamis Oriental';
  cdo text := 'Cagayan De Oro City (Capital)';
  photo text := '/seed/farm.png';

  firsts text[] := array['Jose','Elena','Ramon','Teresa','Arnel','Cristina','Dennis','Grace','Rolando','Joy',
                         'Victor','Mylene','Ernesto','Rhea','Felix','Cecilia','Noel','Lorna','Oscar','Jenny',
                         'Rogelio','Analyn','Samuel','Marites','Edgar','Divina','Benjie','Rowena','Alvin','Nenita',
                         'Ruben','Imelda'];
  lasts text[]  := array['Abella','Bacus','Cabahug','Dagondon','Emata','Fuentes','Gaabucayan','Hipolito','Ignacio','Jabonete',
                         'Labrador','Macalisang','Neri','Oclarit','Pacana','Quilab','Roa','Sabio','Tan','Uy',
                         'Velez','Yap','Zamora','Baculio','Chaves','Dumadag','Estrada','Galarrita','Lagbas','Mabao',
                         'Pabillore','Ramos'];
  barangays text[] := array['Carmen','Kauswagan','Macasandig','Balulang','Canitoan','Agusan','Bugo','Puerto',
                            'Iponan','Pagatpat','Lumbia','Bulua','Poblacion','Poblacion','Poblacion',
                            'Poblacion','Poblacion','Poblacion'];
  cities text[] := array[cdo, cdo, cdo, cdo, cdo, cdo, cdo, cdo, cdo, cdo, cdo, cdo,
                         'Opol', 'Tagoloan', 'Villanueva', 'Jasaan', 'City Of El Salvador', 'Claveria'];

  titles text[][] := array[
    array['Poultry','Broiler Grow-Out - 300 Heads'], array['Poultry','Layer Hens for Egg Supply'],
    array['Poultry','Native Chicken Free-Range Flock'], array['Swine','Hog Fattening - 8 Heads'],
    array['Swine','Sow and Litter Expansion'], array['Swine','Backyard Piggery Restock'],
    array['Cattle','Cattle Fattening - 2 Heads'], array['Cattle','Carabao for Draft and Dairy'],
    array['Goat','Dairy Goat Starter Herd'], array['Goat','Meat Goat Breeding Pair'],
    array['Fish','Tilapia Cage Culture'], array['Fish','Hito Pond Grow-Out'],
    array['Other','Duck Raising for Balut'], array['Other','Quail Egg Production']];

  -- Thirty projects: status, and how far through funding.
  statuses text[] := array[
    'Completed','Completed','Completed','Completed','Completed','Completed','Completed','Completed',
    'In Progress','In Progress','In Progress','In Progress','In Progress','In Progress',
    'Funded','Funded','Funded','Funded',
    'Open','Open','Open','Open','Open','Open',
    'Pending Approval','Pending Approval','Pending Approval',
    'Rejected','Rejected','Cancelled'];

  owners uuid[];
  investors uuid[];
  everyone uuid[];
  e uuid[];
  pm uuid;
  admin text := public.admin_email();

  uid uuid;
  pid uuid;
  rid uuid;
  iid uuid;
  n int;
  k int;
  goal numeric;
  funded numeric;
  share numeric;
  remaining numeric;
  st text;
  made timestamptz;
  start_d date;
  days int;
  rate numeric;
  cond text;
  charge numeric;
  v_email text;
  brgy text;
  city text;
begin
  if exists (select 1 from auth.users where email = 'jose.abella@farmvest.test') then
    raise notice 'Bulk demo data already present; nothing to do.';
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 32 customers: 20 who farm, 12 who only invest
  -- -------------------------------------------------------------------------
  for n in 1..32 loop
    uid := gen_random_uuid();
    v_email := lower(firsts[n] || '.' || lasts[n]) || '@farmvest.test';
    brgy := barangays[((n - 1) % 18) + 1];
    city := cities[((n - 1) % 18) + 1];

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    )
    values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      v_email, pw, now() - make_interval(days => 200 - n * 3),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'name', firsts[n] || ' ' || lasts[n],
        'contact_number', '0917' || lpad((5550000 + n * 137)::text, 7, '0'),
        'farm_location', brgy || ', ' || city || ', ' || mo,
        'farm_province', mo,
        'farm_city', city,
        'farm_barangay', brgy
      ),
      now() - make_interval(days => 200 - n * 3), now(),
      '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, 'email',
            jsonb_build_object('sub', uid::text, 'email', v_email, 'email_verified', true), now(), now(), now());

    if n <= 20 then
      owners := array_append(owners, uid);
    else
      investors := array_append(investors, uid);
      update public.customers set investment_budget = (array[10000, 25000, 50000, 75000, 150000])[(n % 5) + 1]
      where customers_id = uid;
    end if;
  end loop;

  -- Verification across every state the Admin reviews.
  update public.users
  set verification_status = 'Approved', verified_at = created_at + interval '2 days',
      liveness_passed_at = created_at + interval '2 days', face_match_score = 0.62 + random() * 0.15,
      valid_id_type = (array['PhilSys National ID','Driver''s License','UMID','Postal ID'])[1 + floor(random() * 4)::int],
      valid_id_url = users_id || '/seed-id.jpg', verification_notes = 'Clear match at verification.'
  where users_id = any (owners[1:16]);

  update public.users
  set verification_status = 'Flagged', liveness_passed_at = now() - interval '1 day', face_match_score = 0.49,
      valid_id_type = 'Voter''s ID', valid_id_url = users_id || '/seed-id.jpg',
      verification_notes = 'Face match 49%, under the automatic pass mark. Needs a human look.'
  where users_id = any (owners[17:18]);

  update public.users
  set verification_status = 'Rejected', liveness_passed_at = now() - interval '6 days', face_match_score = 0.21,
      valid_id_type = 'Passport', valid_id_url = users_id || '/seed-id.jpg',
      verification_notes = 'Rejected by the Admin: the face on the ID is a different person.'
  where users_id = owners[19];

  update public.users
  set account_status = 'Inactive', suspended_reason = 'Repeated disputes filed against this account'
  where users_id = owners[20];

  select array_agg(customers_id) into everyone from public.customers c
  join public.users u on u.users_id = c.customers_id
  where u.email like '%@farmvest.test' and u.account_status = 'Active';

  investors := investors || array(
    select users_id from public.users
    where email in ('ana.lim@farmvest.test', 'mark.bautista@farmvest.test', 'liza.gomez@farmvest.test'));

  -- -------------------------------------------------------------------------
  -- 30 projects, oldest first, each with documents
  -- -------------------------------------------------------------------------
  for n in 1..30 loop
    pid := gen_random_uuid();
    st := statuses[n];
    uid := owners[((n - 1) % 16) + 1];
    goal := (array[20000, 30000, 45000, 60000, 80000, 100000])[(n % 6) + 1];
    made := now() - make_interval(days => 185 - n * 5);
    funded := case
      when st in ('Completed', 'In Progress', 'Funded') then goal
      when st = 'Open' then round(goal * (0.2 + (n % 5) * 0.15) / 500) * 500
      else 0 end;

    insert into public.projects (
      projects_id, customers_id, title, description, category, image_url, funding_goal, current_funding,
      status, rejection_reason, reviewed_at, rsbsa_name, rsbsa_number, expected_roi_percent,
      expected_cycle_days, collateral_type, collateral_description, collateral_value, created_at
    )
    values (
      pid, uid, titles[((n - 1) % 14) + 1][2],
      'A ' || lower(titles[((n - 1) % 14) + 1][1]) || ' project in Misamis Oriental. Funds cover stock, feed and facility upkeep for one production cycle.',
      titles[((n - 1) % 14) + 1][1], case when n % 3 = 0 then null else photo end,
      goal, funded, st,
      case when st = 'Rejected' then 'Only one credential was attached. Two separate proofs are required.' else 'None' end,
      case when st = 'Pending Approval' then null else made + interval '1 day' end,
      case when n % 2 = 0 then (select name from public.users where users_id = uid) else 'None' end,
      case when n % 2 = 0 then '10-43-' || lpad(n::text, 2, '0') || '-001-' || lpad((n * 41)::text, 5, '0') else 'None' end,
      8 + (n % 6) * 2, (array[45, 90, 120, 150, 180])[(n % 5) + 1],
      (array['Land Title (TCT or OCT)', 'Tax Declaration on Land', 'Vehicle (OR and CR)', 'CLOA (Agrarian Reform Title)'])[(n % 4) + 1],
      'Pledged asset recorded at posting.', goal * 2, made
    );

    insert into public.project_documents (projects_id, doc_type, file_url, file_name)
    values (pid, case when n % 2 = 0 then 'RSBSA Registration' else 'Proof of Land' end, pid || '/credential-1.jpg', 'credential-1.jpg'),
           (pid, 'Barangay or LGU Certification', pid || '/credential-2.jpg', 'credential-2.jpg'),
           (pid, 'Collateral Proof', pid || '/collateral.jpg', 'collateral.jpg'),
           (pid, 'Farm Photo', pid || '/farm.jpg', 'farm.jpg');

    -- Investments that add up to what was raised, two to four investors each.
    remaining := funded;
    k := 0;
    while remaining > 0 loop
      k := k + 1;
      share := case when k >= 4 or remaining <= 5000 then remaining
                    else greatest(500, round(remaining * (0.3 + random() * 0.3) / 500) * 500) end;
      iid := gen_random_uuid();
      uid := investors[1 + floor(random() * array_length(investors, 1))::int];

      insert into public.investments (investments_id, customers_id, projects_id, amount, milestone_stage, created_at)
      values (iid, uid, pid, share,
              case st when 'Completed' then 'Final' when 'In Progress' then 'Midterm' else 'Initial' end,
              made + make_interval(days => 2 + k * 3));

      insert into public.contracts (investments_id, signatory_name, signed_at, terms_version, terms_snapshot, agreed_amount)
      values (iid, (select name from public.users where users_id = uid), made + make_interval(days => 2 + k * 3), 'v1',
              'FarmVest Investment Agreement. The investor funds PHP ' || to_char(share, 'FM999,999,990.00')
                || ' toward this project, returned with the stated percentage at the end of the cycle and secured by the pledged collateral. FarmVest charges a 5% platform commission.',
              share);

      remaining := remaining - share;
    end loop;

    -- Dated progress for anything that has started.
    if st in ('Completed', 'In Progress', 'Funded') then
      for k in 1..(case st when 'Completed' then 4 when 'In Progress' then 3 else 1 end) loop
        insert into public.progress_updates (projects_id, photo_url, notes, captured_at, created_at)
        values (pid, photo,
                (array['Stock delivered and settled. All healthy on arrival.',
                       'Feeding on schedule. Vaccination done this week.',
                       'Halfway through the cycle. Weight gain on target.',
                       'Cycle finished and harvested. Sold to the local buyer.'])[k],
                made + make_interval(days => 10 + k * 12), made + make_interval(days => 10 + k * 12));
      end loop;
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- Six months of finished rentals, for revenue and the rental records
  -- -------------------------------------------------------------------------
  select array_agg(equipment_id order by unit_code) into e from public.equipment;
  select payment_methods_id into pm from public.payment_methods where is_active order by created_at limit 1;

  if coalesce(array_length(e, 1), 0) > 0 and pm is not null then
    for n in 0..59 loop
      rid := gen_random_uuid();
      uid := everyone[1 + floor(random() * array_length(everyone, 1))::int];
      start_d := current_date - 175 + (n / array_length(e, 1)) * 30 + (n % array_length(e, 1)) % 10;
      days := 1 + (n % 4);
      select price_per_day into rate from public.equipment where equipment_id = e[(n % array_length(e, 1)) + 1];
      cond := case when n % 8 = 3 then 'Minor Damage' when n % 23 = 7 then 'Major Damage' else 'Good' end;
      charge := case cond when 'Minor Damage' then 800 + (n % 3) * 400 when 'Major Damage' then 6500 else 0 end;

      -- Past the 30-day spacing the dates would run into the first seed's
      -- bookings, so the loop stops there.
      exit when start_d + days > current_date - 25;

      insert into public.rentals (rentals_id, customers_id, equipment_id, start_date, end_date, status,
        dispatched_at, delivery_window, driver_name, driver_contact, delivered_at, received_by,
        returned_at, return_condition, damage_notes, damage_charge, created_at)
      values (rid, uid, e[(n % array_length(e, 1)) + 1], start_d, start_d + days - 1, 'Completed',
        start_d::timestamptz + interval '7 hours', 'morning (8AM to 12NN)',
        (array['Rodel Cabahug', 'Jun Pacana', 'Boyet Sabio'])[(n % 3) + 1],
        (array['09181112233', '09184445566', '09187778899'])[(n % 3) + 1],
        start_d::timestamptz + interval '10 hours', (select name from public.users where users_id = uid),
        start_d + days, cond,
        case cond when 'Minor Damage' then 'Scratched body panel and a loose drive belt.'
                  when 'Major Damage' then 'Cracked engine housing after hitting a rock.' else 'None' end,
        charge, start_d::timestamptz - interval '4 days');

      insert into public.payments (rentals_id, payment_methods_id, amount, payment_type, reference_no, status, submitted_at, reviewed_at, reviewed_by)
      values (rid, pm, days * rate, 'Full', '20' || lpad((n * 7919)::text, 11, '0'), 'Confirmed',
              start_d::timestamptz - interval '4 days', start_d::timestamptz - interval '3 days', admin);

      insert into public.contracts (rentals_id, signatory_name, signed_at, terms_snapshot, agreed_amount)
      values (rid, (select name from public.users where users_id = uid), start_d::timestamptz - interval '4 days',
              'FarmVest Rental Agreement. Daily rate, inclusive day count. The renter is liable for damage beyond normal wear.',
              days * rate);

      if cond <> 'Good' then
        insert into public.maintenance_logs (equipment_id, rentals_id, service_date, service_type, description, cost)
        values (e[(n % array_length(e, 1)) + 1], rid, start_d + days + 1, 'Repair',
                case cond when 'Minor Damage' then 'Replaced drive belt and repainted the panel.'
                          else 'Replaced the engine housing.' end, charge);
      end if;
    end loop;

    -- Routine servicing on every unit, once a quarter.
    for n in 1..array_length(e, 1) loop
      insert into public.maintenance_logs (equipment_id, service_date, service_type, description, cost, next_service_date)
      values (e[n], current_date - 150 + n, 'Routine', 'Oil change, filter, and a full check.', 650, current_date - 60 + n),
             (e[n], current_date - 60 + n, 'Routine', 'Oil change, filter, and a full check.', 650, current_date + 30 + n);
    end loop;

    -- Two cancelled bookings, for the cancelled list.
    insert into public.rentals (customers_id, equipment_id, start_date, end_date, status, admin_notes, created_at)
    values (everyone[3], e[1], current_date - 120, current_date - 119, 'Cancelled', 'Cancelled at the renter''s request before dispatch.', now() - interval '125 days'),
           (everyone[7], e[2], current_date - 90, current_date - 89, 'Cancelled', 'Cancelled under a PAGASA wind signal for Misamis Oriental.', now() - interval '95 days');
  end if;

  -- -------------------------------------------------------------------------
  -- Reviews and disputes, including closed cases for Case History
  -- -------------------------------------------------------------------------
  for n in 1..25 loop
    insert into public.reviews (reviewer_customers_id, reviewee_customers_id, rating, comment, transaction_type, created_at)
    values (investors[((n - 1) % array_length(investors, 1)) + 1], owners[((n - 1) % 16) + 1],
            (array[5, 4, 5, 3, 4])[(n % 5) + 1],
            (array['Regular updates with clear photos.', 'Answered every question quickly.',
                   'Returned the investment on time.', 'Updates were late but the cycle finished.',
                   'Good farm, well kept.'])[(n % 5) + 1],
            'Investment',
            now() - make_interval(days => n * 6));
  end loop;

  insert into public.reports (reporter_customers_id, reported_customers_id, projects_id, category, reason, status, resolution, resolved_at, resolved_by, created_at)
  select investors[(g % array_length(investors, 1)) + 1], p.customers_id, p.projects_id,
         (array['No progress updates', 'Misuse of funds', 'Unresponsive', 'Fake progress photos', 'Other'])[(g % 5) + 1],
         (array['No update for three weeks after funding.',
                'Feed receipts do not match the amount released.',
                'Calls and messages unanswered for ten days.',
                'The same photo was posted twice as two different weeks.',
                'Harvest date moved twice without explanation.'])[(g % 5) + 1],
         s,
         case s when 'Resolved' then 'Farm owner posted the missing updates with dated photos. Investor satisfied.'
                when 'Dismissed' then 'Records show updates were posted on schedule. No violation found.'
                else 'None' end,
         case when s in ('Resolved', 'Dismissed') then now() - make_interval(days => g * 4) end,
         case when s in ('Resolved', 'Dismissed') then admin end,
         now() - make_interval(days => g * 4 + 6)
  from generate_series(1, 14) as g
  cross join lateral (select (array['Open','Open','Open','Reviewing','Reviewing','Reviewing',
                                     'Resolved','Resolved','Resolved','Resolved','Resolved',
                                     'Dismissed','Dismissed','Dismissed'])[g] as s) sx
  cross join lateral (select projects_id, customers_id from public.projects
                      where status in ('In Progress', 'Completed', 'Funded')
                        and customers_id = any (owners)
                      order by created_at offset (g % 12) limit 1) p;

end;
$$;
