# FarmVest — Master Context

Everything an engineer or an AI assistant needs to pick this project up cold. Written as
of 10 September 2026, after the role merge. If something here disagrees with the code,
the code is right and this file is stale — say so.

---

## 1. What FarmVest is

- FarmVest is a capstone project for Technopreneurship and App Development, built by
  **Reach Selwyn Santizo**, section **IT4**.
- It is a mobile-first web application that runs **two connected businesses on one
  platform**, for Philippine agriculture.
- **Business one — livestock investment marketplace.** A customer posts a livestock
  project with a funding goal; other customers fund it; funds are released to the farm in
  three stages against photographic evidence of progress. FarmVest is only the
  marketplace and takes a 5% commission on each investment.
- **Business two — farm equipment rental.** FarmVest **owns the fleet itself**. There is
  no third-party equipment owner, which is why `equipment` has no `owner_id`. Customers
  book a unit by the day, pay outside the system, upload proof, and FarmVest delivers it.
- **The problem it addresses.** Small Filipino farm owners have land, skill and labour but
  no capital and no access to machinery they cannot afford to buy. People with money have
  no safe, transparent way to fund farming, because they cannot verify the money was
  actually spent on the farm.
- **The core promise** is verifiability, not returns: identity is checked against a
  government ID, projects are checked against documents, progress is checked against dated
  photographs, and money moves in stages against that evidence.

---

## 2. Stack and commands

- **Ionic React 9** with `@ionic/react-router` 9, **React 19**, **TypeScript 5.9**,
  **Vite 8**, **Capacitor 8**.
- **Supabase** for Postgres, Auth, Storage and row level security. Client in
  `src/supabaseClient.ts`, keyed from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Philippine address data comes from the `phil-reg-prov-mun-brgy` package (PSGC).
