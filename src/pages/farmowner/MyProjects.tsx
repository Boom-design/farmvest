import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import {
  addOutline,
  checkmarkCircle,
  closeOutline,
  cloudUploadOutline,
  documentTextOutline,
  ellipseOutline,
  imageOutline,
} from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import Portal from '../../components/Portal';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { firstOf, hasValue, NONE, orNone, peso, pillClass, shortDate } from '../../lib/format';
import { PROJECT_CATEGORIES, categoryLook } from '../../lib/categories';
import {
  COLLATERAL_HINTS,
  COLLATERAL_TYPES,
  CREDENTIAL_TYPES as FUNDING_CREDENTIALS,
  fundingCap,
  requirementsFor,
} from '../../lib/funding';
import IdentityVerification from '../../components/IdentityVerification';
import { DEFAULT_COST_ITEMS, totalOf, type CostLine } from '../../lib/liquidation';
import { isFullyReleased } from '../../lib/funding';
import CostEstimateCard from '../../components/CostEstimateCard';
import PaymentForm from '../../components/PaymentForm';
import { COMMISSION_RATE, projectCommission } from '../../lib/revenue';

/** What a project sends back: the investors' capital and return, and the commission. */
const repaymentOf = (project: { investments?: { amount: number }[]; expected_roi_percent: number }) => {
  const capital = (project.investments ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  const investors = Math.round(capital * (1 + Number(project.expected_roi_percent ?? 0) / 100) * 100) / 100;
  const commission = projectCommission(capital);
  return { capital, investors, commission, total: Math.round((investors + commission) * 100) / 100 };
};
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type ProjectRow = {
  projects_id: string;
  title: string;
  description: string | null;
  funding_goal: number;
  current_funding: number;
  category: string | null;
  image_url: string | null;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  estimated_heads: number | null;
  expected_mortality_percent: number;
  expected_roi_percent: number;
  expected_price_per_head: number | null;
  cost_breakdown: CostLine[];
  fund_releases: { stage: string }[];
  liquidations: { status: string; admin_notes: string }[];
  investments: { amount: number }[];
  repayments: { status: string; admin_notes: string; submitted_at: string }[];
};

/** One expense line of the liquidation form, as typed. */
type SpentLine = { id: number; item: string; amount: string };

/**
 * What the farm owner attaches, split by the question each answers.
 *
 * A credential answers "is this a real farmer or farm business". Which ones a
 * farmer holds varies at both ends of the market -- a registered farm business
 * usually has a permit and no RSBSA, a smallholder in a remote barangay often
 * has nothing but a barangay certificate -- so any of them count and none is
 * demanded by name.
 *
 * RSBSA is not here. It is filled in rather than uploaded, because the public
 * finder searches by name and birthday, and a photograph of a card gives the
 * Admin nothing to type into it.
 */
const CREDENTIAL_TYPES = FUNDING_CREDENTIALS.filter(
  (type) => type !== 'RSBSA Registration'
);

/** These describe this cycle rather than the farm, so they are per project. */
const PROJECT_EVIDENCE_TYPES = [
  'Collateral Proof',
  'Farm Photo',
  'Project Proposal',
  'Cost Estimate',
];

const DOC_TYPES = [...CREDENTIAL_TYPES, ...PROJECT_EVIDENCE_TYPES];

const DOC_HINTS: Record<string, string> = {
  'Proof of Land': 'Land title, tax declaration, CLOA, or a lease or tenancy contract.',
  'Barangay or LGU Certification': 'A barangay certification that you farm here.',
  'Business Permit': "DTI or SEC registration, or the mayor's permit for the farm.",
  'Veterinary or Facility Permit':
    'City or provincial veterinary office registration for the facility.',
  'Collateral Proof':
    'The title, OR and CR, or deed for the asset you are pledging. Required.',
  'Farm Photo': 'The actual coop, pen or pond this project is for.',
  'Project Proposal': 'What you plan to do, over what timeline.',
  'Cost Estimate': 'How the funding goal is spent, item by item.',
};

/**
 * How many credential documents a project must carry.
 *
 * One is too easy. A single barangay certificate is a page of text from an
 * office that issues hundreds a week, and a business permit on its own says a
 * business exists, not that it farms. Two documents from different offices have
 * to agree with each other and with the valid ID, which is a much harder thing
 * to assemble than it is to obtain.
 *
 * Two rather than a specific pair, deliberately. Demanding RSBSA and DTI
 * together would exclude both ends of the market: RSBSA covers the basic sector
 * and rarely lists a registered farm business, while a smallholder in a remote
 * barangay may hold neither. Any two of the five is reachable by a real farmer
 * on either end, and out of reach for someone with no farm at all.
 */
const REQUIRED_CREDENTIALS = 2;

/** Matches the file size limit set on the project-documents bucket. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * One row of the document section: a type and the file filed under it.
 *
 * Rows rather than one picker feeding a list, because the two are answering
 * different questions. A picker asks "add another thing", which is a fine way
 * to attach photos and a poor way to fill in a requirement: the farm owner
 * cannot see how many slots they have or what still needs filling. A row that
 * exists before its file does shows the shape of what is being asked for.
 */
type DocumentRow = { id: number; docType: string; file: File | null };

/** Matches the file size limit set on the project-photos bucket. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * One tab per status a project can still be in, in the order it passes through
 * them. There is no All tab: it only ever repeated what the other tabs already
 * held, and it was the reason three statuses were reachable nowhere else.
 *
 * Only work in hand is here. A project that has ended, whether Completed,
 * Rejected, Cancelled or Under Investigation, is a record rather than work in
 * hand, so it lives on the Reports page.
 */
const FILTERS = ['Pending Approval', 'Open', 'Funded', 'In Progress'];

/** One line of the posted budget, as typed. */
type BudgetLine = { id: number; item: string; amount: string };

const freshBudget = (): BudgetLine[] =>
  DEFAULT_COST_ITEMS.map((item, index) => ({ id: index + 1, item, amount: '' }));

const emptyForm = {
  estimatedHeads: '',
  expectedMortality: '5',
  expectedPrice: '',
  title: '',
  description: '',
  fundingGoal: '',
  category: 'Poultry',
  rsbsaName: '',
  rsbsaNumber: '',
  expectedRoi: '',
  expectedCycleDays: '',
  collateralType: COLLATERAL_TYPES[0],
  collateralDescription: '',
  collateralValue: '',
};

const MyProjects: React.FC = () => {
  const { profile, refreshProfile } = useAuth();
  const [budget, setBudget] = useState<BudgetLine[]>(freshBudget);

  // The liquidation form: the project being closed and what is being reported.
  const [liquidating, setLiquidating] = useState<ProjectRow | null>(null);
  /** The project being repaid, while its payment form is open. */
  const [repaying, setRepaying] = useState<ProjectRow | null>(null);
  /** The project whose posted budget is open for a second look. */
  const [budgetOf, setBudgetOf] = useState<ProjectRow | null>(null);
  const [liq, setLiq] = useState({ stocked: '', mortality: '', reason: '', harvested: '', sales: '', notes: '' });
  const [spent, setSpent] = useState<SpentLine[]>([]);
  const [receipts, setReceipts] = useState<File[]>([]);
  const [liqError, setLiqError] = useState<string | null>(null);
  const [liqSaving, setLiqSaving] = useState(false);
  const nextBudgetId = useRef(DEFAULT_COST_ITEMS.length + 1);
  const { showSuccess } = useToast();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [filter, setFilter] = useState(FILTERS[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  /**
   * Whether the identity check stands between this customer and posting.
   *
   * Registration asks for nothing but a name and a password, because signing up
   * commits to nothing. Posting a project is where someone starts asking other
   * people for money, and that is the first point at which it is worth knowing
   * who they are. The same test is enforced by the insert policy on projects,
   * so this is the polite half of the rule rather than the whole of it.
   */
  const [verifying, setVerifying] = useState(false);

  /** The modal's scroll container, so a new error can be scrolled to. */
  const formBodyRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);

  /**
   * Whether this account has a farm address yet.
   *
   * Registration stopped asking for one, because someone who only wants to
   * invest has no farm. That makes this the first point where it is genuinely
   * needed: it is the area investors see on the project, and it is what the
   * weather advisory forecasts for.
   */
  const [hasFarmAddress, setHasFarmAddress] = useState(true);

  /** Finished projects raise the funding ceiling by PHP 50,000 each. */
  const [completedCount, setCompletedCount] = useState(0);

  // Two rows to start, defaulted to the two things every project needs: one
  // proof that this is a real farm, and one photo of the facility.
  const [rows, setRows] = useState<DocumentRow[]>([
    { id: 1, docType: CREDENTIAL_TYPES[0], file: null },
    { id: 2, docType: CREDENTIAL_TYPES[1], file: null },
    { id: 3, docType: 'Farm Photo', file: null },
  ]);
  const nextDocId = useRef(3);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    const [{ data, error: loadError }, addressRes] = await Promise.all([
      supabase
        .from('projects')
        .select(
          'projects_id, title, description, category, image_url, funding_goal, current_funding, status, rejection_reason, created_at, estimated_heads, expected_mortality_percent, expected_roi_percent, expected_price_per_head, cost_breakdown, fund_releases(stage), liquidations(status, admin_notes), investments(amount), repayments(status, admin_notes, submitted_at)'
        )
        .eq('customers_id', profile.users_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('customers')
        .select('farm_city, farm_province')
        .eq('customers_id', profile.users_id)
        .maybeSingle(),
    ]);

    if (loadError) {
      setError(loadError.message);
    } else {
      setProjects((data ?? []) as ProjectRow[]);
      setCompletedCount(
        ((data ?? []) as ProjectRow[]).filter((row) => row.status === 'Completed').length
      );
    }

    const address = addressRes.data as { farm_city: string | null; farm_province: string | null } | null;
    setHasFarmAddress(hasValue(address?.farm_city) && hasValue(address?.farm_province));

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!profile) return;

    const goal = Number(form.fundingGoal);

    if (!form.title.trim()) {
      setError('Please enter a project title.');
      return;
    }

    if (!Number.isFinite(goal) || goal <= 0) {
      setError('Please enter a funding goal greater than zero.');
      return;
    }

    const heads = Number(form.estimatedHeads);
    if (!Number.isInteger(heads) || heads <= 0) {
      setError('Enter how many head this project will raise.');
      return;
    }

    if (!(Number(form.expectedPrice) > 0)) {
      setError('Enter what one head is expected to sell for at harvest.');
      return;
    }

    const lines = budget
      .filter((line) => line.item.trim() && Number(line.amount) > 0)
      .map((line) => ({ item: line.item.trim(), amount: Number(line.amount) }));
    if (Math.abs(totalOf(lines) - goal) > 1) {
      setError(
        `Your cost estimate adds up to ${peso(totalOf(lines))}, but the funding goal is ${peso(goal)}. Make the budget account for every peso you ask for.`
      );
      return;
    }

    if (photo && photo.size > MAX_PHOTO_BYTES) {
      setError('The cover photo must be 5 MB or smaller.');
      return;
    }

    // Two credentials and one facility photo is the floor. Anything beyond
    // that is the Admin's judgement rather than the form's: a rejection with a
    // written reason teaches the farm owner what is missing, where a blocked
    // Submit button only tells them to give up.
    //
    // Counted by distinct type, so two copies of the same certificate do not
    // pass as two documents.
    if (credentialsAttached < REQUIRED_CREDENTIALS) {
      setError(
        `FarmVest needs ${REQUIRED_CREDENTIALS} separate proofs that you farm here. You have ${credentialsAttached}. Fill in your RSBSA, or attach another document.`
      );
      return;
    }

    if (!hasFarmPhoto) {
      setError('Attach at least one photo of the coop, pen or pond this project is for.');
      return;
    }

    const roi = Number(form.expectedRoi);

    if (!form.expectedRoi.trim() || !Number.isFinite(roi) || roi <= 0 || roi > 100) {
      setError('Enter the return you expect to pay investors, as a percentage between 1 and 100.');
      return;
    }

    const cycleDays = Number(form.expectedCycleDays);

    if (!form.expectedCycleDays.trim() || !Number.isFinite(cycleDays) || cycleDays < 1) {
      setError('Say roughly how many days the cycle runs once the project is funded.');
      return;
    }

    // Collateral is required on every project. A stated return without security
    // behind it is a promise with nothing standing under it.
    const collateralValue = Number(form.collateralValue);

    if (
      !form.collateralValue.trim() ||
      !Number.isFinite(collateralValue) ||
      collateralValue <= 0
    ) {
      setError('Enter the value of the asset you are pledging.');
      return;
    }

    if (form.collateralDescription.trim().length < 10) {
      setError(
        'Describe the pledged asset well enough to identify it: a title number, a plate number, an address.'
      );
      return;
    }

    if (!hasCollateralProof) {
      setError(
        'Attach proof of the pledged asset. Add a document and set its type to Collateral Proof.'
      );
      return;
    }

    if (goal > cap.cap) {
      setError(
        `Your documents and collateral allow up to ${peso(cap.cap)}. ${
          neededFor[0] ?? cap.advice
        }`
      );
      return;
    }

    setSaving(true);
    setError(null);

    // The cover is uploaded first: a project row pointing at a file that failed
    // to upload would show a broken image on the landing page.
    //
    // The first path segment is the owner's id, which is what the storage
    // policy checks, so nobody can write over another owner's cover.
    let imageUrl: string | null = null;

    if (photo) {
      const extension = photo.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${profile.users_id}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('project-photos')
        .upload(path, photo, { contentType: photo.type || undefined, upsert: true });

      if (uploadError) {
        setError(uploadError.message);
        setSaving(false);
        return;
      }

      imageUrl = supabase.storage.from('project-photos').getPublicUrl(path).data.publicUrl;
    }

    // status is left to the database default of Pending Approval: a project only
    // becomes visible to investors once the Admin approves it.
    //
    const { data: created, error: insertError } = await supabase
      .from('projects')
      .insert({
        customers_id: profile.users_id,
        title: form.title.trim(),
        description: form.description.trim() || NONE,
        category: form.category,
        image_url: imageUrl,
        funding_goal: goal,
        rsbsa_name: form.rsbsaName.trim() || NONE,
        rsbsa_number: form.rsbsaNumber.trim() || NONE,
        expected_roi_percent: roi,
        expected_cycle_days: cycleDays,
        collateral_type: form.collateralType,
        collateral_description: form.collateralDescription.trim(),
        collateral_value: collateralValue,
        estimated_heads: Number(form.estimatedHeads),
        expected_price_per_head: Number(form.expectedPrice) || null,
        expected_mortality_percent: Number(form.expectedMortality) || 0,
        cost_breakdown: budget
          .filter((line) => line.item.trim() && Number(line.amount) > 0)
          .map((line) => ({ item: line.item.trim(), amount: Number(line.amount) })),
      })
      .select('projects_id')
      .single();

    if (insertError || !created) {
      setError(insertError?.message ?? 'The project could not be saved.');
      setSaving(false);
      return;
    }

    // Documents go up after the row exists, because the storage policy keys on
    // the owner's folder and the table row keys on the project. A file uploaded
    // first would be an orphan if the insert failed.
    const attached: { projects_id: string; doc_type: string; file_url: string; file_name: string }[] =
      [];

    for (const entry of filled) {
      const extension = entry.file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${profile.users_id}/${created.projects_id}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('project-documents')
        .upload(path, entry.file, {
          contentType: entry.file.type || undefined,
          upsert: true,
        });

      if (uploadError) {
        setError(`${entry.file.name}: ${uploadError.message}`);
        setSaving(false);
        return;
      }

      attached.push({
        projects_id: created.projects_id,
        doc_type: entry.docType,
        file_url: path,
        file_name: entry.file.name,
      });
    }

    const { error: docError } = await supabase.from('project_documents').insert(attached);

    if (docError) {
      setError(docError.message);
    } else {
      setForm(emptyForm);
      setBudget(freshBudget());
      setPhoto(null);
    setRows([
      { id: 1, docType: CREDENTIAL_TYPES[0], file: null },
      { id: 2, docType: CREDENTIAL_TYPES[1], file: null },
      { id: 3, docType: 'Farm Photo', file: null },
    ]);
    nextDocId.current = 4;
      setShowForm(false);
      showSuccess('Project submitted for approval.');
      await load();
    }

    setSaving(false);
  };

  /**
   * How many separate proofs this project carries.
   *
   * A filled-in RSBSA counts as one of them, and counts as the strongest: it is
   * the only credential the Admin can check against a government database
   * rather than by reading a scan. Documents are counted by distinct type, so
   * two copies of the same certificate do not pass as two proofs.
   */
  /** Only a row with a file counts for anything. */
  const filled = useMemo(
    () => rows.filter((row): row is DocumentRow & { file: File } => row.file !== null),
    [rows]
  );

  const rsbsaGiven = form.rsbsaName.trim().length >= 3;

  /**
   * The ceiling, recomputed as the form is typed.
   *
   * Shown rather than enforced only on submit: a farm owner who types 100,000
   * and is refused afterwards has no idea what to change, and the answer is
   * usually "attach one more paper" rather than "ask for less".
   */
  const capInputs = useMemo(
    () => ({
      credentials: new Set(
        filled
          .filter((row) => CREDENTIAL_TYPES.includes(row.docType))
          .map((row) => row.docType)
      ).size,
      rsbsa: rsbsaGiven,
      completed: completedCount,
      collateralValue: form.collateralValue.trim() === '' ? null : Number(form.collateralValue),
    }),
    [filled, rsbsaGiven, completedCount, form.collateralValue]
  );
  const cap = useMemo(() => fundingCap(capInputs), [capInputs]);

  // What it would take to reach the goal typed, so the form says what to add
  // instead of only that the number is too high.
  const neededFor = useMemo(
    () => requirementsFor(Number(form.fundingGoal) || 0, capInputs),
    [form.fundingGoal, capInputs]
  );

  const hasCollateralProof = useMemo(
    () => filled.some((row) => row.docType === 'Collateral Proof'),
    [filled]
  );

  const credentialsAttached = useMemo(
    () =>
      new Set(
        filled
          .filter((row) => CREDENTIAL_TYPES.includes(row.docType))
          .map((row) => row.docType)
      ).size + (rsbsaGiven ? 1 : 0),
    [filled, rsbsaGiven]
  );

  const hasFarmPhoto = useMemo(
    () => filled.some((row) => row.docType === 'Farm Photo'),
    [filled]
  );

  useEffect(() => {
    if (!error || !showForm) return;
    formBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [error, showForm]);

  /** Open the liquidation form, with the posted budget's lines to fill in. */
  const openLiquidation = (project: ProjectRow) => {
    setLiquidating(project);
    setLiq({
      stocked: project.estimated_heads ? String(project.estimated_heads) : '',
      mortality: '',
      reason: '',
      harvested: '',
      sales: '',
      notes: '',
    });
    const items = project.cost_breakdown?.length
      ? project.cost_breakdown.map((line) => line.item)
      : DEFAULT_COST_ITEMS;
    setSpent(items.map((item, index) => ({ id: index + 1, item, amount: '' })));
    setReceipts([]);
    setLiqError(null);
  };

  const submitLiquidation = async () => {
    if (!liquidating || !profile) return;

    const stocked = Number(liq.stocked);
    const mortality = Number(liq.mortality || 0);
    const harvested = Number(liq.harvested);
    if (!Number.isInteger(stocked) || stocked <= 0) {
      setLiqError('Enter how many head were actually stocked.');
      return;
    }
    if (!Number.isInteger(harvested) || harvested < 0) {
      setLiqError('Enter how many head were harvested.');
      return;
    }
    if (mortality > 0 && !liq.reason.trim()) {
      setLiqError('Say why the animals died: disease, heat, a typhoon, or another cause.');
      return;
    }
    if (harvested > stocked - mortality) {
      setLiqError('More head harvested than survived. Check the three counts.');
      return;
    }
    const expenses = spent
      .filter((line) => line.item.trim() && Number(line.amount) > 0)
      .map((line) => ({ item: line.item.trim(), amount: Number(line.amount) }));
    if (expenses.length === 0) {
      setLiqError('Enter what was actually spent on each item.');
      return;
    }
    if (receipts.length === 0) {
      setLiqError('Attach the receipts: feed, stock, medicine, and the sale of the harvest.');
      return;
    }

    setLiqSaving(true);
    setLiqError(null);

    // Receipts are private, filed under the farm owner's own folder.
    const paths: string[] = [];
    for (const file of receipts) {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${profile.users_id}/liquidation/${liquidating.projects_id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('project-documents')
        .upload(path, file, { contentType: file.type || undefined });
      if (uploadError) {
        setLiqError(uploadError.message);
        setLiqSaving(false);
        return;
      }
      paths.push(path);
    }

    const report = {
      projects_id: liquidating.projects_id,
      heads_stocked: stocked,
      mortality,
      mortality_reason: liq.reason.trim() || NONE,
      heads_harvested: harvested,
      sales_amount: Number(liq.sales || 0),
      expenses,
      receipts: paths,
      notes: liq.notes.trim() || NONE,
      status: 'Submitted',
      submitted_at: new Date().toISOString(),
    };

    // A returned report is corrected in place; otherwise this is the first.
    const returned = firstOf(liquidating.liquidations)?.status === 'Returned';
    const { error: saveError } = returned
      ? await supabase.from('liquidations').update(report).eq('projects_id', liquidating.projects_id)
      : await supabase.from('liquidations').insert(report);

    if (saveError) {
      setLiqError(saveError.message);
    } else {
      showSuccess('Liquidation sent. The Admin compares it with your budget before closing the project.');
      setLiquidating(null);
      await load();
    }
    setLiqSaving(false);
  };

  const closeForm = () => {
    setForm(emptyForm);
    setBudget(freshBudget());
    setPhoto(null);
    setRows([
      { id: 1, docType: CREDENTIAL_TYPES[0], file: null },
      { id: 2, docType: CREDENTIAL_TYPES[1], file: null },
      { id: 3, docType: 'Farm Photo', file: null },
    ]);
    nextDocId.current = 4;
    setError(null);
    setShowForm(false);
  };

  const addRow = () =>
    setRows((current) => [
      ...current,
      { id: nextDocId.current++, docType: CREDENTIAL_TYPES[0], file: null },
    ]);

  const removeRow = (id: number) =>
    setRows((current) => current.filter((row) => row.id !== id));

  const setRowType = (id: number, docType: string) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, docType } : row)));

  const setRowFile = (id: number, file: File | null) => {
    if (file && file.size > MAX_DOCUMENT_BYTES) {
      setError(`${file.name} is larger than 10 MB.`);
      return;
    }

    setError(null);
    setRows((current) => current.map((row) => (row.id === id ? { ...row, file } : row)));
  };

  const cancelProject = async (projectId: string) => {
    setBusyId(projectId);
    setError(null);

    const { error: updateError } = await supabase
      .from('projects')
      .update({ status: 'Cancelled' })
      .eq('projects_id', projectId);

    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess('Project cancelled.');
      await load();
    }

    setBusyId(null);
  };

  const visible = useMemo(
    () => projects.filter((project) => project.status === filter),
    [projects, filter]
  );

  const countFor = (value: string) =>
    projects.filter((project) => project.status === value).length;

  const fundedPercent = (project: ProjectRow) => {
    if (!project.funding_goal) return 0;
    return Math.min(
      100,
      Math.round((Number(project.current_funding) / Number(project.funding_goal)) * 100)
    );
  };

  return (
    <IonPage>
      <DashboardHeader
        title="My Projects"
        subtitle="Post livestock projects for funding and follow their approval."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          <div className="dash-toolbar-row">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={`dash-tab${filter === value ? ' dash-tab--active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {value} ({countFor(value)})
              </button>
            ))}

            <div className="dash-spacer" />

            <button
              type="button"
              className="dash-btn dash-btn--primary"
              onClick={() => {
                if (showForm) {
                  closeForm();
                } else if (profile?.verification_status === 'Approved') {
                  setShowForm(true);
                } else {
                  setVerifying(true);
                }
              }}
            >
              {showForm ? 'Close' : 'Post a Project'}
            </button>
          </div>

          {verifying && (
            <Portal
              className="dash-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Verify your identity"
              onClick={() => setVerifying(false)}
            >
              <div
                className="dash-modal__panel"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dash-modal__head">
                  <div>
                    <p className="dash-modal__eyebrow">Before you can post</p>
                    <h2 className="dash-modal__title">Identity Check</h2>
                  </div>

                  <button
                    type="button"
                    className="dash-modal__close"
                    onClick={() => setVerifying(false)}
                    aria-label="Close"
                  >
                    <IonIcon icon={closeOutline} />
                  </button>
                </div>

                <div className="dash-modal__body dash-modal__body--form">
                  {profile?.verification_status === 'Flagged' ? (
                    <p className="dash-notice">
                      An administrator needs to look at your last attempt, either because the
                      match was close rather than certain, or because the document did not read as
                      the type you selected. You will be able to post as soon as that is done.
                    </p>
                  ) : (
                    <>
                      {profile?.verification_status === 'Rejected' && (
                        <p className="dash-notice">
                          Your last attempt did not match. That is usually the photograph rather
                          than the person: poor light, an ID held at an angle, or a face too far
                          from the camera. Try again below.
                        </p>
                      )}

                      <IdentityVerification
                        onDone={async (outcome) => {
                          // The gate reads the profile, so it has to be
                          // reloaded before the form will open.
                          await refreshProfile();
                          setVerifying(false);
                          if (outcome === 'Approved') setShowForm(true);
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            </Portal>
          )}

          {showForm && (
            <Portal
              className="dash-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Post a project"
              onClick={closeForm}
            >
              <div
                className="dash-modal__panel dash-modal__panel--wide"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dash-modal__head">
                  <div>
                    <p className="dash-modal__eyebrow">Post a project</p>
                    <h2 className="dash-modal__title">New Livestock Project</h2>
                  </div>

                  <button
                    type="button"
                    className="dash-modal__close"
                    onClick={closeForm}
                    aria-label="Close"
                  >
                    <IonIcon icon={closeOutline} />
                  </button>
                </div>

                <div className="dash-modal__body dash-modal__body--form" ref={formBodyRef}>
                  {error && <p className="dash-error dash-error--sticky">{error}</p>}

                  {!hasFarmAddress && (
                    <p className="dash-notice">
                      You have not set a farm address yet. Investors see the area on your project,
                      and the Weather Advisory forecasts for it. Add it under My Account, in the
                      menu on your name at the top right.
                    </p>
                  )}

                  <section className="form-section">
                    <h3 className="form-section__title">Project Details</h3>

                    <div className="dash-field">
                      <label htmlFor="project-title">Project Title</label>
                      <input
                        id="project-title"
                        className="dash-input"
                        value={form.title}
                        onChange={(event) => setForm({ ...form, title: event.target.value })}
                        placeholder="20-head broiler cycle"
                      />
                    </div>

                    <div className="dash-form dash-form--two">
                      <div className="dash-field">
                        <label htmlFor="project-goal">Funding Goal (PHP)</label>
                        <input
                          id="project-goal"
                          className="dash-input"
                          type="number"
                          min="1"
                          step="500"
                          value={form.fundingGoal}
                          onChange={(event) =>
                            setForm({ ...form, fundingGoal: event.target.value })
                          }
                          placeholder="50000"
                        />
                      </div>

                      <div className="dash-field">
                        <label htmlFor="project-category">Category</label>
                        <select
                          id="project-category"
                          className="dash-select"
                          value={form.category}
                          onChange={(event) => setForm({ ...form, category: event.target.value })}
                        >
                          {PROJECT_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="cap-note">
                      <p className="cap-note__figure">
                        Your ceiling right now: <strong>{peso(cap.cap)}</strong>
                      </p>
                      <p className="cap-note__advice">{cap.advice}</p>
                      {neededFor.length > 0 && (
                        <div className="cap-note__needed">
                          <p className="cap-note__figure">
                            To ask for <strong>{peso(Number(form.fundingGoal))}</strong>, do any one of
                            these:
                          </p>
                          <ul>
                            {neededFor.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="dash-form dash-form--two">
                      <div className="dash-field">
                        <label htmlFor="project-roi">Expected Return (%)</label>
                        <input
                          id="project-roi"
                          className="dash-input"
                          type="number"
                          min="1"
                          max="100"
                          step="0.5"
                          value={form.expectedRoi}
                          onChange={(event) =>
                            setForm({ ...form, expectedRoi: event.target.value })
                          }
                          placeholder="15"
                        />
                      </div>

                      <div className="dash-field">
                        <label htmlFor="project-cycle">Cycle Length (days)</label>
                        <input
                          id="project-cycle"
                          className="dash-input"
                          type="number"
                          min="1"
                          max="1095"
                          value={form.expectedCycleDays}
                          onChange={(event) =>
                            setForm({ ...form, expectedCycleDays: event.target.value })
                          }
                          placeholder="45"
                        />
                      </div>
                    </div>

                    <p className="form-section__note">
                      The return is what you undertake to pay on top of what each investor puts
                      in. The cycle length starts when the project is fully funded, not today.
                      Break a large plan into cycles rather than asking for all of it at once: a
                      smaller goal fills faster, and a finished cycle raises your ceiling by
                      {' '}{peso(50000)}.
                    </p>

                    <div className="budget">
                      <p className="budget__title">Cost Estimate</p>
                      <p className="form-section__note">
                        How the funding goal will be spent, and how many head it raises. At the end
                        of the cycle you report what was actually spent, with receipts, against this
                        budget.
                      </p>

                      <div className="dash-form dash-form--two">
                        <div className="dash-field">
                          <label htmlFor="project-heads">Number of Head</label>
                          <input
                            id="project-heads"
                            className="dash-input"
                            type="number"
                            min="1"
                            value={form.estimatedHeads}
                            onChange={(event) => setForm({ ...form, estimatedHeads: event.target.value })}
                            placeholder="800"
                          />
                        </div>
                        <div className="dash-field">
                          <label htmlFor="project-mortality">Expected Mortality (%)</label>
                          <input
                            id="project-mortality"
                            className="dash-input"
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            value={form.expectedMortality}
                            onChange={(event) => setForm({ ...form, expectedMortality: event.target.value })}
                            placeholder="5"
                          />
                        </div>
                      </div>

                      <div className="dash-field">
                        <label htmlFor="project-price">Expected Selling Price per Head (PHP)</label>
                        <input
                          id="project-price"
                          className="dash-input"
                          type="number"
                          min="1"
                          value={form.expectedPrice}
                          onChange={(event) => setForm({ ...form, expectedPrice: event.target.value })}
                          placeholder="190"
                        />
                      </div>

                      {(() => {
                        const heads = Number(form.estimatedHeads) || 0;
                        const price = Number(form.expectedPrice) || 0;
                        const harvest = Math.floor(heads * (1 - (Number(form.expectedMortality) || 0) / 100));
                        const goal = Number(form.fundingGoal) || 0;
                        const owed = goal * (1 + (Number(form.expectedRoi) || 0) / 100);
                        if (!heads || !price) return null;
                        return (
                          <p className="budget__total">
                            Expected harvest {harvest} head · expected sales {peso(harvest * price)}
                            {goal > 0 && ` · owed back ${peso(owed)}`}
                          </p>
                        );
                      })()}

                      {budget.map((line) => (
                        <div className="budget__row" key={line.id}>
                          <input
                            className="dash-input"
                            aria-label="Cost item"
                            value={line.item}
                            onChange={(event) =>
                              setBudget(budget.map((row) => (row.id === line.id ? { ...row, item: event.target.value } : row)))
                            }
                          />
                          <input
                            className="dash-input budget__amount"
                            aria-label="Amount"
                            type="number"
                            min="0"
                            value={line.amount}
                            onChange={(event) =>
                              setBudget(budget.map((row) => (row.id === line.id ? { ...row, amount: event.target.value } : row)))
                            }
                            placeholder="0"
                          />
                          <button
                            type="button"
                            className="dash-btn dash-btn--ghost"
                            aria-label="Remove line"
                            onClick={() => setBudget(budget.filter((row) => row.id !== line.id))}
                          >
                            Remove
                          </button>
                        </div>
                      ))}

                      <div className="budget__foot">
                        <button
                          type="button"
                          className="dash-btn dash-btn--slate"
                          onClick={() => {
                            setBudget([...budget, { id: nextBudgetId.current, item: '', amount: '' }]);
                            nextBudgetId.current += 1;
                          }}
                        >
                          + Add Line
                        </button>
                        {(() => {
                          const planned = budget.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
                          const goal = Number(form.fundingGoal) || 0;
                          const off = goal > 0 && Math.abs(planned - goal) > 1;
                          return (
                            <p className={`budget__total${off ? ' budget__total--off' : ''}`}>
                              Total {peso(planned)}
                              {goal > 0 && (off ? ` · must equal the goal of ${peso(goal)}` : ' · matches the goal')}
                            </p>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="dash-field">
                      <label htmlFor="project-description">Description</label>
                      <textarea
                        id="project-description"
                        className="dash-textarea"
                        value={form.description}
                        onChange={(event) =>
                          setForm({ ...form, description: event.target.value })
                        }
                        placeholder="Livestock type, timeline, expected return, and how the funds are used."
                      />
                    </div>

                    <div className="dash-field">
                      <label htmlFor="project-photo">Cover Photo</label>

                      {/* Shares the equipment picker's styles: same control, same shape. */}
                      <div className="equipment-photo-picker">
                        {photo ? (
                          <img
                            className="equipment-photo-picker__preview"
                            src={URL.createObjectURL(photo)}
                            alt=""
                          />
                        ) : (
                          <span className="equipment-photo-picker__empty">
                            <IonIcon icon={imageOutline} />
                          </span>
                        )}

                        <div>
                          <label className="dash-upload" htmlFor="project-photo">
                            <IonIcon icon={cloudUploadOutline} />
                            <span>{photo ? photo.name : 'Choose an image, up to 5 MB'}</span>
                          </label>
                          <input
                            id="project-photo"
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                          />
                          <p className="dash-row__meta">
                            What visitors see on the public catalogue. Without one the card falls
                            back to the category icon.
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="form-section">
                    <h3 className="form-section__title">RSBSA Registration (optional)</h3>

                    <p className="form-section__lead">
                      Registry System for Basic Sectors in Agriculture. Most smallholders have
                      one and most registered farm businesses do not, so it is never required.
                      Fill it in and it counts as one of your two proofs; leave it blank and
                      attach one more document below instead. Type it rather than uploading it:
                      the administrator looks you up on the public RSBSA finder, which searches
                      by name.
                    </p>

                    <div className="dash-form dash-form--two">
                      <div className="dash-field">
                        <label htmlFor="project-rsbsa-name">Registered Name</label>
                        <input
                          id="project-rsbsa-name"
                          className="dash-input"
                          value={form.rsbsaName}
                          onChange={(event) => setForm({ ...form, rsbsaName: event.target.value })}
                          placeholder="Exactly as on your valid ID"
                        />
                      </div>

                      <div className="dash-field">
                        <label htmlFor="project-rsbsa">RSBSA Number</label>
                        <input
                          id="project-rsbsa"
                          className="dash-input"
                          value={form.rsbsaNumber}
                          onChange={(event) =>
                            setForm({ ...form, rsbsaNumber: event.target.value })
                          }
                          placeholder="Optional, if you know it"
                        />
                      </div>
                    </div>
                  </section>

                  <section className="form-section">
                    <h3 className="form-section__title">Collateral</h3>

                    <p className="form-section__lead">
                      Required on every project. You are promising a return, and this is what
                      stands behind that promise: if the cycle fails, the stock dies, or anything
                      happens to you, this is what your investors can pursue. It is also the hard
                      ceiling on what you can ask for.
                    </p>

                    <div className="dash-form dash-form--two">
                      <div className="dash-field">
                        <label htmlFor="collateral-type">What are you pledging?</label>
                        <select
                          id="collateral-type"
                          className="dash-select"
                          value={form.collateralType}
                          onChange={(event) =>
                            setForm({ ...form, collateralType: event.target.value })
                          }
                        >
                          {COLLATERAL_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="dash-field">
                        <label htmlFor="collateral-value">Declared Value (PHP)</label>
                        <input
                          id="collateral-value"
                          className="dash-input"
                          type="number"
                          min="1"
                          step="1000"
                          value={form.collateralValue}
                          onChange={(event) =>
                            setForm({ ...form, collateralValue: event.target.value })
                          }
                          placeholder="150000"
                        />
                      </div>
                    </div>

                    <div className="dash-field">
                      <label htmlFor="collateral-description">Identify the Asset</label>
                      <textarea
                        id="collateral-description"
                        className="dash-textarea"
                        value={form.collateralDescription}
                        onChange={(event) =>
                          setForm({ ...form, collateralDescription: event.target.value })
                        }
                        placeholder={COLLATERAL_HINTS[form.collateralType]}
                      />
                      <p className="dash-row__meta">{COLLATERAL_HINTS[form.collateralType]}</p>
                    </div>

                    <p className="form-section__note">
                      Attach the title, the OR and CR, or the deed below, with its document type
                      set to Collateral Proof.
                    </p>
                  </section>

                  <section className="form-section">
                    <h3 className="form-section__title">Farm Documents</h3>

                    <p className="form-section__lead">
                      FarmVest checks these before investors see your project. A proposal and a
                      cost estimate are not required, but they make approval faster.
                    </p>

                    <ul className="doc-check">
                      <li
                        className={`doc-check__item${
                          credentialsAttached >= REQUIRED_CREDENTIALS
                            ? ' doc-check__item--done'
                            : ''
                        }`}
                      >
                        <IonIcon
                          icon={
                            credentialsAttached >= REQUIRED_CREDENTIALS
                              ? checkmarkCircle
                              : ellipseOutline
                          }
                        />
                        <span>
                          {REQUIRED_CREDENTIALS} proofs that you farm here
                          <small>
                            {' '}
                            ({credentialsAttached} of {REQUIRED_CREDENTIALS}
                            {rsbsaGiven ? ', RSBSA counted' : ''})
                          </small>
                        </span>
                      </li>

                      <li
                        className={`doc-check__item${hasFarmPhoto ? ' doc-check__item--done' : ''}`}
                      >
                        <IonIcon icon={hasFarmPhoto ? checkmarkCircle : ellipseOutline} />
                        <span>A photo of the coop, pen or pond for this project</span>
                      </li>

                      <li
                        className={`doc-check__item${
                          hasCollateralProof ? ' doc-check__item--done' : ''
                        }`}
                      >
                        <IonIcon icon={hasCollateralProof ? checkmarkCircle : ellipseOutline} />
                        <span>Proof of the asset you pledged</span>
                      </li>
                    </ul>

                    <div className="doc-rows">
                      {rows.map((row, index) => (
                        <div className="doc-row" key={row.id}>
                          <div className="doc-row__head">
                            <span className="doc-row__label">Document {index + 1}</span>

                            {/* The last remaining row stays: an empty section
                                would leave nothing to add the next file to. */}
                            {rows.length > 1 && (
                              <button
                                type="button"
                                className="doc-list__remove"
                                onClick={() => removeRow(row.id)}
                                aria-label={`Remove document ${index + 1}`}
                              >
                                <IonIcon icon={closeOutline} />
                              </button>
                            )}
                          </div>

                          <div className="doc-row__body">
                            <select
                              className="dash-select"
                              value={row.docType}
                              onChange={(event) => setRowType(row.id, event.target.value)}
                              aria-label={`Type of document ${index + 1}`}
                            >
                              <optgroup label="Proof that you farm here">
                                {CREDENTIAL_TYPES.map((type) => (
                                  <option key={type} value={type}>
                                    {type}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="About this project">
                                {PROJECT_EVIDENCE_TYPES.map((type) => (
                                  <option key={type} value={type}>
                                    {type}
                                  </option>
                                ))}
                              </optgroup>
                            </select>

                            <label className="dash-upload" htmlFor={`document-${row.id}`}>
                              <IonIcon
                                icon={row.file ? documentTextOutline : cloudUploadOutline}
                              />
                              <span>
                                {row.file ? row.file.name : 'Choose a file, up to 10 MB'}
                              </span>
                            </label>
                            <input
                              id={`document-${row.id}`}
                              type="file"
                              accept="image/*,application/pdf"
                              hidden
                              onChange={(event) => {
                                setRowFile(row.id, event.target.files?.[0] ?? null);
                                // Cleared so the same file can be picked again
                                // after a change, which the browser would ignore.
                                event.target.value = '';
                              }}
                            />
                          </div>

                          <p className="dash-row__meta">{DOC_HINTS[row.docType]}</p>
                        </div>
                      ))}
                    </div>

                    {/* Two is the floor, not the ceiling. A farmer holding four
                        papers should attach four: documents that corroborate
                        each other are what make an application easy to approve. */}
                    <div className="doc-rows__foot">
                      <button type="button" className="doc-picker__add" onClick={addRow}>
                        <IonIcon icon={addOutline} />
                        <span>Add another document</span>
                      </button>

                      <span className="dash-row__meta">
                        {filled.length} of {rows.length} filled in
                      </span>
                    </div>
                  </section>

                </div>

                <div className="dash-modal__foot">
                  <button type="button" className="dash-btn dash-btn--slate" onClick={closeForm}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="dash-btn dash-btn--primary"
                    disabled={saving}
                    onClick={submit}
                  >
                    {saving ? 'Submitting...' : 'Submit for Approval'}
                  </button>
                </div>
              </div>
            </Portal>
          )}

          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2 className="dash-panel__title">Posted Projects</h2>
              <span className="dash-stat__hint">{visible.length} shown</span>
            </div>

            <div className="dash-panel__body dash-table-wrap">
              {loading ? (
                <Skeleton />
              ) : visible.length === 0 ? (
                <EmptyState
                  title={
                    projects.length === 0
                      ? 'You have not posted a project yet'
                      : 'No project matches this filter'
                  }
                  message={
                    projects.length === 0
                      ? 'Use Post a Project to raise funding for a livestock cycle.'
                      : undefined
                  }
                />
              ) : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Category</th>
                      <th>Funding Goal</th>
                      <th>Funded</th>
                      <th>Posted</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((project) => (
                      <tr key={project.projects_id}>
                        <td>
                          <p className="dash-row__title">{project.title}</p>
                          <p className="dash-row__meta">{orNone(project.description)}</p>
                          <button
                            type="button"
                            className="dash-panel__link"
                            onClick={() => setBudgetOf(project)}
                          >
                            View Budget
                          </button>
                          {project.status === 'Rejected' && project.rejection_reason && (
                            <p className="dash-row__meta">Reason: {project.rejection_reason}</p>
                          )}
                        </td>
                        <td className="dash-table__muted">
                          {categoryLook(project.category).emoji} {project.category ?? 'Other'}
                        </td>
                        <td>{peso(project.funding_goal)}</td>
                        <td>
                          <div className="dash-progress">
                            <div
                              className="dash-progress__fill"
                              style={{ width: `${fundedPercent(project)}%` }}
                            />
                          </div>
                          <span className="dash-row__meta">
                            {peso(project.current_funding)} ({fundedPercent(project)}%)
                          </span>
                        </td>
                        <td className="dash-table__muted">{shortDate(project.created_at)}</td>
                        <td>
                          <span className={pillClass(project.status)}>{project.status}</span>
                        </td>
                        <td>
                          {['Pending Approval', 'Open'].includes(project.status) ? (
                            <button
                              type="button"
                              className="dash-btn dash-btn--ghost"
                              disabled={busyId === project.projects_id}
                              onClick={() => cancelProject(project.projects_id)}
                            >
                              Cancel
                            </button>
                          ) : project.status === 'In Progress' &&
                            isFullyReleased(project.fund_releases) ? (
                            (() => {
                              // The cycle is closed with a liquidation once the funds
                              // have been released.
                              const report = firstOf(project.liquidations);
                              if (report?.status === 'Submitted') {
                                return <span className="dash-pill dash-pill--gold">Liquidation under review</span>;
                              }
                              if (report?.status === 'Accepted') {
                                // Accepted: the repayment is what completes the project.
                                const latest = [...(project.repayments ?? [])].sort((a, b) =>
                                  b.submitted_at.localeCompare(a.submitted_at)
                                )[0];
                                if (latest?.status === 'Submitted') {
                                  return <span className="dash-pill dash-pill--gold">Repayment under review</span>;
                                }
                                return (
                                  <>
                                    {latest?.status === 'Rejected' && (
                                      <p className="dash-row__meta">Repayment rejected: {latest.admin_notes}</p>
                                    )}
                                    <p className="dash-row__meta">Due {peso(repaymentOf(project).total)}</p>
                                    <button
                                      type="button"
                                      className="dash-btn dash-btn--primary"
                                      onClick={() => setRepaying(project)}
                                    >
                                      {latest ? 'Repay Again' : 'Repay Investors'}
                                    </button>
                                  </>
                                );
                              }
                              return (
                                <>
                                  {report?.status === 'Returned' && (
                                    <p className="dash-row__meta">Returned: {report.admin_notes}</p>
                                  )}
                                  <button
                                    type="button"
                                    className="dash-btn dash-btn--primary"
                                    onClick={() => openLiquidation(project)}
                                  >
                                    {report ? 'Correct Liquidation' : 'Submit Liquidation'}
                                  </button>
                                </>
                              );
                            })()
                          ) : (
                            <span className="dash-table__muted">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
        {repaying && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Repay investors"
            onClick={() => setRepaying(null)}
          >
            <div className="dash-modal__panel" onClick={(event) => event.stopPropagation()}>
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Repay through FarmVest</p>
                  <h2 className="dash-modal__title">{repaying.title}</h2>
                </div>
                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setRepaying(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body">
                <table className="dash-table">
                  <tbody>
                    <tr>
                      <td>Capital raised from {repaying.investments?.length ?? 0} investment(s)</td>
                      <td>{peso(repaymentOf(repaying).capital)}</td>
                    </tr>
                    <tr>
                      <td>Agreed return ({Number(repaying.expected_roi_percent)}%)</td>
                      <td>{peso(repaymentOf(repaying).investors - repaymentOf(repaying).capital)}</td>
                    </tr>
                    <tr>
                      <td>To the investors</td>
                      <td>{peso(repaymentOf(repaying).investors)}</td>
                    </tr>
                    <tr>
                      <td>FarmVest commission ({COMMISSION_RATE * 100}% of the capital raised)</td>
                      <td>{peso(repaymentOf(repaying).commission)}</td>
                    </tr>
                    <tr className="dash-table__totals">
                      <td>Total to repay</td>
                      <td>{peso(repaymentOf(repaying).total)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="dash-stat__hint">
                  The project is completed once FarmVest confirms this repayment and pays your
                  investors.
                </p>
              </div>

              <PaymentForm
                repaymentProjectId={repaying.projects_id}
                fee={repaymentOf(repaying).total}
                cancelLabel="Later"
                onCancel={() => setRepaying(null)}
                onSubmitted={async () => {
                  setRepaying(null);
                  await load();
                }}
              />
            </div>
          </Portal>
        )}

        {budgetOf && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Project budget"
            onClick={() => setBudgetOf(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--wide"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Your posted budget</p>
                  <h2 className="dash-modal__title">{budgetOf.title}</h2>
                </div>
                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setBudgetOf(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>
              <div className="dash-modal__body">
                <CostEstimateCard project={budgetOf} />
                <p className="dash-stat__hint">
                  This is the plan investors read before funding. At the end of the cycle your
                  liquidation is compared with it.
                </p>
              </div>
            </div>
          </Portal>
        )}

        {liquidating && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Liquidation report"
            onClick={() => setLiquidating(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--wide"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Liquidation Report</p>
                  <h2 className="dash-modal__title">{liquidating.title}</h2>
                </div>
                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setLiquidating(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                <p className="dash-notice">
                  Report what actually happened in this cycle. FarmVest compares it with the budget
                  you posted
                  {liquidating.estimated_heads
                    ? ` (${liquidating.estimated_heads} head, ${Number(liquidating.expected_mortality_percent)}% expected mortality, ${peso(totalOf(liquidating.cost_breakdown))})`
                    : ''}
                  . Some loss is normal; it only needs a reason.
                </p>

                <div className="dash-form dash-form--two">
                  <div className="dash-field">
                    <label htmlFor="liq-stocked">Head Stocked</label>
                    <input id="liq-stocked" className="dash-input" type="number" min="0"
                      value={liq.stocked} onChange={(event) => setLiq({ ...liq, stocked: event.target.value })} />
                  </div>
                  <div className="dash-field">
                    <label htmlFor="liq-mortality">Head That Died</label>
                    <input id="liq-mortality" className="dash-input" type="number" min="0" placeholder="0"
                      value={liq.mortality} onChange={(event) => setLiq({ ...liq, mortality: event.target.value })} />
                  </div>
                  <div className="dash-field">
                    <label htmlFor="liq-harvested">Head Harvested and Sold</label>
                    <input id="liq-harvested" className="dash-input" type="number" min="0"
                      value={liq.harvested} onChange={(event) => setLiq({ ...liq, harvested: event.target.value })} />
                  </div>
                  <div className="dash-field">
                    <label htmlFor="liq-sales">Total Sales (PHP)</label>
                    <input id="liq-sales" className="dash-input" type="number" min="0"
                      value={liq.sales} onChange={(event) => setLiq({ ...liq, sales: event.target.value })} />
                  </div>
                </div>

                <div className="dash-field">
                  <label htmlFor="liq-reason">Why Did They Die?</label>
                  <input id="liq-reason" className="dash-input"
                    placeholder="For example: heat stress during the second week"
                    value={liq.reason} onChange={(event) => setLiq({ ...liq, reason: event.target.value })} />
                </div>

                <div className="budget">
                  <p className="budget__title">Actual Spending</p>
                  {spent.map((line) => (
                    <div className="budget__row" key={line.id}>
                      <input className="dash-input" aria-label="Expense item" value={line.item}
                        onChange={(event) => setSpent(spent.map((row) => (row.id === line.id ? { ...row, item: event.target.value } : row)))} />
                      <input className="dash-input budget__amount" aria-label="Amount spent" type="number" min="0" placeholder="0"
                        value={line.amount}
                        onChange={(event) => setSpent(spent.map((row) => (row.id === line.id ? { ...row, amount: event.target.value } : row)))} />
                      <button type="button" className="dash-btn dash-btn--ghost"
                        onClick={() => setSpent(spent.filter((row) => row.id !== line.id))}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="budget__foot">
                    <button type="button" className="dash-btn dash-btn--slate"
                      onClick={() => setSpent([...spent, { id: Date.now(), item: '', amount: '' }])}>
                      + Add Line
                    </button>
                    <p className="budget__total">
                      Spent {peso(spent.reduce((sum, line) => sum + (Number(line.amount) || 0), 0))} of{' '}
                      {peso(totalOf(liquidating.cost_breakdown) || liquidating.funding_goal)} budgeted
                    </p>
                  </div>
                </div>

                <div className="dash-field">
                  <label htmlFor="liq-receipts">
                    Receipts <span className="dash-required">*</span>
                  </label>
                  <label className="dash-upload" htmlFor="liq-receipts">
                    <IonIcon icon={cloudUploadOutline} />
                    <span>
                      {receipts.length
                        ? `${receipts.length} file${receipts.length === 1 ? '' : 's'} chosen`
                        : 'Feed, stock, medicine, and the sale of the harvest'}
                    </span>
                  </label>
                  <input id="liq-receipts" type="file" accept="image/*,application/pdf" multiple hidden
                    onChange={(event) => setReceipts(Array.from(event.target.files ?? []))} />
                </div>

                <div className="dash-field">
                  <label htmlFor="liq-notes">Notes</label>
                  <textarea id="liq-notes" className="dash-textarea"
                    placeholder="Anything the investors should know about this cycle."
                    value={liq.notes} onChange={(event) => setLiq({ ...liq, notes: event.target.value })} />
                </div>

                {liqError && <p className="dash-error" role="alert">{liqError}</p>}
              </div>

              <div className="dash-modal__foot">
                <button type="button" className="dash-btn dash-btn--ghost" onClick={() => setLiquidating(null)}>
                  Later
                </button>
                <button type="button" className="dash-btn dash-btn--primary" disabled={liqSaving} onClick={submitLiquidation}>
                  {liqSaving ? 'Sending...' : 'Send Liquidation'}
                </button>
              </div>
            </div>
          </Portal>
        )}
      </IonContent>
    </IonPage>
  );
};

export default MyProjects;
