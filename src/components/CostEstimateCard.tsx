import { peso } from '../lib/format';
import { projectionOf, type CostLine } from '../lib/liquidation';

export type EstimateProject = {
  funding_goal: number;
  expected_roi_percent: number;
  estimated_heads: number | null;
  expected_mortality_percent: number;
  expected_price_per_head: number | null;
  cost_breakdown: CostLine[];
};

/**
 * A project's budget and expected sales, shown the same way to the investor
 * deciding whether to fund it and the Admin deciding whether to approve it.
 *
 * Older projects were posted before the budget existed, so a missing estimate
 * says so rather than showing zeros that read as a plan to spend nothing.
 */
const CostEstimateCard: React.FC<{ project: EstimateProject }> = ({ project }) => {
  const lines = project.cost_breakdown ?? [];
  if (!project.estimated_heads && lines.length === 0) {
    return (
      <section className="estimate-card">
        <p className="estimate-card__label">Cost Estimate and Expected Sales</p>
        <p className="dash-stat__hint">This project was posted before budgets were asked for.</p>
      </section>
    );
  }

  const p = projectionOf(project);

  return (
    <section className="estimate-card">
      <p className="estimate-card__label">Cost Estimate and Expected Sales</p>

      <div className="estimate-card__grid">
        <div>
          <p className="estimate-card__sub">Where the money goes</p>
          <table className="dash-table estimate-card__table">
            <tbody>
              {lines.map((line) => (
                <tr key={line.item}>
                  <td>{line.item}</td>
                  <td>{peso(line.amount)}</td>
                </tr>
              ))}
              <tr className="dash-table__totals">
                <td>Total</td>
                <td>{peso(p.cost)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <p className="estimate-card__sub">What the harvest is expected to bring</p>
          <table className="dash-table estimate-card__table">
            <tbody>
              <tr>
                <td>Head raised</td>
                <td>{p.heads}</td>
              </tr>
              <tr>
                <td>Expected mortality</td>
                <td>{Number(project.expected_mortality_percent)}%</td>
              </tr>
              <tr>
                <td>Expected harvest</td>
                <td>{p.harvest} head</td>
              </tr>
              <tr>
                <td>Selling price per head</td>
                <td>{p.hasPrice ? peso(project.expected_price_per_head ?? 0) : 'Not given'}</td>
              </tr>
              <tr className="dash-table__totals">
                <td>Expected sales</td>
                <td>{p.hasPrice ? peso(p.sales) : '—'}</td>
              </tr>
              <tr>
                <td>Owed back to investors</td>
                <td>{peso(p.investors)}</td>
              </tr>
              <tr>
                <td>FarmVest commission (5%, only if it succeeds)</td>
                <td>{peso(p.commission)}</td>
              </tr>
              <tr className="dash-table__totals">
                <td>Total repayment</td>
                <td>{peso(p.owed)}</td>
              </tr>
            </tbody>
          </table>
          {p.hasPrice && (
            <p className={`estimate-card__margin${p.margin < 0 ? ' estimate-card__margin--short' : ''}`}>
              {p.margin >= 0
                ? `Expected sales cover the repayment with ${peso(p.margin)} left for the farm.`
                : `Expected sales fall ${peso(-p.margin)} short of the repayment. The collateral secures the difference.`}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

export default CostEstimateCard;