- Charts are hand-written SVG in `src/components/charts/`, no charting library.
- Animations use `lottie-react`.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc && vite build` — the type check is part of the build |
| `npm run db:push` | Applies pending migrations to the **live remote** Supabase project |
| `npm run db:new <name>` | Creates a new migration file |
| `npm run lint` | ESLint |
| `npm run test.unit` | Vitest |

- **Never run `supabase config push`.** The local `supabase/config.toml` still carries
  `site_url = "http://127.0.0.1:3000"` and a low email rate limit; pushing it would break
  the live project.
- Auth settings (OTP expiry of 60 seconds, email confirmation disabled) are configured by
  hand in the Supabase Dashboard, not in this repo.

---

## 3. Roles and authentication

- There are **two roles**: `Customer` and `Admin`. This is recent — Farm Owner and
  Investor used to be separate accounts and were merged on 10 September 2026, because the
  same person is often both: a farm owner with a good year has money to invest, and an
  investor who buys land becomes a farm owner.
- `UserRole` is declared in `src/contexts/AuthContext.tsx`.
- **A Customer does everything non-admin**: posts projects, rents equipment, posts
  progress updates, browses and funds other people's projects, and monitors what they
  funded.
- **The Admin is not created through signup.** The account is made once in the Supabase
  dashboard using the email in `public.admin_email()`, and the signup trigger gives that
  email the Admin role. `src/lib/adminAuth.ts` holds the email but deliberately **not** the
  password — anything in `src/` is compiled into the public bundle.
- **Registration asks the minimum**: name, email, contact number, password, and a photo of
  a valid government ID. No role selector, no farm address.
- **No signup confirmation email is sent.** The identity check is the Admin reviewing the
  uploaded ID, which proves more than a click on a link. The email address is still the
  sign-in identifier and still receives the forgot-password OTP.
- **Forgot password** sends a one-time code that expires in **60 seconds**.
- **A new account is `Pending`** and cannot sign in to anything until an Admin approves it
  against the valid ID.
- **Login lockout** is client-side in `src/lib/loginLockout.ts`: 3 failures locks for 60
  seconds, and every 2 failures after that locks for 10 minutes.
- `src/components/ProtectedRoute.tsx` gates every private route by role, and redirects a
  signed-in user of the wrong role to their own home rather than to the login page.

---

## 4. Routes

- Everything a customer uses lives under **one prefix**, `/app`, because there is one
  non-admin role and making the customer notice which half of the app they were in would
  be doing the product's filing for it.

| Route | Page |
|---|---|
| `/` | Landing (public catalogue) |
| `/login`, `/register` | `Login.tsx` in two modes |
| `/forgot-password` | `ForgotPassword.tsx` |
| `/app` | Customer dashboard |
| `/app/projects` | My Projects |
| `/app/equipment` | Rent Equipment |
| `/app/rentals` | My Rentals |
| `/app/progress` | Progress Updates |
| `/app/weather` | Weather Advisory |
| `/app/browse` | Browse Projects |
| `/app/investments` | My Investments |
| `/app/monitoring` | Progress Monitoring |
| `/app/reports` | Reports (five tabs) |
| `/admin` | Admin dashboard |
| `/admin/users` | User Management |
| `/admin/projects` | Livestock Projects review |
| `/admin/investments` | Investment Transactions |
| `/admin/equipment` | Equipment Fleet |
| `/admin/rentals` | Rental Bookings |
| `/admin/reports` | Reports and Disputes |
| `/notifications`, `/account` | Shared by both roles |

- The sidebar (`src/components/SideNav.tsx`) groups the customer's ten items under two
  headings, **FARMING** and **INVESTING**, with Dashboard and Reports outside the groups
  because each covers both halves.

---

## 5. File structure

### `src/lib/` — the logic that is not React

- **`format.ts`** — `peso`, `shortDate`, `pillClass`, and the None convention helpers
  `NONE`, `orNone`, `hasValue`.
- **`adminAuth.ts`** — who the Admin is, and why the password is not here.
- **`loginLockout.ts`** — failed-login throttling in localStorage.
- **`categories.ts`** — `PROJECT_CATEGORIES` = Poultry, Swine, Cattle, Goat, Fish, Other,
  plus the emoji and tint each one is drawn with.
- **`equipment.ts`** — 27 farm equipment types in 8 groups, and `familyOf()` which maps a
  unit to a family so the weather rules can reason about it.
- **`revenue.ts`** — `COMMISSION_RATE` (0.05) and `MINIMUM_INVESTMENT` (500), plus the
  rental and investment revenue calculations.
- **`contracts.ts`** — `rentalTerms()` and `investmentTerms()`, the exact wording stored on
  each signed contract, and `TERMS_VERSION`.
- **`notifications.ts`** — builds the notification feed. A customer gets the farming feed
  and the investing feed merged and sorted by when things happened.
- **`recommend.ts`** — **AI #1**, the investment recommendation engine.
- **`weather.ts`** — **AI #2**, the Open-Meteo forecast and advisory rules.
- **`chatbot.ts`** — **AI #3**, the rule-based assistant.

### `src/components/`

- **`Portal.tsx`** — renders children into `document.body`. **Every dialog needs this.**
  Ionic gives `ion-header` z-index 10 and `ion-content` z-index 0, and both are stacking
  contexts, so a modal written inside a page is trapped under the header no matter what
  z-index it claims. All 13 modals go through it.
- **`SideNav.tsx`** — the sidebar, plus `SideNavProvider`. Deliberately **not** an
  `IonMenu` inside an `IonSplitPane`: Ionic decides on its own when the menu and its toggle
  exist, and on phones that left the dashboard with no way to reach any other page. It is a
  fixed element, permanent from 992px up and a drawer below that, driven by CSS.
- **`DashboardHeader.tsx`** — the white top bar with the account menu and notification bell.
- **`AccountMenu.tsx`**, **`NotificationsMenu.tsx`** — dropdowns, both already portalled,
  z-index 3500 so they stay reachable above an open modal.
- **`DateRangeCalendar.tsx`** — month grid for picking rental dates, with booked days in red
  and struck through, and unclickable.
- **`PaymentForm.tsx`** — shared by the rental booking flow and My Rentals.
- **`AddressPicker.tsx`** — cascading province / city / barangay from PSGC data.
- **`ChatBot.tsx`** — the floating assistant, shown to Customers only.
- **`Toast.tsx`**, **`EmptyState.tsx`**, **`ProtectedRoute.tsx`**, **`PublicNav.tsx`**,
  **`LottiePlayer.tsx`**, **`charts/`**.

### `src/pages/`

- **`Landing.tsx`** — the public catalogue. Reads the `public_projects` and
  `public_equipment` views, never the tables, so a signed-out visitor sees a teaser row and
  nothing that identifies anyone.
- **`Login.tsx`** — sign-in and sign-up in one component, two routes.
- **`AccountProfile.tsx`** — personal details, farm address, investment budget, password
  change, and (for the Admin) the published GCash and bank accounts.
- **`customer/Dashboard.tsx`** — one header with a **Farming / Investing** switch. Both
  halves are the old `FarmOwnerDashboard` and `InvestorDashboard` rendered with
  `embedded`, so their queries and charts are not duplicated.
- **`customer/Reports.tsx`** — five tabs: My Projects, My Rentals, Completed Investments,
  Cancelled Projects, Signed Agreements.
- **`farmowner/`** — MyProjects, RentEquipment, MyRentals, ProgressUpdates,
  WeatherAdvisory, Reports (the last now superseded by `customer/Reports.tsx`).
- **`investor/`** — BrowseProjects, MyInvestments, ProgressMonitoring, Reports (likewise
  superseded).
- **`admin/`** — UserManagement, LivestockProjects, InvestmentTransactions, EquipmentFleet,
  RentalBookings, ReportsDisputes with its `reports/` tab components.
- The folder names `farmowner/` and `investor/` are now historical. The pages are shared by
  the single Customer role; only the paths kept the old names.

---

## 6. Database

### Tables

- **`users`** — the profile for every account. `users_id` is the same UUID as
  `auth.users.id`. Holds `name`, `email`, `contact_number`, `user_type`,
  `verification_status`, `account_status`, `suspended_reason`, `valid_id_type`,
  `valid_id_url`, `avatar_url`.
- **`customers`** — the non-admin side of an account, keyed by `customers_id`. Holds the
  farm address (`farm_location`, `farm_province`, `farm_city`, `farm_barangay`) and
  `investment_budget`. **Either half may be empty**: someone who only invests has no farm,
  someone who only farms sets no budget. This table used to be `farm_owners`; `investors`
  was merged into it and dropped.
- **`projects`** — `customers_id`, title, description, category, `image_url`,
  `funding_goal`, `current_funding`, `status`, `rejection_reason`, `reviewed_at`,
  `rsbsa_name`, `rsbsa_number`.
- **`project_documents`** — the files attached at posting: `doc_type`, `file_url`,
  `file_name`. Readable only by the owning customer and the Admin, because permits carry
  names, addresses and registration numbers.
- **`investments`** — `customers_id`, `projects_id`, `amount`, `milestone_stage`.
- **`equipment`** — the FarmVest fleet: `unit_code`, `name`, `type`, `price_per_day`,
  `availability_status`, `condition_notes`, `image_url`.
- **`rentals`** — `customers_id`, `equipment_id`, `start_date`, `end_date`, `status`,
  `status_changed_at`, the return inspection fields, and the delivery handover fields
  (`dispatched_at`, `delivery_window`, `driver_name`, `driver_contact`, `delivered_at`,
  `received_by`).
- **`payments`** and **`payment_methods`** — proof of payment and the accounts it was sent
  to.
- **`contracts`** — one row per signed rental or investment, holding `signatory_name`,
  `signed_at`, `terms_version` and **`terms_snapshot`**, the exact text agreed to.
- **`progress_updates`** — dated photos and notes against a project.
- **`reports`** — dispute cases, with `reporter_customers_id`, `reported_customers_id`,
  `category`, `reason`, `resolution`, `resolved_by`.
- **`reviews`** — `reviewer_customers_id`, `reviewee_customers_id`, `rating`.
- **`maintenance_logs`** — service records per unit.

### Views — these are the security boundary

- Views here are **plain, not `security_invoker`**, so they run as their owner and are not
  stopped by row level security. That makes the select list itself the boundary, and
  nothing identifying is in it.
- **`public_projects`**, **`public_equipment`** — the teaser rows the Landing page reads.
- **`customer_directory`** — name and area only, so an investor can see whose project they
  are funding without reaching the address or the government ID.
- **`customer_track_record`** — aggregate counts, dates and ratings per customer:
  `completed_projects`, `total_projects`, `last_update_at`, `progress_update_count`,
  `average_rating`, `rating_count`, `open_disputes`. It exists because the recommender
  needs a farm's record and an investor may not read progress updates or dispute rows
  directly. Both restrictions are correct and stay.
- **`equipment_bookings`** — the dates each unit is already committed to, without saying
  who booked it.

### Functions

- **`is_admin()`** — security definer, used by every admin policy.
- **`admin_email()`** — the single authority on who the Admin is.
- **`handle_new_user()`** — the signup trigger. Writes the `users` row and a `customers`
  row, and grants the Admin role to the one email.
- **`invest_in_project(projects_id, amount, signatory_name, terms_snapshot)`** — the whole
  investment as one transaction. It locks the project row with `for update` first, so two
  investors arriving at the same moment cannot together overfund it. It writes the
  investment, the contract, the running total and the status flip, or none of them.
- **`touch_rental_status()`** — keeps `status_changed_at` correct, because three different
  code paths change a rental's status.

### Storage buckets

- `avatars`, `valid-ids`, `project-photos`, `progress-photos`, `equipment-photos` —
  public or own-folder.
- `payment-proofs`, `project-documents` — **private**. The app stores the object path, not
  a URL, and reads them through a signed URL valid for 300 seconds.
- Every bucket policy keys on the first path segment being `auth.uid()`.

### The None convention

- Sixteen text columns are `not null default 'None'` rather than nullable, so a missing
  value has one representation instead of two.
- **Writing `null` to one of them throws.** This has bitten twice —
  `suspended_reason` on user approval, `rejection_reason` on project approval. Use `NONE`
  from `src/lib/format.ts`, and `hasValue()` / `orNone()` when reading.

---

## 7. The three AI features

### AI #1 — Investment Recommendation Engine (`src/lib/recommend.ts`)

- Ranks every open project for one investor and returns a **match score from 0 to 100**
  with written reasons.
- Weights, totalling 100: **budget fit 40, farm track record 28, funding activity 20,
  momentum 12.**
- On top of those: a **seasonal adjustment** capped at ±6 per livestock category, a
  **weather penalty** up to 30 taken from AI #2's advisory level for that farm, and a
  **dispute penalty** up to 40.
- **Nothing is scored until the investor sets a budget.** A score built only from season
  and track record reads as a real recommendation while ignoring the thing that decides
  whether the investor can take part at all.
- Projects scoring under **35** are left out of the shortlist rather than padded in.
- **Your own project is filtered out of the query**, not hidden in the render — otherwise
  it would take a place in the shortlist and push a real candidate out.
- Every scorer pushes a `Reason` with a tone, and reasons are sorted warn → good → info.
  The explanation is produced by the scorer that awarded the points, so it can never drift
  from the score.
- Runs entirely client-side. No external service, no API key.

### AI #2 — Weather-Based Farm Advisory (`src/lib/weather.ts`)

- Turns a live seven-day forecast for a farm's real coordinates into an **advisory level
  0–5**, protective actions, crops suited to the season, and which equipment is usable this
  week.
- Uses the **Open-Meteo** geocoding and forecast REST APIs — free, no API key, so no
  secret ends up in the client bundle.
- Advisory levels follow the **PAGASA storm-signal wind thresholds**: 39, 62, 89, 118 and
  185 km/h.
- Equipment suitability switches on `familyOf()` from `src/lib/equipment.ts`, with a wet
  reason and a dry reason for each of eight families.
- **`placeCandidates()`** strips PSGC decorations — `(Capital)`, `City Of X`, a trailing
  ` City` — and falls back to the province, because the geocoder returned nothing for
  `"Cagayan De Oro City (Capital)"`.
- Caches geocoding permanently and forecasts for 3 hours in localStorage, times out at 12
  seconds with `AbortController`, and uses `Promise.allSettled` for per-town fetches.

### AI #3 — FarmVest Assistant (`src/lib/chatbot.ts`)

- A rule-based assistant behind a floating button, shown to Customers and never to the
  Admin, who has dashboards for all of it.
- Intent classification by **keyword scoring**: a multi-word phrase scores 3, a single word
  scores 1, and when nothing scores it returns the topic menu rather than guessing.
- `CUSTOMER_INTENTS` is the farming list followed by the investing list, kept as two arrays
  rather than merged so a question about renting a tractor cannot be answered in portfolio
  wording.
- Answers use **live account data**: the recommendation intent calls `recommend()` itself
  rather than restating the rules.
- Options are rendered as a message inside the conversation, not a fixed chip bar.

---

## 8. Business rules, and why they are what they are

### Funding is all-or-nothing

- A project starts only when the goal is **fully met**. `invest_in_project` flips `Open` to
  `Funded` when the last investment fills it.
- This is the standard crowdfunding model, and it is **necessary for livestock rather than
  merely conventional**: feed is 60–70% of broiler production cost in the Philippines and is
  a continuous daily expense across a 45-day cycle, so half the capital funds a full flock
  that runs out of feed on day 25 and produces a total loss rather than a proportional one.
- Sources worth citing: the [Kickstarter all-or-nothing
  page](https://help.kickstarter.com/hc/en-us/articles/115005047893-Why-is-funding-all-or-nothing)
  ("creators can be confident that they have enough money to actually deliver what they
  promised"), and Cumming, Leboeuf & Schwienbacher (2020), *Crowdfunding models:
  Keep-It-All vs. All-Or-Nothing*, Financial Management 49(2), 331–360.

### Minimum investment PHP 500

- Enforced inside `invest_in_project`, mirrored in `MINIMUM_INVESTMENT` for the form.
- **Waived when the amount exactly closes the remaining balance**, otherwise a project
  needing its last PHP 200 could never be finished by anyone and would sit at 99% forever.
- There is **no floor on the funding goal**. One was added and then removed: the closing
  exception already made a small goal fundable, so the floor protected nothing and only
  stopped a farm owner asking for what they needed.

### Risk level was removed entirely

- It began as a dropdown on the farm owner's own form, which made it worth nothing: the
  recommender weighted risk match at 25 of 100, so a project claiming Low ranked higher for
  a cautious investor, and the party choosing the label was the party it was about.
- Moving it to the Admin removed that incentive and added a worse one: two Admins reading
  the same file would disagree and neither could say why.
- It was dropped from the schema on 9 September 2026, along with `investors.risk_appetite`.
  Its 25 points went to budget fit and track record.
- **The risk *disclosure* stays** and is a different thing: the amber warning in the invest
  modal and section 4 of `investmentTerms()`, which says plainly that this is an investment
  and not a loan, that no return is guaranteed, and that ordinary farming loss is carried by
  the investor in proportion to what they put in.

### Project verification

- A posted project must carry **two separate proofs** that the customer farms there, plus
  at least one photo of the facility.
- The credential types are **Proof of Land, Barangay or LGU Certification, Business Permit,
  Veterinary or Facility Permit**, and any two count.
- **No particular document is demanded by name**, on purpose: RSBSA covers the basic sector
  and a registered farm business is often not in it at all, while a smallholder in a remote
  barangay may hold nothing but a barangay certificate. Demanding either would reject a
  real farmer.
- **RSBSA is typed, not uploaded** — a registered name and an optional number. The public
  finder at `finder-rsbsa.da.gov.ph` searches by first name, middle name, last name, sex and
  birthday, and takes **no reference number**, so a photograph of a card gives the Admin
  nothing to type in. A filled-in RSBSA counts as one of the two proofs, and is the
  strongest of them because it is the only one checkable against a government database.
- The Admin review modal opens each document in a stacked modal via a signed URL, and links
  out to the RSBSA finder rather than scraping it — the Department of Agriculture publishes
  no API, and scraping would break the first time they change the page.

### Payment

- **FarmVest is not connected to GCash or to any bank, deliberately.** The Admin publishes
  the official GCash and bank accounts under My Account; the customer pays outside the app
  and uploads a screenshot; the Admin verifies it against the receiving account.
- The platform **records** payment, it does not **process** it, and holds no card data.
- Payment happens at booking, not later, so a unit and a driver are never committed to a
  delivery run that has not been paid for.
- Full payment or **50% downpayment**.

### Equipment rental

- Priced **per day, not hourly**, and the day count is **inclusive** — a same-day booking is
  one day at the full rate. Three reasons: the unit cannot be rented to anyone else that
  day; the delivery cost is the same whether it is used for two hours or ten; and there is
  no telemetry, so hours cannot be audited and you must not bill for what you cannot
  measure.
- The booking calendar shows booked days in red, struck through and unclickable, so an
  impossible booking is not something a renter can type.
- **Delivery is a two-party handover, not GPS.** The Admin dispatches with a driver name,
  contact number and an arrival window in words an operator can keep; the **farm owner
  confirms receipt**, and that confirmation is what makes the rental Active. The Admin
  cannot mark a unit delivered, because the Admin did not receive it. A booking stuck at
  `Out for Delivery` is then a real operational signal rather than a silent error.
- The return inspection is recorded by the Admin, because the Admin is who the unit comes
  back to. Each side records the half it witnessed.

---

## 9. Known gaps — be honest about these

- **No status advances past `Funded`.** Nothing in the app sets a project to `In Progress`
  or `Completed`. This means the Reports tabs that filter on Completed stay empty forever,
  `customer_track_record.completed_projects` is always 0, and the recommender always says
  the farm has never finished anything. **Three buttons are needed**: Start Project, Mark
  Completed, and milestone release.
- **`milestone_stage` never moves.** It is always `Initial`. Nothing releases Midterm or
  Final, so the staged release — the thing described as the investor's main protection —
  does not actually run. This is the most important gap to close.
- **No funding deadline.** All-or-nothing has two halves and only the first is built: a
  project that never fills sits `Open` forever and nothing is returned. A
  `funding_deadline` column and an auto-cancel would fill the Cancelled Projects tab that
  currently has nothing to show.
- **No service area on equipment.** Nothing stops someone in Davao booking a unit based in
  Misamis Oriental. There is no location on `equipment`, no delivery fee and no distance
  check, so the price is wrong for a distant booking and the delivery window is
  unkeepable. The fix is a service-province list per unit, checked against the farm address
  at booking.
- **Investing records but does not collect.** `invest_in_project` writes the investment and
  the contract; there is no payment step on the investment side the way there is on the
  rental side.
- **Photo authenticity is not checked.** Verification photos are ordinary gallery uploads,
  so an AI-generated or stolen image would pass. The designed answer is not detection —
  detectors are unreliable — but prevention: a one-time challenge code the system generates,
  written on paper and photographed at the site; a perceptual hash to catch the same photo
  used twice on the platform; a reverse-image-search link in the admin modal; and EXIF shown
  to the Admin as a signal, never as a verdict. **None of this is built yet.**
- **Project categories are livestock only.** Crops and land expansion are not offered, which
  is also why the seasonal half of the recommender is muted — crops are far more
  season-sensitive than livestock.
- **No mortality or loss reporting.** A farm owner has no way to formally declare that
  animals died, which is exactly the case that separates honest loss from negligence.
- **`IonSplitPane` and `IonMenu` are not used** — do not claim them in documentation. The
  sidebar is a plain fixed element with a CSS media query at 992px, and the comment in
  `SideNav.tsx:109` explains why they were rejected.

---

## 10. Conventions and traps

- **Line endings are CRLF** throughout. Mixed CRLF and LF in one file breaks exact-match
  patching, and it has happened repeatedly. Normalise before editing a file with a script.
- **PostgREST select strings are not type-checked.** A build passes while a query references
  a dropped column, and the failure only appears at runtime. After any schema change, grep
  the whole of `src/` for the old column and table names — `tsc` will not find them.
- **The embed key in a PostgREST select becomes the property name in the result.** Renaming
  `farm_owners(...)` to `customers(...)` in a query also requires renaming `farm_owners:` in
  the TypeScript type, and TypeScript cannot tell you that you forgot.
- **Renaming a table or column in Postgres carries its dependents.** Policies, views,
  foreign keys and indexes are rewritten automatically. This is why the role merge renamed
  `farm_owners` to `customers` instead of rebuilding it — a drop and recreate would have
  meant restating twenty policies by hand and getting one subtly wrong.
- **Drop a CHECK constraint before updating rows past it.** The role merge failed once
  because the update to `user_type = 'Customer'` ran while the old constraint still only
  admitted the two old values.
- **Drop dependent policies before dropping a column they read**, then restate them.
- **Every dialog must be wrapped in `Portal`.** A modal rendered inside `IonContent` is
  trapped beneath `ion-header` regardless of its z-index.
- **Prefer a migration over a manual dashboard change**, so the schema history stays in the
  repo. The exceptions are auth settings, which have no migration path.
- The Admin's identity in SQL is `public.admin_email()`, and `resolved_by` on a report is
  the Admin's email as **text**, not a foreign key, because the Admin has no subtype row.

---

## 11. Where to start if you are picking this up

1. **Run `npm run build` first.** If it passes, the TypeScript is sound; it says nothing
   about whether the queries match the schema.
2. **Read `src/contexts/AuthContext.tsx` and `src/App.tsx`** to see the roles and the route
   map.
3. **Read the newest migrations backwards** from `20260910180000` — the last six days
   changed more than the first ten.
4. **The three highest-value pieces of work**, in order: the milestone release and the two
   status buttons; a funding deadline with auto-cancel; and the challenge-code photo
   verification.
