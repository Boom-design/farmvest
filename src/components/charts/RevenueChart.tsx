import { useState } from 'react';
import { peso } from '../../lib/format';
import type { MonthlyRevenue } from '../../lib/revenue';
import { useElementWidth } from './useElementWidth';
import './charts.css';

/** Series colours: brand green plus a blue that stays separable for red-green
 *  colour blindness (validated: worst-case CVD deltaE 27.5, contrast >= 3:1). */
export const SERIES = [
  { key: 'rental', label: 'Equipment Rental', color: '#166534' },
  { key: 'commission', label: 'Investment Commission', color: '#2563EB' },
] as const;

type RevenueChartProps = {
  data: MonthlyRevenue[];
};

const HEIGHT = 240;
const PADDING = { top: 24, right: 12, bottom: 34, left: 62 };
const SEGMENT_GAP = 2;

/** A rounded top on the stack, square where it meets the baseline. */
const barPath = (x: number, y: number, width: number, height: number, radius: number) => {
  const r = Math.min(radius, width / 2, Math.max(height, 0));
  if (height <= 0) return '';
  return `M ${x} ${y + height} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} L ${x + width} ${y + height} Z`;
};

const niceMax = (value: number) => {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
};

const compact = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
};

/** Monthly revenue, stacked so each bar is also the month's total. */
const RevenueChart: React.FC<RevenueChartProps> = ({ data }) => {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 120);
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const max = niceMax(Math.max(...data.map((row) => row.total), 0));
  const scale = (value: number) => (value / max) * plotHeight;

  const slot = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(46, slot * 0.55);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * max);
  const hasRevenue = data.some((row) => row.total > 0);

  return (
    <div className="chart" ref={ref}>
      <div className="chart__legend">
        {SERIES.map((series) => (
          <span className="chart__legend-item" key={series.key}>
            <span className="chart__swatch" style={{ background: series.color }} />
            {series.label}
          </span>
        ))}
        <button type="button" className="chart__toggle" onClick={() => setShowTable(!showTable)}>
          {showTable ? 'Hide data' : 'Show data'}
        </button>
      </div>

      {!hasRevenue && (
        <p className="chart__empty">
          No revenue recorded yet. Completed rentals and funded investments appear here.
        </p>
      )}

      <div className="chart__canvas">
        <svg width={width} height={HEIGHT} role="img" aria-label="Monthly revenue">
          {ticks.map((tick) => {
            const y = PADDING.top + plotHeight - scale(tick);
            return (
              <g key={tick}>
                <line
                  x1={PADDING.left}
                  x2={PADDING.left + plotWidth}
                  y1={y}
                  y2={y}
                  className="chart__grid"
                />
                <text x={PADDING.left - 10} y={y + 4} className="chart__tick" textAnchor="end">
                  {compact(tick)}
                </text>
              </g>
            );
          })}

          {data.map((row, index) => {
            const centre = PADDING.left + slot * index + slot / 2;
            const x = centre - barWidth / 2;
            const baseline = PADDING.top + plotHeight;

            const rentalHeight = scale(row.rental);
            const commissionHeight = scale(row.commission);
            const rentalY = baseline - rentalHeight;
            const commissionY = rentalY - commissionHeight - (rentalHeight > 0 ? SEGMENT_GAP : 0);
            const isLast = index === data.length - 1;

            return (
              <g
                key={row.key}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              >
                <rect
                  x={centre - slot / 2}
                  y={PADDING.top}
                  width={slot}
                  height={plotHeight}
                  fill="transparent"
                />

                {rentalHeight > 0 && (
                  <path
                    d={barPath(
                      x,
                      rentalY,
                      barWidth,
                      rentalHeight,
                      commissionHeight > 0 ? 0 : 4
                    )}
                    fill={SERIES[0].color}
                  />
                )}

                {commissionHeight > 0 && (
                  <path
                    d={barPath(x, commissionY, barWidth, commissionHeight, 4)}
                    fill={SERIES[1].color}
                  />
                )}

                <text x={centre} y={HEIGHT - 12} className="chart__label" textAnchor="middle">
                  {row.label}
                </text>

                {/* Only the latest month is labelled directly; the rest are on hover. */}
                {isLast && row.total > 0 && (
                  <text
                    x={centre}
                    y={Math.min(commissionY, rentalY) - 8}
                    className="chart__value"
                    textAnchor="middle"
                  >
                    {peso(row.total)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hovered !== null && data[hovered] && (
          <div
            className="chart__tooltip"
            style={{
              left: Math.min(
                Math.max(PADDING.left + slot * hovered + slot / 2, 90),
                Math.max(width - 90, 90)
              ),
            }}
          >
            <p className="chart__tooltip-title">{data[hovered].label}</p>
            <p>
              <span className="chart__swatch" style={{ background: SERIES[0].color }} />
              Rental {peso(data[hovered].rental)}
            </p>
            <p>
              <span className="chart__swatch" style={{ background: SERIES[1].color }} />
              Commission {peso(data[hovered].commission)}
            </p>
            <p className="chart__tooltip-total">Total {peso(data[hovered].total)}</p>
          </div>
        )}
      </div>

      {showTable && (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Equipment Rental</th>
                <th>Investment Commission</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{peso(row.rental)}</td>
                  <td>{peso(row.commission)}</td>
                  <td>{peso(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RevenueChart;
