/**
 * The budget a project is posted with, and the liquidation it closes with.
 *
 * Both are lists of {item, amount}. The estimate adds up to the funding goal;
 * the liquidation is what was actually spent, with receipts. Comparing the two
 * is how the Admin tells an honest cycle from one that went somewhere else --
 * the investor's return is fixed, so the question is never how much was made,
 * only whether the money and the animals are accounted for.
 */
import { projectCommission } from './revenue';

export type CostLine = { item: string; amount: number };

/** Starting lines for a livestock budget; the farm owner edits or adds to them. */
export const DEFAULT_COST_ITEMS = [
  'Stock (chicks, piglets, fingerlings, animals)',
  'Feed',
  'Vaccines and medicine',
  'Labor',
  'Utilities and facility repair',
];

export const totalOf = (lines: CostLine[] | null | undefined) =>
  (lines ?? []).reduce((sum, line) => sum + Number(line.amount || 0), 0);

/** Spending further than this from the estimate, either way, is flagged. */
export const SPEND_TOLERANCE = 0.1;

export type Liquidation = {
  heads_stocked: number;
  mortality: number;
  mortality_reason: string;
  heads_harvested: number;
  sales_amount: number;
  expenses: CostLine[];
  receipts: string[];
  notes: string;
  status: string;
  admin_notes: string;
  submitted_at: string;
};

export type Estimate = {
  estimated_heads: number | null;
  expected_mortality_percent: number;
  cost_breakdown: CostLine[];
};

/**
 * Estimate against actual, with a plain-language flag for each line that is
 * out of the ordinary. Flags are prompts for the Admin to ask a question, not
 * verdicts: a typhoon week can lift mortality honestly.
 */
export const compareLiquidation = (estimate: Estimate, actual: Liquidation) => {
  const planned = totalOf(estimate.cost_breakdown);
  const spent = totalOf(actual.expenses);
  const mortalityPercent = actual.heads_stocked
    ? (actual.mortality / actual.heads_stocked) * 100
    : 0;
  const expectedMortality = Number(estimate.expected_mortality_percent ?? 0);

  const flags: string[] = [];

  if (planned > 0 && Math.abs(spent - planned) / planned > SPEND_TOLERANCE) {
    flags.push(
      `Spending is ${spent > planned ? 'over' : 'under'} the estimate by ${Math.round(
        (Math.abs(spent - planned) / planned) * 100
      )}%. Ask what changed.`
    );
  }
  if (mortalityPercent > Math.max(expectedMortality * 2, expectedMortality + 2)) {
    flags.push(
      `Mortality was ${mortalityPercent.toFixed(1)}% against ${expectedMortality}% expected. Check the reason given.`
    );
  }
  if (estimate.estimated_heads && actual.heads_stocked < estimate.estimated_heads * 0.9) {
    flags.push(
      `Only ${actual.heads_stocked} head were stocked against ${estimate.estimated_heads} planned.`
    );
  }
  if (actual.heads_stocked - actual.mortality < actual.heads_harvested) {
    flags.push('More head were harvested than survived. The counts do not add up.');
  }
  if (actual.receipts.length === 0) {
    flags.push('No receipts were attached.');
  }

  return { planned, spent, mortalityPercent, expectedMortality, flags };
};

/**
 * What a project expects to bring in, from its posted figures.
 *
 * Harvest is the head count less the expected mortality; sales are the harvest
 * at the expected price. What is owed back is the funding goal plus the agreed
 * return, so the margin is what the farm owner keeps if the cycle goes to plan.
 */
export const projectionOf = (project: {
  funding_goal: number;
  expected_roi_percent: number;
  estimated_heads: number | null;
  expected_mortality_percent: number;
  expected_price_per_head: number | null;
  cost_breakdown: CostLine[];
}) => {
  const heads = Number(project.estimated_heads ?? 0);
  const harvest = Math.floor(heads * (1 - Number(project.expected_mortality_percent ?? 0) / 100));
  const sales = harvest * Number(project.expected_price_per_head ?? 0);
  const investors = Number(project.funding_goal) * (1 + Number(project.expected_roi_percent ?? 0) / 100);
  // FarmVest's commission is paid with the repayment, so it is part of what
  // the harvest has to cover.
  const commission = projectCommission(project.funding_goal);
  const owed = investors + commission;
  return {
    heads,
    harvest,
    sales,
    cost: totalOf(project.cost_breakdown),
    investors,
    commission,
    owed,
    margin: sales - owed,
    hasPrice: Boolean(project.expected_price_per_head),
  };
};
