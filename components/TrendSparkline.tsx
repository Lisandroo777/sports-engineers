interface TrendSparklineProps {
  /** Values to plot — e.g. [last40, last20, last10, last5] */
  values: number[];
  /** Override the auto-detected direction color */
  positive?: boolean;
  width?: number;
  height?: number;
}

export function TrendSparkline({ values, positive, width = 48, height = 18 }: TrendSparklineProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Determine direction from first to last value
  const trending = positive ?? values[values.length - 1] >= values[0];
  const stroke = trending ? '#34d399' : '#f87171';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
