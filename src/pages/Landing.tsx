import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IonContent, IonPage } from '@ionic/react';
import PublicNav from '../components/PublicNav';
import EmptyState from '../components/EmptyState';
import { supabase } from '../supabaseClient';
import { useAuth, homeRouteForRole } from '../contexts/AuthContext';
import { peso } from '../lib/format';
import { categoryLook, EQUIPMENT_LOOK } from '../lib/categories';
import { EQUIPMENT_GROUP_NAMES, groupOf } from '../lib/equipment';

/**
 * Units shown per category before View more.
 *
 * Four fills one row on a wide screen and keeps the whole fleet section to
 * about a screen, which is the point: a visitor scrolling past twenty tractors
 * never reaches the sign-up at the bottom.
 */
const EQUIPMENT_PREVIEW = 4;
import './Landing.css';

/** A row of public_projects: what a visitor may see of a livestock project. */
type PublicProject = {
  projects_id: string;
  title: string;
  category: string | null;
  funding_goal: number | string | null;
  current_funding: number | string | null;
  status: string;
  image_url: string | null;
};

/** A row of public_equipment. condition_notes is left out of the view on purpose. */
type PublicEquipment = {
  equipment_id: string;
  name: string;
  type: string | null;
  price_per_day: number | string | null;
  availability_status: string | null;
  image_url: string | null;
};

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Create your account',
    body: 'Sign up once and upload a valid ID. The administrator verifies you before any money moves, and the same account both raises funding and invests.',
  },
  {
    step: '02',
    title: 'Post or fund a project',
    body: 'Publish a livestock project with a funding goal, or browse the approved ones and fund the share you want. Most people end up doing both.',
  },
  {
    step: '03',
    title: 'Follow the progress',
    body: 'Whoever runs the farm posts progress updates with photos. Whoever funded it tracks funding, milestones and returns from the same dashboard.',
  },
];

const FAQ = [
  {
    q: 'Do I need an account to look around?',
    a: 'No. Every approved project and every unit in the equipment fleet is listed on this page. An account is only needed to open the full details and to invest or book.',
  },
  {
    q: 'Who can join FarmVest?',
    a: 'Anyone raising livestock who needs capital or machinery, and anyone who wants to fund a real farm. There is one account for both, because the same person is often both.',
  },
  {
    q: 'How is a project approved?',
    a: 'A new project starts as Pending Approval and is reviewed by the administrator. Only approved projects appear here and accept funding.',
  },
  {
    q: 'What is the equipment section for?',
    a: 'Farm owners rent equipment they do not own, such as feeders, incubators and transport, by the day, booked through the platform.',
  },
  {
    q: 'Is there a fee?',
    a: 'FarmVest keeps a 5% commission on each investment. Equipment is owned by FarmVest, so a rental is charged as a daily rate rather than a commission. Browsing and signing up cost nothing.',
  },
];

/** Percentage funded, clamped so a fully funded bar never overflows its track. */
const fundedPercent = (project: PublicProject) => {
  const goal = Number(project.funding_goal ?? 0);
  const raised = Number(project.current_funding ?? 0);
  if (goal <= 0) return 0;
  return Math.min(100, Math.round((raised / goal) * 100));
};

/**
 * The public catalogue.
 *
 * This is the one page in the app that runs with no session, so it reads the
 * public_projects and public_equipment views rather than the tables: the read
 * policies on projects and equipment are granted to authenticated only, and a
 * signed-out visitor is the anon role. The views carry a teaser row and leave
 * out everything that identifies a farm owner.
 *
 * Nothing here is seeded. A fresh database shows the empty state, which is the
 * honest thing for a marketplace nobody has posted to yet.
 */
