/**
 * How much a project is entitled to ask for.
 *
 * A funding goal used to be whatever the farm owner typed. That put no price on
 * evidence: the same blank form served a farm with four permits and three
 * finished cycles and a stranger with a barangay certificate, and an investor
 * reading the catalogue could not tell them apart until they opened each one.
 *
 * The ceiling is now earned. Credentials and a finished track record raise it;
 * the pledged collateral caps it, because a secured offer cannot ask for more
 * than the security behind it.
 *
 * The same arithmetic exists in SQL as public.project_funding_cap(uuid), which
 * the Admin review reads. This copy is here so the posting form can show the
 * figure while it is being typed rather than after a rejected submit. If one
 * changes, change both.
 */

/** What two credential documents alone are worth. Also the posting minimum. */
const BASE_CAP = 30_000;

/** Reached with three credentials, or with RSBSA, which is checkable online. */
const STRONG_CAP = 100_000;

/** Added per project the farm has already finished on FarmVest. */
const PER_COMPLETED = 50_000;

export const CREDENTIAL_TYPES = [
  'RSBSA Registration',
  'Proof of Land',
  'Barangay or LGU Certification',
  'Business Permit',
  'Veterinary or Facility Permit',
];

export type FundingInputs = {
  /** Distinct credential document types attached to this project. */
  credentials: number;
  /** Whether an RSBSA registered name was given. */
  rsbsa: boolean;
  /** Projects this farm owner has taken to Completed. */
  completed: number;
  /** Declared value of the pledged asset. Null until one is entered. */
  collateralValue: number | null;
};

export type FundingCap = {
  /** What the paperwork and the record are worth, before collateral. */
  base: number;
  /** What the collateral alone supports: 70% of its declared value. */
  byCollateral: number;
  /** The figure that actually applies. */
  cap: number;
  /** True when the collateral, not the paperwork, is what is limiting them. */
  limitedByCollateral: boolean;
  /** One sentence saying how to raise it, or that nothing more is needed. */
  advice: string;
};

/**
 * Share of the pledged asset's value that can be asked for on its strength
 * alone: the loan-to-value ratio banks lend against, so a valuable asset can
 * carry a request the paperwork alone could not.
 */
export const COLLATERAL_LTV = 0.7;

