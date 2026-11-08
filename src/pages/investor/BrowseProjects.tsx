import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import {
  alertCircleOutline,
  checkmarkCircleOutline,
  closeOutline,
  informationCircleOutline,
  locationOutline,
  searchOutline,
  sparklesOutline,
} from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import Portal from '../../components/Portal';
import IdentityVerification from '../../components/IdentityVerification';
import CostEstimateCard from '../../components/CostEstimateCard';
import type { CostLine } from '../../lib/liquidation';
import { useToast } from '../../components/Toast';
import EmptyState from '../../components/EmptyState';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { orNone, peso } from '../../lib/format';
import { categoryLook } from '../../lib/categories';
import {
  matchLabel,
  matchTone,
  recommend,
  type FarmOutlook,
  type InvestorPreferences,
  type Recommendation,
  type TrackRecord,
} from '../../lib/recommend';
import { loadAdvisory } from '../../lib/weather';
import { fundingTerms } from '../../lib/contracts';
import { expectedReturn } from '../../lib/funding';
import { MINIMUM_INVESTMENT } from '../../lib/revenue';
import '../../theme/dashboard.css';
import './BrowseProjects.css';
import Skeleton from '../../components/Skeleton';

type ProjectRow = {
  projects_id: string;
  customers_id: string;
  title: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
  funding_goal: number;
  current_funding: number;
  status: string;
  created_at: string;
  /** What the farm owner undertakes to pay back, and against what security. */
  expected_roi_percent: number;
  estimated_heads: number | null;
  expected_mortality_percent: number;
  expected_price_per_head: number | null;
  cost_breakdown: CostLine[];
  expected_cycle_days: number | null;
  collateral_type: string;
  collateral_description: string;
  collateral_value: number | null;
  rsbsa_name: string;
};

/** Name and area only. The address detail and the ID stay behind their policy. */
type OwnerRow = {
  customers_id: string;
  name: string;
  farm_barangay: string | null;
  farm_city: string | null;
  farm_province: string | null;
};

/**
 * The requirements an investor is shown were checked, in the order the farm
 * owner attaches them. Types only: the files stay with the farm owner and the
 * Admin under the Data Privacy Act.
 */
const REQUIREMENT_ORDER = [
  'RSBSA Registration',
  'Proof of Land',
  'Barangay or LGU Certification',
  'Business Permit',
  'Veterinary or Facility Permit',
  'Collateral Proof',
  'Farm Photo',
  'Project Proposal',
  'Cost Estimate',
];

/**
 * Statuses an investor may browse.
 *
 * Open is the only one that still takes money; Funded and In Progress are shown
 * so a project does not vanish the moment it fills, which is what an investor
 * following a farm would notice first. Pending Approval, Rejected and Under
 * Investigation are filtered by the read policy and never reach here.
 */
const BROWSABLE = ['Open', 'Funded', 'In Progress'];

const SORTS = ['Best match', 'Newest', 'Closest to goal', 'Largest goal'] as const;
type Sort = (typeof SORTS)[number];

/** How many the recommendation panel puts forward. Past three it is a list. */
const SHORTLIST = 3;

const REASON_ICON = {
  good: checkmarkCircleOutline,
  warn: alertCircleOutline,
  info: informationCircleOutline,
} as const;