const Landing: React.FC = () => {
  const navigate = useNavigate();
  const { role, loading: authLoading } = useAuth();

  const [projects, setProjects] = useState<PublicProject[]>([]);
  const [equipment, setEquipment] = useState<PublicEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  // No All tab: the catalogue opens on its first category, as the equipment
  // section opens on its first group.
  const [projectCategory, setProjectCategory] = useState('');
  const [equipmentGroup, setEquipmentGroup] = useState<string | null>(null);
  /** Reset whenever the tab changes: a page count belongs to one list. */
  const [showAllInGroup, setShowAllInGroup] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Somebody who is already signed in has a dashboard; the front door is not
  // where they should land.
  useEffect(() => {
    if (!authLoading && role) navigate(homeRouteForRole(role), { replace: true });
  }, [authLoading, role, navigate]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const [projectResult, equipmentResult] = await Promise.all([
        supabase
          .from('public_projects')
          .select(
            'projects_id, title, category, funding_goal, current_funding, status, image_url',
          )
          .order('created_at', { ascending: false }),
        supabase
          .from('public_equipment')
          .select('equipment_id, name, type, price_per_day, availability_status, image_url')
          .order('created_at', { ascending: false }),
      ]);

      if (!active) return;

      const failure = projectResult.error ?? equipmentResult.error;
      if (failure) setError(failure.message);

      setProjects((projectResult.data as PublicProject[]) ?? []);
      setEquipment((equipmentResult.data as PublicEquipment[]) ?? []);
      setLoading(false);
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  const query = search.trim().toLowerCase();

  const visibleProjects = useMemo(
    () =>
      projects.filter((project) => {
        // A search looks across every category, so a match is never hidden
        // behind a tab that is not selected.
        const matchesCategory = !!query || (project.category ?? 'Other') === projectCategory;
        const matchesQuery =
          !query ||
          project.title.toLowerCase().includes(query) ||
          (project.category ?? '').toLowerCase().includes(query);
        return matchesCategory && matchesQuery;
      }),
    [projects, projectCategory, query],
  );

  // Both chip rows are built from the rows that came back rather than from a
  // fixed list: a category nobody has posted to is a filter that can only lead
  // to an empty grid.
  const projectCategories = useMemo(() => {
    const found = new Set<string>();
    projects.forEach((project) => found.add(project.category ?? 'Other'));
    return Array.from(found).sort();
  }, [projects]);

  // Select the first category once the projects arrive, or when the one
  // selected no longer has anything in it.
  useEffect(() => {
    if (projectCategories.length > 0 && !projectCategories.includes(projectCategory)) {
      setProjectCategory(projectCategories[0]);
    }
  }, [projectCategories, projectCategory]);

  /**
   * The fleet filed under the eight groups the Admin picks a type from.
   *
   * Grouping rather than listing every type is what keeps this section short: a
   * chip per type meant twenty-odd chips wrapping over three lines before a
   * single unit was visible.
   */
  const equipmentByGroup = useMemo(() => {
    const found = new Map<string, PublicEquipment[]>();

    equipment.forEach((unit) => {
      const matchesQuery =
        !query ||
        unit.name.toLowerCase().includes(query) ||
        (unit.type ?? '').toLowerCase().includes(query);

      if (!matchesQuery) return;

      // A unit whose type matches nothing is filed under its own type name, so
      // it is still reachable rather than silently dropped.
      const group = groupOf(unit.name, unit.type) ?? unit.type ?? 'Other';
      found.set(group, [...(found.get(group) ?? []), unit]);
    });

    return found;
  }, [equipment, query]);

  /** Only groups that actually hold a unit, in the Admin's own order. */
  const equipmentGroups = useMemo(() => {
    const named = EQUIPMENT_GROUP_NAMES.filter((group) => equipmentByGroup.has(group));
    const extra = Array.from(equipmentByGroup.keys())
      .filter((group) => !EQUIPMENT_GROUP_NAMES.includes(group))
      .sort();

    return [...named, ...extra];
  }, [equipmentByGroup]);

  // The first tab with something in it, kept current as the search narrows the
  // list under the tab that was open.
  useEffect(() => {
    if (equipmentGroups.length === 0) {
      setEquipmentGroup(null);
      return;
    }

    if (!equipmentGroup || !equipmentGroups.includes(equipmentGroup)) {
      setEquipmentGroup(equipmentGroups[0]);
      setShowAllInGroup(false);
    }
  }, [equipmentGroups, equipmentGroup]);

  const groupUnits = equipmentGroup ? (equipmentByGroup.get(equipmentGroup) ?? []) : [];
  const visibleEquipment = showAllInGroup ? groupUnits : groupUnits.slice(0, EQUIPMENT_PREVIEW);

  /** Sends a visitor to the login form, remembering what they were trying to open. */
  const gateTo = (returnTo: string) => navigate('/login', { state: { returnTo } });

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <IonPage>
      <PublicNav />

      <IonContent className="landing-content" scrollEvents>

        {/* ---------------------------------------------------------------- */}
        {/* hero                                                             */}
        {/* ---------------------------------------------------------------- */}
        <section className="hero" id="top">
          <div className="hero__inner">
            <div className="hero__copy">
              <span className="hero__badge">Livestock investment platform</span>
              <h1 className="hero__title">
                Fund a farm. <span>Grow together.</span>
              </h1>
              <p className="hero__lead">
                FarmVest connects livestock farm owners who need capital with investors who want a
                real, verified place to put it, and rents out the equipment the work needs.
              </p>

              <form
                className="hero__search"
                onSubmit={(event) => {
                  event.preventDefault();
                  scrollTo('projects');
                }}
              >
                <span className="hero__search-icon" aria-hidden="true">
                  &#128269;
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search projects and equipment"
                  aria-label="Search projects and equipment"
                />
                <button type="submit">Search</button>
              </form>

              <div className="hero__actions">
                <button
                  type="button"
                  className="btn btn--solid"
                  onClick={() => navigate('/register')}
                >
                  Get Started
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => scrollTo('projects')}
                >
                  Browse Projects
                </button>
              </div>

              <div className="hero__stats">
                <div>
                  <strong>{loading ? '--' : projects.length}</strong>
                  <span>Open projects</span>
                </div>
                <div>
                  <strong>{loading ? '--' : equipment.length}</strong>
                  <span>Equipment units</span>
                </div>
              </div>
            </div>

          </div>
        </section>

        {error && (
          <p className="landing-error" role="alert">
            {error}
          </p>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* projects                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="section" id="projects">
          <div className="section__inner">
            <header className="section__head">
              <div>
                <h2>Livestock Projects</h2>
                <p>Approved projects looking for funding. Log in to open the full details.</p>
              </div>
            </header>

            {/* One category is nothing to filter by, so the row only appears
                once there is a real choice to make. */}
            {projectCategories.length > 1 && (
              <div className="chips" role="group" aria-label="Filter projects by category">
                {projectCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={`chip${projectCategory === category ? ' chip--on' : ''}`}
                    onClick={() => setProjectCategory(category)}
                  >
                    {`${categoryLook(category).emoji} ${category}`}
                  </button>
                ))}
              </div>
            )}

            {loading ? (
              <div className="grid">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="card card--skeleton" />
                ))}
              </div>
            ) : visibleProjects.length === 0 ? (
              <EmptyState
                title={projects.length === 0 ? 'No projects yet' : 'No projects match your search'}
                message={
                  projects.length === 0
                    ? 'Farm owners have not posted a project yet. Sign up as a farm owner to be the first.'
                    : 'Try another category, or clear the search box above.'
                }
              />
            ) : (
              <div className="grid">
                {visibleProjects.map((project) => {
                  const look = categoryLook(project.category);
                  const percent = fundedPercent(project);

                  return (
                    <article key={project.projects_id} className="card">
                      <div className="card__media" style={{ background: look.tint }}>
                        {project.image_url ? (
                          <img src={project.image_url} alt={project.title} loading="lazy" />
                        ) : (
                          <span className="card__placeholder" aria-hidden="true">
                            {look.emoji}
                          </span>
                        )}
                        <span className="card__tag">{project.category ?? 'Other'}</span>
                      </div>

                      <div className="card__body">
                        <h3 className="card__title">{project.title}</h3>

                        <div className="card__meta">
                          <span className="card__status">{project.status}</span>
                        </div>

                        <div className="progress">
                          <div className="progress__track">
                            <div className="progress__fill" style={{ width: `${percent}%` }} />
                          </div>
                          <div className="progress__labels">
                            <span>{peso(project.current_funding)} raised</span>
                            <strong>{percent}%</strong>
                          </div>
                          <p className="progress__goal">Goal {peso(project.funding_goal)}</p>
                        </div>

                        <button
                          type="button"
                          className="card__cta"
                          onClick={() => gateTo('/app')}
                        >
                          Log in to view more
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* equipment                                                        */}
        {/* ---------------------------------------------------------------- */}
        <section className="section section--alt" id="equipment">
          <div className="section__inner">
            <header className="section__head">
              <div>
                <h2>Equipment for Rent</h2>
                <p>Rented by the day. Log in as a farm owner to check a date and book.</p>
              </div>
            </header>

            {equipmentGroups.length > 1 && (
              <div className="chips" role="group" aria-label="Filter equipment by category">
                {equipmentGroups.map((group) => (
                  <button
                    key={group}
                    type="button"
                    className={`chip${equipmentGroup === group ? ' chip--on' : ''}`}
                    onClick={() => {
                      setEquipmentGroup(group);
                      setShowAllInGroup(false);
                    }}
                  >
                    {group} ({equipmentByGroup.get(group)?.length ?? 0})
                  </button>
                ))}
              </div>
            )}

            {loading ? (
              <div className="grid">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="card card--skeleton" />
                ))}
              </div>
            ) : visibleEquipment.length === 0 ? (
              <EmptyState
                title={
                  equipment.length === 0 ? 'No equipment yet' : 'No equipment matches your search'
                }
                message={
                  equipment.length === 0
                    ? 'The administrator has not added any units to the fleet yet.'
                    : 'Try another category, or clear the search box above.'
                }
              />
            ) : (
              <div className="grid">
                {visibleEquipment.map((unit) => {
                  const available = unit.availability_status === 'Available';

                  return (
                    <article key={unit.equipment_id} className="card">
                      <div className="card__media" style={{ background: EQUIPMENT_LOOK.tint }}>
                        {unit.image_url ? (
                          <img src={unit.image_url} alt={unit.name} loading="lazy" />
                        ) : (
                          <span className="card__placeholder" aria-hidden="true">
                            {EQUIPMENT_LOOK.emoji}
                          </span>
                        )}
                        {unit.type && <span className="card__tag">{unit.type}</span>}
                      </div>

                      <div className="card__body">
                        <h3 className="card__title">{unit.name}</h3>

                        <div className="card__meta">
                          <span className={`avail${available ? ' avail--on' : ''}`}>
                            {unit.availability_status ?? 'Unavailable'}
                          </span>
                        </div>

                        <p className="card__price">
                          <strong>{peso(unit.price_per_day)}</strong> <span>/ day</span>
                        </p>

                        <button
                          type="button"
                          className="card__cta"
                          onClick={() => gateTo('/app/equipment')}
                        >
                          Log in to view more
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* Only when the tab is holding more back. Once opened it stays
                open for that tab, and switching tabs starts the next one
                closed again. */}
            {!loading && groupUnits.length > EQUIPMENT_PREVIEW && (
              <div className="section__more">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setShowAllInGroup((current) => !current)}
                >
                  {showAllInGroup
                    ? 'Show less'
                    : `View more (${groupUnits.length - EQUIPMENT_PREVIEW})`}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* how it works                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section className="section" id="how">
          <div className="section__inner">
            <header className="section__head section__head--center">
              <div>
                <h2>How It Works</h2>
                <p>Three steps from signing up to following your first project.</p>
              </div>
            </header>

            <div className="steps">
              {HOW_IT_WORKS.map((item) => (
                <div key={item.step} className="step">
                  <span className="step__number">{item.step}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* trust                                                            */}
        {/* ---------------------------------------------------------------- */}
        <section className="section section--alt">
          <div className="section__inner trust">
            <div className="trust__copy">
              <h2>Verified before anything moves</h2>
              <p>
                Every farm owner and investor uploads a valid ID and is approved by the
                administrator before they can post, fund or book. Projects are reviewed the same
                way, and a project under investigation is pulled from this page immediately.
              </p>
            </div>

            <ul className="trust__list">
              <li>
                <strong>ID verification</strong>
                <span>Admin-reviewed against a government ID, every account.</span>
              </li>
              <li>
                <strong>Reviewed projects</strong>
                <span>Only approved projects are listed and fundable.</span>
              </li>
              <li>
                <strong>Tracked funds</strong>
                <span>Every investment and rental is recorded against the project.</span>
              </li>
              <li>
                <strong>Progress photos</strong>
                <span>Owners post updates investors can check against.</span>
              </li>
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* faq                                                              */}
        {/* ---------------------------------------------------------------- */}
        <section className="section" id="faq">
          <div className="section__inner section__inner--narrow">
            <header className="section__head section__head--center">
              <div>
                <h2>Frequently Asked Questions</h2>
              </div>
            </header>

            <div className="faq">
              {FAQ.map((item, index) => (
                <div
                  key={item.q}
                  className={`faq__item${openFaq === index ? ' faq__item--open' : ''}`}
                >
                  <button
                    type="button"
                    className="faq__q"
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    aria-expanded={openFaq === index}
                  >
                    <span>{item.q}</span>
                    <span className="faq__sign" aria-hidden="true">
                      {openFaq === index ? '−' : '+'}
                    </span>
                  </button>
                  {openFaq === index && <p className="faq__a">{item.a}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* closing call to action                                           */}
        {/* ---------------------------------------------------------------- */}
        <section className="closing">
          <div className="closing__inner">
            <h2>Ready to start?</h2>
            <p>Create an account as a farm owner or an investor. Verification takes one review.</p>
            <button
              type="button"
              className="btn btn--gold"
              onClick={() => navigate('/register')}
            >
              Get Started
            </button>
          </div>
        </section>

        <footer className="foot">
          <div className="foot__inner">
            <span className="foot__brand">
              Farm<b>Vest</b>
            </span>
            <span className="foot__note">
              A livestock investment and equipment rental platform.
            </span>
          </div>
        </footer>
      </IonContent>
    </IonPage>
  );
};

export default Landing;