const pesos = (value: number) =>
  `PHP ${value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;

/**
 * The ceiling has two routes, and the better one applies:
 *
 *   documents   30,000 with two credentials, 100,000 with three or RSBSA,
 *               plus 50,000 for every project already finished here;
 *   collateral  70% of the pledged asset's declared value.
 *
 * Either way the request can never exceed the asset itself, so every peso is
 * still secured.
 */
export const fundingCap = (inputs: FundingInputs): FundingCap => {
  const strong = inputs.credentials >= 3 || inputs.rsbsa;
  const base = (strong ? STRONG_CAP : BASE_CAP) + PER_COMPLETED * inputs.completed;

  const collateral = inputs.collateralValue ?? 0;
  const byCollateral = Math.floor(collateral * COLLATERAL_LTV);
  const cap = Math.min(Math.max(base, byCollateral), collateral);

  const limitedByCollateral = collateral > 0 && cap === collateral && collateral < base;

  const advice = !inputs.collateralValue
    ? 'Declare what you are pledging. Until you do, the ceiling is zero: nothing can be asked for without security behind it.'
    : limitedByCollateral
      ? 'Your documents allow more than your collateral is worth. Pledge an asset worth at least what you are asking for.'
      : byCollateral > base
        ? `Your collateral sets this ceiling: ${Math.round(COLLATERAL_LTV * 100)}% of its declared value.`
        : strong
          ? 'Your documents are at the stronger tier. Finishing a project, or pledging a more valuable asset, raises this ceiling again.'
          : 'Attach a third credential document or fill in your RSBSA, or pledge a more valuable asset, to raise the ceiling.';

  return { base, byCollateral, cap, limitedByCollateral, advice };
};

/**
 * What it would take to ask for `goal`: each route that gets there, worded as
 * the thing to do. Empty when the goal is already within the ceiling.
 */
export const requirementsFor = (goal: number, inputs: FundingInputs): string[] => {
  if (!goal || goal <= fundingCap(inputs).cap) return [];

  const options: string[] = [];
  const collateral = inputs.collateralValue ?? 0;
  const strong = inputs.credentials >= 3 || inputs.rsbsa;

  // Documents: does the stronger tier reach it with the asset already pledged?
  if (!strong) {
    const withStrong = fundingCap({ ...inputs, credentials: Math.max(inputs.credentials, 3) }).cap;
    if (goal <= withStrong) {
      options.push(
        `Attach one more credential document (for example a Business Permit or a Veterinary or Facility Permit), or fill in your RSBSA registration. Your ceiling rises to ${pesos(withStrong)}.`
      );
    }
  }

  // Collateral: the asset value that carries the goal by itself, and that the
  // goal never exceeds.
  const base = (strong ? STRONG_CAP : BASE_CAP) + PER_COMPLETED * inputs.completed;
  const neededAsset = base >= goal ? goal : Math.ceil(goal / COLLATERAL_LTV);
  if (neededAsset > collateral) {
    options.push(
      `Pledge collateral worth at least ${pesos(neededAsset)}${
        collateral ? ` (yours is declared at ${pesos(collateral)})` : ''
      }. ${base >= goal ? 'The request can never be more than the asset behind it.' : `${Math.round(COLLATERAL_LTV * 100)}% of that value covers ${pesos(goal)}.`}`
    );
  }

  // Track record: the document allowance grows with finished projects.
  if (goal > STRONG_CAP + PER_COMPLETED * inputs.completed) {
    options.push(
      `Each project you finish on FarmVest adds ${pesos(PER_COMPLETED)} to what your documents allow.`
    );
  }

  return options;
};

/**
 * What the farm owner undertakes to return, for one amount.
 *
 * Kept here rather than in the component because the invest modal, the project
 * card and the agreement all have to agree on the figure.
 */
export const expectedReturn = (amount: number, roiPercent: number) =>
  amount + amount * (roiPercent / 100);

/** Assets FarmVest accepts as security, as the law recognises them here. */
export const COLLATERAL_TYPES = [
  'Land Title (TCT or OCT)',
  'Tax Declaration on Land',
  'CLOA (Agrarian Reform Title)',
  'Vehicle (OR and CR)',
  'House or Building',
  'Farm Equipment or Machinery',
  'Livestock in this Project',
  'Other',
];

/** What identifies each asset, so the pledge names a thing and not a category. */
export const COLLATERAL_HINTS: Record<string, string> = {
  'Land Title (TCT or OCT)': 'Title number, registered owner, and the area in square metres.',
  'Tax Declaration on Land': 'Tax declaration number, the barangay, and the assessed value.',
  'CLOA (Agrarian Reform Title)': 'CLOA number and the awarded area.',
  'Vehicle (OR and CR)': 'Make, model, year, and plate number.',
  'House or Building': 'Address, floor area, and whether the lot is included.',
  'Farm Equipment or Machinery': 'What it is, the make, and the serial or unit number.',
  'Livestock in this Project':
    'Head count and type. Pledging the stock the funding buys is weaker security than land: if the cycle fails, the asset may be what failed.',
  Other: 'Describe it well enough that somebody else could identify it.',
};

/**
 * How raised funds reach the farm owner: one full release once the project is
 * funded, with nothing kept back. FarmVest's commission is charged only when
 * the project succeeds, on the repayment after the harvest is sold. The farm
 * owner reports progress through the cycle and liquidates at the end.
 */
export const RELEASE_STAGES = [
  { stage: 'Full', share: 1, note: 'The whole raise goes to the farm owner to run the cycle. No commission is taken now: it is paid with the repayment, after the harvest is sold.' },
] as const;

/**
 * Whether a project's funds have all been released. 'Final' counts too, for
 * records made under the earlier staged releases.
 */
export const isFullyReleased = (releases: { stage: string }[] | null | undefined) =>
  (releases ?? []).some((release) => release.stage === 'Full' || release.stage === 'Final');

/** Held while FarmVest keeps the money; Released once it has gone to the farm owner. */
export const releaseLabel = (stage: string | null | undefined) =>
  stage === 'Full' || stage === 'Final' ? 'Released' : 'Held';

/** Whether an investment's money has reached the farm owner. */
export const isReleasedStage = (stage: string | null | undefined) =>
  stage === 'Full' || stage === 'Final';

const toCents = (value: number) => Math.round(value * 100) / 100;

/**
 * One release: the share of the raise, and what is sent. The commission is
 * always zero here; it is kept on the repayment instead, once the project has
 * succeeded. The field stays so release records keep one shape.
 */
export const releaseSplit = (raised: number, share: number) => {
  const gross = toCents(raised * share);
  return { gross, commission: 0, net: gross };
};