const BrowseProjects: React.FC = () => {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { showSuccess } = useToast();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [owners, setOwners] = useState<Map<string, OwnerRow>>(new Map());
  const [preferences, setPreferences] = useState<InvestorPreferences | null>(null);
  const [records, setRecords] = useState<Map<string, TrackRecord>>(new Map());
  /** Document types each project was approved on. */
  const [credentials, setCredentials] = useState<Map<string, string[]>>(new Map());
  const [outlooks, setOutlooks] = useState<Map<string, FarmOutlook>>(new Map());
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState<Sort>('Best match');

  // The budget lives on the investor's account, but asking them to leave the
  // catalogue to change it is the reason most of them never set one. Editing it
  // here re-scores immediately and writes the new value back to the account, so
  // the two never disagree.
  const [budgetInput, setBudgetInput] = useState('');
  const [savingPrefs, setSavingPrefs] = useState(false);

  const [investing, setInvesting] = useState<ProjectRow | null>(null);
  /** The project an unverified investor tried to fund, held while they verify. */
  const [verifyFor, setVerifyFor] = useState<ProjectRow | null>(null);
  const [amount, setAmount] = useState('');
  const [signatory, setSignatory] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  /** Whether the full agreement has been opened in this sitting. The accept
   *  box stays locked until it has, so it cannot be ticked unread. */
  const [termsOpened, setTermsOpened] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    // The budget is the investor's own row, readable only by
    // them and the Admin. A missing row is not an error: it means the account
    // has not set preferences yet, and the recommender treats that as neutral.
    const { data: prefs } = await supabase
      .from('customers')
      .select('investment_budget')
      .eq('customers_id', profile.users_id)
      .maybeSingle();

    setPreferences({
      budget: prefs?.investment_budget != null ? Number(prefs.investment_budget) : null,
    });

    setBudgetInput(
      prefs?.investment_budget != null ? String(Number(prefs.investment_budget)) : ''
    );

    const { data, error: loadError } = await supabase
      .from('projects')
      .select(
        'projects_id, customers_id, title, description, category, image_url, funding_goal, current_funding, status, created_at, expected_roi_percent, expected_cycle_days, collateral_type, collateral_description, collateral_value, rsbsa_name, estimated_heads, expected_mortality_percent, expected_price_per_head, cost_breakdown'
      )
      .in('status', BROWSABLE)
      // Your own project is not something you can fund -- invest_in_project
      // refuses it -- so it has no business in a catalogue of what to fund.
      .neq('customers_id', profile.users_id)
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as ProjectRow[];
    setProjects(rows);

    // The owner name comes from the directory view rather than from a join:
    // farm_owners itself is closed to everyone but its owner and the Admin, and
    // PostgREST cannot be relied on to infer a relationship through a view.
    if (rows.length > 0) {
      const { data: directory } = await supabase
        .from('customer_directory')
        .select('customers_id, name, farm_barangay, farm_city, farm_province')
        .in('customers_id', Array.from(new Set(rows.map((row) => row.customers_id))));

      const { data: credentialRows } = await supabase
        .from('project_credentials')
        .select('projects_id, doc_type')
        .in('projects_id', rows.map((row) => row.projects_id));
      const byProject = new Map<string, string[]>();
      ((credentialRows ?? []) as { projects_id: string; doc_type: string }[]).forEach((row) => {
        byProject.set(row.projects_id, [...(byProject.get(row.projects_id) ?? []), row.doc_type]);
      });
      setCredentials(byProject);

      const ownerRows = (directory ?? []) as OwnerRow[];
      setOwners(new Map(ownerRows.map((row) => [row.customers_id, row])));

      // AI #2, read from the investor's side. The forecast is fetched once per
      // distinct town rather than once per project, because several farms in
      // the same municipality share a forecast, and lib/weather caches both the
      // geocode and the reading on top of that.
      //
      // allSettled, not all: a town the geocoder does not know must cost that
      // one farm its weather line, not the whole page its recommendations.
      const byPlace = new Map<string, string[]>();
      ownerRows.forEach((row) => {
        if (!row.farm_city || !row.farm_province) return;
        const key = `${row.farm_city}|${row.farm_province}`;
        byPlace.set(key, [...(byPlace.get(key) ?? []), row.customers_id]);
      });

      const forecasts = await Promise.allSettled(
        Array.from(byPlace.keys()).map(async (key) => {
          const [city, province] = key.split('|');
          const advisory = await loadAdvisory(city, province);
          return { key, advisory };
        })
      );

      const nextOutlooks = new Map<string, FarmOutlook>();

      forecasts.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        const { key, advisory } = result.value;

        (byPlace.get(key) ?? []).forEach((ownerId) => {
          nextOutlooks.set(ownerId, {
            level: advisory.level,
            leadTimeDays: advisory.leadTimeDays,
            place: advisory.matchedPlace,
          });
        });
      });

      setOutlooks(nextOutlooks);

      // Aggregate counts and dates only, from a view that exposes them without
      // opening the progress updates or the dispute cases behind them.
      const { data: trackRecords } = await supabase
        .from('customer_track_record')
        .select(
          'customers_id, completed_projects, total_projects, last_update_at, progress_update_count, average_rating, rating_count, open_disputes'
        )
        .in('customers_id', Array.from(new Set(rows.map((row) => row.customers_id))));

      setRecords(
        new Map(
          (trackRecords ?? []).map((row) => [
            (row as { customers_id: string }).customers_id,
            row as unknown as TrackRecord,
          ])
        )
      );
    }

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  /** Only the categories actually posted, so no chip leads to an empty list. */
  const categories = useMemo(() => {
    const found = new Set(projects.map((project) => project.category ?? 'Other'));
    return ['All', ...Array.from(found).sort()];
  }, [projects]);

  /** Every browsable project scored, keyed for lookup while rendering. */
  const scores = useMemo(() => {
    if (!preferences || preferences.budget === null) {
      return new Map<string, Recommendation>();
    }

    const ranked = recommend(
      preferences,
      projects.map((project) => ({
        projectsId: project.projects_id,
        farmOwnersId: project.customers_id,
        category: project.category ?? 'Other',
        fundingGoal: Number(project.funding_goal),
        currentFunding: Number(project.current_funding),
      })),
      records,
      outlooks
    );

    return new Map(ranked.map((entry) => [entry.projectsId, entry]));
  }, [preferences, projects, records, outlooks]);

  /**
   * Apply the typed budget.
   *
   * The scores recompute from local state the moment this runs, so the panel
   * answers instantly. The write to the account is deliberately not awaited
   * before that: a slow round trip should not hold up the recommendation the
   * investor asked for, and a failed write only means the value is not
   * remembered next visit.
   */
  const applyPreferences = async () => {
    if (!profile) return;

    const raw = budgetInput.trim();
    const parsed = raw === '' ? null : Number(raw);

    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setError('Enter a budget greater than zero, or leave it blank.');
      return;
    }

    setError(null);
    setPreferences({ budget: parsed });
    setSavingPrefs(true);

    const { error: saveError } = await supabase
      .from('customers')
      .update({ investment_budget: parsed })
      .eq('customers_id', profile.users_id);

    if (saveError) setError(saveError.message);
    setSavingPrefs(false);
  };

  const minimumFor = (project: ProjectRow) =>
    Math.min(MINIMUM_INVESTMENT, remaining(project));

  const openInvest = (project: ProjectRow, verified = false) => {
    // A first investment waits on the identity check, the same one a farm owner
    // passes before posting: money changes hands here, so the investor has to
    // be someone FarmVest can name. `verified` skips the gate straight after a
    // pass, before the reloaded profile has reached this closure.
    if (!verified && profile?.verification_status !== 'Approved') {
      setVerifyFor(project);
      return;
    }

    setInvesting(project);
    // Pre-filled with whichever is smaller, the budget or what is left to
    // raise, because that is the amount the investor almost always wants and
    // the only one that can succeed.
    const left = Number(project.funding_goal) - Number(project.current_funding);
    const budget = preferences?.budget;
    const wanted = Math.min(left, budget ?? left);
    setAmount(String(Math.max(minimumFor(project), wanted)));
    setSignatory(profile?.name ?? '');
    setAccepted(false);
    setShowTerms(false);
    setTermsOpened(false);
    setError(null);
  };

  const closeInvest = () => {
    setInvesting(null);
    setAccepted(false);
    setShowTerms(false);
    setTermsOpened(false);
  };

  const termsFor = (project: ProjectRow, value: number) =>
    fundingTerms({
      signatoryName: signatory.trim() || 'the Funder',
      projectTitle: project.title,
      farmOwnerName: owners.get(project.customers_id)?.name ?? 'the Farm Owner',
      category: project.category ?? 'Other',
      amount: value,
      fundingGoal: Number(project.funding_goal),
      roiPercent: Number(project.expected_roi_percent),
      expectedReturn: expectedReturn(value, Number(project.expected_roi_percent)),
      cycleDays: project.expected_cycle_days,
      collateralType: project.collateral_type,
      collateralDescription: project.collateral_description,
      collateralValue: Number(project.collateral_value ?? 0),
    });

  /**
   * Commit the investment.
   *
   * Everything the write has to do -- the investment row, the signed contract,
   * the project total and the status flip -- happens inside invest_in_project,
   * which locks the project row first. The remaining balance is re-checked
   * there against what it is now rather than what this page last loaded, so two
   * investors arriving together cannot overfund it between them.
   */
  const commitInvestment = async () => {
    if (!investing || !profile) return;

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }

    const floor = minimumFor(investing);

    if (value < floor) {
      setError(
        floor < MINIMUM_INVESTMENT
          ? `Only ${peso(floor)} is left on this project, so that is the amount to commit.`
          : `The smallest investment is ${peso(MINIMUM_INVESTMENT)}.`
      );
      return;
    }

    if (signatory.trim().length < 3) {
      setError('Type your full name to sign the agreement.');
      return;
    }

    if (!accepted) {
      setError('Read and accept the agreement before committing.');
      return;
    }

    setCommitting(true);
    setError(null);

    const { data: investmentId, error: investError } = await supabase.rpc('invest_in_project', {
      p_projects_id: investing.projects_id,
      p_amount: value,
      p_signatory_name: signatory.trim(),
      p_terms_snapshot: termsFor(investing, value),
    });

    if (investError) {
      setError(investError.message);
    } else {
      showSuccess(`${peso(value)} committed to ${investing.title}. Pay it to confirm the investment.`);
      closeInvest();
      // Paying is the next step, so the investor is taken to where it is done,
      // with the payment form for this investment already open.
      navigate(
        typeof investmentId === 'string' ? `/app/investments?pay=${investmentId}` : '/app/investments'
      );
    }

    setCommitting(false);
  };

  const fundedPercent = (project: ProjectRow) => {
    if (!project.funding_goal) return 0;
    return Math.min(
      100,
      Math.round((Number(project.current_funding) / Number(project.funding_goal)) * 100)
    );
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = projects.filter((project) => {
      if (category !== 'All' && (project.category ?? 'Other') !== category) return false;
      if (!term) return true;

      const owner = owners.get(project.customers_id);
      return [project.title, project.description ?? '', owner?.name ?? '', owner?.farm_city ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term);
    });

    const ranked = [...filtered];

    if (sort === 'Best match') {
      ranked.sort(
        (a, b) =>
          (scores.get(b.projects_id)?.score ?? 0) - (scores.get(a.projects_id)?.score ?? 0)
      );
    } else if (sort === 'Closest to goal') {
      ranked.sort((a, b) => fundedPercent(b) - fundedPercent(a));
    } else if (sort === 'Largest goal') {
      ranked.sort((a, b) => Number(b.funding_goal) - Number(a.funding_goal));
    }

    return ranked;
  }, [projects, owners, search, category, sort, scores]);

  /**
   * The shortlist the panel puts forward.
   *
   * Drawn from everything open rather than from the filtered list: a
   * recommendation that changed every time a chip was pressed would be a filter
   * with a different name. Only projects that are still taking money are
   * eligible, and a weak match is left out rather than padded in.
   */
  const shortlist = useMemo(() => {
    if (!preferences) return [];

    return projects
      .filter((project) => project.status === 'Open')
      .map((project) => ({ project, match: scores.get(project.projects_id) }))
      .filter((entry) => (entry.match?.score ?? 0) >= 35)
      .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
      .slice(0, SHORTLIST);
  }, [projects, scores, preferences]);

  const remaining = (project: ProjectRow) =>
    Math.max(0, Number(project.funding_goal) - Number(project.current_funding));

  return (
    <IonPage>
      <DashboardHeader
        title="Browse Projects"
        subtitle="Livestock projects open for funding, and the farms behind them."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          {!loading && projects.length > 0 && (
            <section className="recommend">
              <div className="recommend__head">
                <IonIcon icon={sparklesOutline} />
                <div>
                  <h2 className="recommend__title">Recommended for you</h2>
                  <p className="recommend__lead">
                    {preferences?.budget === null
                      ? 'Tell us what you have to invest and we will rank every open project against it, each farm\u2019s record, and the weather where the farm is.'
                      : `Matched against your ${peso(preferences?.budget ?? 0)} budget, each farm\u2019s record, and the weather where the farm is.`}

                  </p>
                </div>
              </div>

              <div className="recommend__controls">
                <div className="dash-field">
                  <label htmlFor="recommend-budget">Your Budget (PHP)</label>
                  <input
                    id="recommend-budget"
                    className="dash-input"
                    type="number"
                    min="1"
                    value={budgetInput}
                    onChange={(event) => setBudgetInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') applyPreferences();
                    }}
                    placeholder="25000"
                  />
                </div>

                <button
                  type="button"
                  className="dash-btn dash-btn--primary"
                  disabled={savingPrefs}
                  onClick={() => applyPreferences()}
                >
                  {savingPrefs ? 'Matching...' : 'Recommend'}
                </button>
              </div>

              {preferences?.budget !== null && shortlist.length === 0 && (
                <p className="recommend__empty">
                  Nothing scores well against {peso(preferences?.budget ?? 0)} yet. Try a
                  larger budget -- every open project is still listed below.
                </p>
              )}

              <div className="recommend__grid">
                {shortlist.map(({ project, match }) => {
                  const look = categoryLook(project.category);
                  const owner = owners.get(project.customers_id);
                  const score = match?.score ?? 0;

                  return (
                    <article className="recommend__card" key={project.projects_id}>
                      <div className="recommend__card-head">
                        <span className="recommend__emoji" style={{ background: look.tint }}>
                          {look.emoji}
                        </span>

                        <div className="recommend__card-titles">
                          <p className="recommend__card-title">{project.title}</p>
                          <p className="recommend__card-owner">
                            {owner ? owner.name : 'Farm owner'}
                            {owner?.farm_city ? ` \u2014 ${owner.farm_city}` : ''}
                          </p>
                        </div>

                        <span className={`recommend__score recommend__score--${matchTone(score)}`}>
                          <strong>{score}</strong>
                          <small>{matchLabel(score)}</small>
                        </span>
                      </div>

                      {/* The reasons are the recommendation. A rank with no
                          explanation is a number to be taken on trust, and this
                          one is asking for money. */}
                      <ul className="recommend__reasons">
                        {match?.reasons.slice(0, 5).map((reason) => (
                          <li key={reason.text} className={`recommend__reason--${reason.tone}`}>
                            <IonIcon icon={REASON_ICON[reason.tone]} />
                            <span>{reason.text}</span>
                          </li>
                        ))}
                      </ul>

                      <p className="recommend__funding">
                        {peso(project.current_funding)} of {peso(project.funding_goal)} (
                        {fundedPercent(project)}%)
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          <div className="dash-toolbar-row">
            {categories.map((value) => (
              <button
                key={value}
                type="button"
                className={`dash-tab${category === value ? ' dash-tab--active' : ''}`}
                onClick={() => setCategory(value)}
              >
                {value}
              </button>
            ))}

            <label className="dash-search dash-spacer">
              <IonIcon icon={searchOutline} />
              <input
                type="search"
                placeholder="Search title, farm owner, or city"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          <div className="dash-toolbar-row">
            <div className="dash-field browse-filter">
              <label htmlFor="browse-sort">Sort by</label>
              <select
                id="browse-sort"
                className="dash-select"
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
              >
                {SORTS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <span className="dash-stat__hint dash-spacer">
              {visible.length} project{visible.length === 1 ? '' : 's'}
            </span>
          </div>

          {loading ? (
            <Skeleton />
          ) : visible.length === 0 ? (
            <section className="dash-panel">
              <div className="dash-panel__body">
                <EmptyState
                  title={
                    projects.length === 0
                      ? 'No project is open for funding yet'
                      : 'No project matches these filters'
                  }
                  message={
                    projects.length === 0
                      ? 'Farm owners post projects here once an administrator approves them.'
                      : 'Clear a filter to widen the search.'
                  }
                  size={140}
                />
              </div>
            </section>
          ) : (
            <div className="browse-grid">
              {visible.map((project) => {
                const look = categoryLook(project.category);
                const owner = owners.get(project.customers_id);
                const percent = fundedPercent(project);

                return (
                  <article className="browse-card" key={project.projects_id}>
                    <div className="browse-card__art" style={{ background: look.tint }}>
                      {project.image_url ? (
                        <img src={project.image_url} alt="" loading="lazy" />
                      ) : (
                        <span className="browse-card__emoji">{look.emoji}</span>
                      )}
                      <span className="browse-card__badge">{orNone(project.category)}</span>

                      {scores.has(project.projects_id) && (
                        <span
                          className={`browse-card__match browse-card__match--${matchTone(
                            scores.get(project.projects_id)!.score
                          )}`}
                        >
                          {scores.get(project.projects_id)!.score}
                        </span>
                      )}
                    </div>

                    <div className="browse-card__body">
                      <h2 className="browse-card__title">{project.title}</h2>

                      <p className="browse-card__owner">
                        <IonIcon icon={locationOutline} />
                        {owner
                          ? `${owner.name}${owner.farm_city ? ` — ${owner.farm_city}` : ''}`
                          : 'Farm owner'}
                      </p>

                      <p className="browse-card__desc">{orNone(project.description)}</p>

                      <div className="dash-progress">
                        <span className="dash-progress__fill" style={{ width: `${percent}%` }} />
                      </div>

                      <p className="browse-card__funding">
                        <strong>{peso(project.current_funding)}</strong> of{' '}
                        {peso(project.funding_goal)} ({percent}%)
                      </p>

                      <div className="browse-card__offer">
                        <span className="browse-card__roi">
                          +{Number(project.expected_roi_percent)}% return
                        </span>
                        {project.expected_cycle_days ? (
                          <span className="browse-card__cycle">
                            in about {project.expected_cycle_days} days
                          </span>
                        ) : null}
                      </div>

                      <div className="browse-card__foot">
                        <span className="browse-card__remaining">
                          {project.status === 'Open'
                            ? `${peso(remaining(project))} to go`
                            : project.status}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="dash-btn dash-btn--primary browse-card__invest"
                        disabled={remaining(project) <= 0}
                        onClick={() => openInvest(project)}
                      >
                        {remaining(project) <= 0 ? 'Fully funded' : 'Invest'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {investing && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Invest in this project"
            onClick={closeInvest}
          >
            <div
              className="dash-modal__panel dash-modal__panel--wide"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">
                    {owners.get(investing.customers_id)?.name ?? 'Farm owner'}
                    {owners.get(investing.customers_id)?.farm_city
                      ? ` \u2014 ${owners.get(investing.customers_id)?.farm_city}`
                      : ''}
                  </p>
                  <h2 className="dash-modal__title">{investing.title}</h2>
                </div>

                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={closeInvest}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                {error && <p className="dash-error">{error}</p>}

                {(() => {
                  const owner = owners.get(investing.customers_id);
                  const record = records.get(investing.customers_id);
                  const attached = credentials.get(investing.projects_id) ?? [];
                  const place = [owner?.farm_barangay, owner?.farm_city, owner?.farm_province]
                    .filter(Boolean)
                    .join(', ');

                  return (
                    <section className="owner-card">
                      <div className="owner-card__head">
                        <div>
                          <p className="owner-card__label">Farm Owner</p>
                          <p className="owner-card__name">{owner?.name ?? 'Farm owner'}</p>
                          <p className="owner-card__place">
                            <IonIcon icon={locationOutline} /> {place || 'Location not given'}
                          </p>
                        </div>
                        <div className="owner-card__record">
                          <p>
                            <strong>{record?.completed_projects ?? 0}</strong> completed of{' '}
                            {record?.total_projects ?? 0} projects
                          </p>
                          <p>
                            {record?.rating_count
                              ? `${Number(record.average_rating).toFixed(1)} / 5 from ${record.rating_count} review${record.rating_count === 1 ? '' : 's'}`
                              : 'No reviews yet'}
                          </p>
                          <p className={record?.open_disputes ? 'owner-card__warn' : ''}>
                            {record?.open_disputes
                              ? `${record.open_disputes} open dispute${record.open_disputes === 1 ? '' : 's'}`
                              : 'No open disputes'}
                          </p>
                        </div>
                      </div>

                      <p className="owner-card__label">Requirements checked by FarmVest</p>
                      <ul className="owner-card__checks">
                        {REQUIREMENT_ORDER.filter((type) => attached.includes(type)).map((type) => (
                          <li key={type}>
                            <IonIcon icon={checkmarkCircleOutline} /> {type}
                          </li>
                        ))}
                        {investing.rsbsa_name && investing.rsbsa_name !== 'None' && !attached.includes('RSBSA Registration') && (
                          <li>
                            <IonIcon icon={checkmarkCircleOutline} /> RSBSA Registration
                          </li>
                        )}
                        <li>
                          <IonIcon icon={checkmarkCircleOutline} /> Identity verified against a government ID
                        </li>
                      </ul>
                      <p className="owner-card__note">
                        The documents themselves stay private to the farm owner and FarmVest under the
                        Data Privacy Act. FarmVest reviewed each one before this project opened.
                      </p>
                    </section>
                  );
                })()}

                <CostEstimateCard project={investing} />

                <div className="invest-summary">
                  <div>
                    <p className="dash-stat__label">Still to raise</p>
                    <p className="invest-summary__value">{peso(remaining(investing))}</p>
                  </div>
                  <div>
                    <p className="dash-stat__label">Return offered</p>
                    <p className="invest-summary__value">
                      +{Number(investing.expected_roi_percent)}%
                    </p>
                  </div>
                  <div>
                    <p className="dash-stat__label">Expected within</p>
                    <p className="invest-summary__value">
                      {investing.expected_cycle_days
                        ? `${investing.expected_cycle_days} days`
                        : 'Not stated'}
                    </p>
                  </div>
                </div>

                {/* What they get back, computed from what they are typing,
                    because a percentage is not a figure anybody checks in
                    their head while deciding. */}
                <div className="invest-return">
                  <p className="dash-stat__label">You would be repaid</p>
                  <p className="invest-return__value">
                    {peso(
                      expectedReturn(Number(amount) || 0, Number(investing.expected_roi_percent))
                    )}
                  </p>
                  <p className="dash-row__meta">
                    {peso(Number(amount) || 0)} plus {Number(investing.expected_roi_percent)}%.
                    Expected, not guaranteed by FarmVest.
                  </p>
                </div>

                <div className="invest-security">
                  <p className="dash-field-label">Secured against</p>
                  <p className="invest-security__asset">{orNone(investing.collateral_type)}</p>
                  <p className="dash-row__meta">{orNone(investing.collateral_description)}</p>
                  <p className="dash-row__meta">
                    Declared value {peso(Number(investing.collateral_value ?? 0))}. The value is
                    the farm owner's own statement; FarmVest does not appraise it.
                  </p>
                </div>

                <div className="dash-form dash-form--two">
                  <div className="dash-field">
                    <label htmlFor="invest-amount">Amount (PHP)</label>
                    <input
                      id="invest-amount"
                      className="dash-input"
                      type="number"
                      min={minimumFor(investing)}
                      max={remaining(investing)}
                      step="100"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                    <p className="dash-row__meta">
                      {minimumFor(investing) < MINIMUM_INVESTMENT
                        ? `Only ${peso(remaining(investing))} is left, so that is the amount to commit.`
                        : `${peso(MINIMUM_INVESTMENT)} minimum, up to the ${peso(
                            remaining(investing)
                          )} still needed.`}
                    </p>
                  </div>

                  <div className="dash-field">
                    <label htmlFor="invest-signatory">Sign With Your Full Name</label>
                    <input
                      id="invest-signatory"
                      className="dash-input"
                      value={signatory}
                      onChange={(event) => setSignatory(event.target.value)}
                      placeholder="As written on your valid ID"
                    />
                  </div>
                </div>

                {/* The risk clause is lifted out of the agreement and shown
                    plainly. An investor who scrolls past section 4 is the one
                    who will be surprised when animals die, and being surprised
                    then is the failure this box exists to prevent. */}
                <div className="invest-warning">
                  <IonIcon icon={alertCircleOutline} />
                  <div>
                    <p className="invest-warning__title">
                      The farm owner owes this back. FarmVest does not.
                    </p>
                    <p className="invest-warning__body">
                      The obligation does not depend on the harvest: disease, weather, dead
                      livestock and a fall in price are the farm owner's risk, and they still owe
                      the amount and the return. The pledged asset above is what you can pursue if
                      they do not pay, through the ordinary legal process. FarmVest records the
                      agreement and holds the documents; it does not guarantee repayment, does not
                      appraise the asset, and does not foreclose on your behalf.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="invest-terms__toggle"
                  onClick={() => {
                    setShowTerms(!showTerms);
                    setTermsOpened(true);
                  }}
                >
                  {showTerms ? 'Hide the full agreement' : 'Read the full agreement'}
                </button>

                {showTerms && (
                  <pre className="invest-terms">
                    {termsFor(investing, Number(amount) || 0)}
                  </pre>
                )}

                {!termsOpened && (
                  <p className="invest-accept__hint">
                    Open the full agreement above before you can accept it.
                  </p>
                )}

                <label className={`invest-accept${termsOpened ? '' : ' invest-accept--locked'}`}>
                  <input
                    type="checkbox"
                    checked={accepted}
                    disabled={!termsOpened}
                    onChange={(event) => setAccepted(event.target.checked)}
                  />
                  <span>
                    I have read the agreement, I accept that this amount is at risk, and I am
                    signing it as {signatory.trim() || 'myself'}.
                  </span>
                </label>
              </div>

              <div className="dash-modal__foot">
                <button type="button" className="dash-btn dash-btn--ghost" onClick={closeInvest}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="dash-btn dash-btn--primary"
                  disabled={committing || !accepted || Number(amount) < minimumFor(investing)}
                  onClick={commitInvestment}
                >
                  {committing ? 'Committing...' : `Commit ${peso(Number(amount) || 0)}`}
                </button>
              </div>
            </div>
          </Portal>
        )}

        {verifyFor && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Verify your identity"
            onClick={() => setVerifyFor(null)}
          >
            <div className="dash-modal__panel" onClick={(event) => event.stopPropagation()}>
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Before your first investment</p>
                  <h2 className="dash-modal__title">Identity Check</h2>
                </div>
                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setVerifyFor(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                {profile?.verification_status === 'Flagged' ? (
                  <p className="dash-notice">
                    An administrator needs to look at your last attempt, because the match was close
                    rather than certain. You can invest as soon as that is done.
                  </p>
                ) : (
                  <>
                    {profile?.verification_status === 'Rejected' && (
                      <p className="dash-notice">
                        Your last attempt did not match. That is usually the photograph rather than
                        the person: poor light, an ID held at an angle, or a face too far from the
                        camera. Try again below.
                      </p>
                    )}
                    <p className="dash-notice">
                      This is asked once. After it, every investment opens straight away.
                    </p>
                    <IdentityVerification
                      onDone={async (outcome) => {
                        const project = verifyFor;
                        await refreshProfile();
                        setVerifyFor(null);
                        if (outcome === 'Approved') openInvest(project, true);
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          </Portal>
        )}

      </IonContent>
    </IonPage>
  );
};

export default BrowseProjects;
