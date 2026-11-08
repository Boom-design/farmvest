import { peso } from '../../lib/format';
import { useElementWidth } from './useElementWidth';
import './charts.css';

type Row = { label: string; value: number };

type EquipmentRevenueChartProps = {
  data: Row[];
};

const BAR_HEIGHT = 26;
const ROW_GAP = 14;
const LABEL_WIDTH = 150;

/**
 * Rental income per unit. One series, so the bars carry a single brand hue and
 * every bar is labelled directly - there is no legend to read.
 */
const EquipmentRevenueChart: React.FC<EquipmentRevenueChartProps> = ({ data }) => {
  const { ref, width } = useElementWidth<HTMLDivElement>();

  if (data.length === 0) {
    return (
      <p className="chart__empty">
        No rental income yet. Units earn once a booking is Active or Completed.
      </p>
    );
  }

  const max = Math.max(...data.map((row) => row.value), 1);
  const trackWidth = Math.max(width - LABEL_WIDTH - 96, 80);
  const height = data.length * (BAR_HEIGHT + ROW_GAP);

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Rental income per unit">
        {data.map((row, index) => {
          const y = index * (BAR_HEIGHT + ROW_GAP);
          const barWidth = Math.max((row.value / max) * trackWidth, 3);

          return (
            <g key={row.label}>
              <text x={0} y={y + BAR_HEIGHT / 2 + 4} className="chart__label">
                {row.label.length > 22 ? `${row.label.slice(0, 21)}…` : row.label}
              </text>

              <rect
                x={LABEL_WIDTH}
                y={y}
                width={trackWidth}
                height={BAR_HEIGHT}
                rx={4}
                className="chart__track"
              />

              <rect
                x={LABEL_WIDTH}
                y={y}
                width={barWidth}
                height={BAR_HEIGHT}
                rx={4}
                fill="#166534"
              />

              <text
                x={LABEL_WIDTH + barWidth + 10}
                y={y + BAR_HEIGHT / 2 + 4}
                className="chart__value"
              >
                {peso(row.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default EquipmentRevenueChart;
