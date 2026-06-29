"use client";

import type { ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  LabelList,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  chartSpecToPieData,
  chartSpecToRadarRows,
  chartSpecToRows,
  getHeatmapRange,
  heatmapColor,
  type ChartSpec,
  type FunnelChartSpec,
  type HeatmapChartSpec,
  type PieChartSpec,
  type RadarChartSpec,
  type ScatterChartSpec,
  type SeriesChartSpec,
  type WaterfallChartSpec,
} from "@/lib/chart-spec";

const CHART_COLORS = ["#059669", "#2563eb", "#d97706", "#7c3aed", "#dc2626", "#0891b2"];

function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

function ChartShell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm last:mb-0"
      role="img"
      aria-label={title ? `차트: ${title}` : "데이터 차트"}
    >
      {title && <h4 className="mb-3 text-sm font-semibold text-slate-900">{title}</h4>}
      {children}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-slate-900">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-slate-700" style={{ color: entry.color }}>
          {entry.name}: {formatNumber(entry.value)}
        </p>
      ))}
    </div>
  );
}

function renderComposedSeries(spec: SeriesChartSpec) {
  return spec.series.map((series, index) => {
    const color = CHART_COLORS[index % CHART_COLORS.length];
    const resolvedType =
      series.type ??
      (spec.type === "bar-line"
        ? index === 0
          ? "bar"
          : "line"
        : spec.type === "area"
          ? "area"
          : spec.type === "line" || spec.type === "bump"
            ? "line"
            : "bar");

    if (resolvedType === "line") {
      return (
        <Line
          key={series.name}
          type="monotone"
          dataKey={series.name}
          stroke={color}
          strokeWidth={2.5}
          dot={{ r: 4 }}
          activeDot={{ r: 6 }}
        />
      );
    }

    if (resolvedType === "area") {
      return (
        <Area
          key={series.name}
          type="monotone"
          dataKey={series.name}
          stroke={color}
          fill={color}
          fillOpacity={0.15}
          strokeWidth={2}
        />
      );
    }

    const stackId =
      spec.type === "stacked-bar" ? "stack" : undefined;

    return (
      <Bar
        key={series.name}
        dataKey={series.name}
        fill={color}
        stackId={stackId}
        radius={spec.type === "stacked-bar" ? [0, 0, 0, 0] : [4, 4, 0, 0]}
      />
    );
  });
}

export function PieChartView({ spec }: { spec: PieChartSpec }) {
  const pieData = chartSpecToPieData(spec);

  return (
    <ChartShell title={spec.title}>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={spec.type === "donut" ? "52%" : 0}
              outerRadius={110}
              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
            >
              {pieData.map((_, index) => (
                <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatNumber(Number(value))} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

export function SeriesChartView({ spec }: { spec: SeriesChartSpec }) {
  const rows = chartSpecToRows(spec);
  const isHorizontal = spec.type === "horizontal-bar";
  const isBump = spec.type === "bump";
  const maxRank = isBump
    ? Math.max(...spec.series.flatMap((series) => series.data))
    : 0;

  if (isBump) {
    return (
      <ChartShell title={spec.title}>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#475569" }} />
              <YAxis
                reversed
                domain={[maxRank, 1]}
                allowDecimals={false}
                tick={{ fontSize: 12, fill: "#475569" }}
                label={
                  spec.yAxisLabel
                    ? {
                        value: spec.yAxisLabel,
                        angle: -90,
                        position: "insideLeft",
                        style: { fill: "#64748b", fontSize: 12 },
                      }
                    : undefined
                }
              />
              <Tooltip
                formatter={(value, name) => [`${value}위`, String(name)]}
                labelFormatter={(label) => String(label)}
              />
              <Legend />
              {renderComposedSeries(spec)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartShell>
    );
  }

  if (isHorizontal) {
    return (
      <ChartShell title={spec.title}>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 12, left: 24, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tickFormatter={formatNumber} tick={{ fontSize: 12, fill: "#475569" }} />
              <YAxis
                type="category"
                dataKey="label"
                width={96}
                tick={{ fontSize: 12, fill: "#475569" }}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              {renderComposedSeries(spec)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartShell>
    );
  }

  return (
    <ChartShell title={spec.title}>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "#475569" }}
              interval={0}
              angle={rows.length > 8 ? -35 : 0}
              textAnchor={rows.length > 8 ? "end" : "middle"}
              height={rows.length > 8 ? 64 : 32}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#475569" }}
              tickFormatter={formatNumber}
              label={
                spec.yAxisLabel
                  ? {
                      value: spec.yAxisLabel,
                      angle: -90,
                      position: "insideLeft",
                      style: { fill: "#64748b", fontSize: 12 },
                    }
                  : undefined
              }
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            {renderComposedSeries(spec)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

export function ScatterChartView({ spec }: { spec: ScatterChartSpec }) {
  const scatterData = spec.points.map((point) => ({
    name: point.name,
    x: point.x,
    y: point.y,
    z: point.size ?? 80,
  }));

  const xMid =
    spec.points.reduce((sum, point) => sum + point.x, 0) / Math.max(spec.points.length, 1);
  const yMid =
    spec.points.reduce((sum, point) => sum + point.y, 0) / Math.max(spec.points.length, 1);

  return (
    <ChartShell title={spec.title}>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              dataKey="x"
              name={spec.xAxisLabel ?? "X"}
              tick={{ fontSize: 12, fill: "#475569" }}
              label={
                spec.xAxisLabel
                  ? { value: spec.xAxisLabel, position: "insideBottom", offset: -4 }
                  : undefined
              }
            />
            <YAxis
              type="number"
              dataKey="y"
              name={spec.yAxisLabel ?? "Y"}
              tick={{ fontSize: 12, fill: "#475569" }}
              label={
                spec.yAxisLabel
                  ? { value: spec.yAxisLabel, angle: -90, position: "insideLeft" }
                  : undefined
              }
            />
            <ZAxis type="number" dataKey="z" range={[80, 400]} />
            {spec.type === "positioning" && (
              <>
                <ReferenceLine x={xMid} stroke="#94a3b8" strokeDasharray="4 4" />
                <ReferenceLine y={yMid} stroke="#94a3b8" strokeDasharray="4 4" />
              </>
            )}
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              formatter={(value, name) => [formatNumber(Number(value)), String(name)]}
            />
            <Scatter data={scatterData} fill="#059669">
              <LabelList dataKey="name" position="top" offset={8} className="fill-slate-700 text-xs" />
              {scatterData.map((_, index) => (
                <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {spec.type === "positioning" && (
        <p className="mt-2 text-xs text-slate-500">
          점선은 데이터 평균 기준 4분면입니다. 우상단은 X·Y 모두 평균 이상 영역입니다.
        </p>
      )}
    </ChartShell>
  );
}

export function HeatmapChartView({ spec }: { spec: HeatmapChartSpec }) {
  const { min, max } = getHeatmapRange(spec.values);

  return (
    <ChartShell title={spec.title}>
      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-1"
          style={{
            gridTemplateColumns: `96px repeat(${spec.xLabels.length}, minmax(56px, 1fr))`,
          }}
        >
          <div />
          {spec.xLabels.map((label) => (
            <div key={label} className="px-1 text-center text-xs font-medium text-slate-600">
              {label}
            </div>
          ))}
          {spec.yLabels.map((yLabel, rowIndex) => (
            <div key={yLabel} className="contents">
              <div className="flex items-center pr-2 text-xs font-medium text-slate-600">{yLabel}</div>
              {spec.xLabels.map((xLabel, colIndex) => {
                const value = spec.values[rowIndex][colIndex] ?? 0;
                return (
                  <div
                    key={`${yLabel}-${xLabel}`}
                    className="flex min-h-11 items-center justify-center rounded-md border border-slate-200/80 px-1 text-xs font-medium text-slate-800"
                    style={{ backgroundColor: heatmapColor(value, min, max) }}
                    title={`${yLabel} × ${xLabel}: ${formatNumber(value)}`}
                  >
                    {formatNumber(value)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {spec.valueLabel && <p className="mt-2 text-xs text-slate-500">{spec.valueLabel}</p>}
    </ChartShell>
  );
}

export function RadarChartView({ spec }: { spec: RadarChartSpec }) {
  const rows = chartSpecToRadarRows(spec);

  return (
    <ChartShell title={spec.title}>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={rows}>
            <PolarGrid />
            <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: "#475569" }} />
            <PolarRadiusAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
            <Tooltip formatter={(value) => formatNumber(Number(value))} />
            <Legend />
            {spec.series.map((series, index) => (
              <Radar
                key={series.name}
                name={series.name}
                dataKey={series.name}
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
                fillOpacity={0.2}
              />
            ))}
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

export function FunnelChartView({ spec }: { spec: FunnelChartSpec }) {
  const maxValue = Math.max(...spec.stages.map((stage) => stage.value));

  return (
    <ChartShell title={spec.title}>
      <div className="space-y-2">
        {spec.stages.map((stage, index) => {
          const widthPercent = Math.max((stage.value / maxValue) * 100, 18);
          return (
            <div key={stage.name} className="flex items-center gap-3">
              <div className="w-28 shrink-0 text-right text-xs font-medium text-slate-600">
                {stage.name}
              </div>
              <div className="flex-1">
                <div
                  className="rounded-md px-3 py-2 text-sm font-semibold text-white"
                  style={{
                    width: `${widthPercent}%`,
                    backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                    minWidth: "96px",
                  }}
                >
                  {formatNumber(stage.value)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ChartShell>
  );
}

export function WaterfallChartView({ spec }: { spec: WaterfallChartSpec }) {
  let running = 0;
  const rows = spec.categories.map((category, index) => {
    const delta = spec.values[index];
    const start = running;
    running += delta;
    return {
      category,
      delta,
      start,
      end: running,
      fill: delta >= 0 ? "#059669" : "#dc2626",
    };
  });

  const chartRows = rows.map((row) => ({
    category: row.category,
    base: Math.min(row.start, row.end),
    visible: Math.abs(row.delta),
    delta: row.delta,
    fill: row.fill,
  }));

  return (
    <ChartShell title={spec.title}>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="category" tick={{ fontSize: 12, fill: "#475569" }} />
            <YAxis tickFormatter={formatNumber} tick={{ fontSize: 12, fill: "#475569" }} />
            <Tooltip
              formatter={(value, _name, item) => {
                const payload = item?.payload as { delta?: number } | undefined;
                return [formatNumber(Number(payload?.delta ?? value)), "변화량"];
              }}
            />
            <Bar dataKey="base" stackId="waterfall" fill="transparent" />
            <Bar dataKey="visible" stackId="waterfall" radius={[4, 4, 0, 0]}>
              {chartRows.map((row, index) => (
                <Cell key={index} fill={row.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

export function renderChart(spec: ChartSpec) {
  switch (spec.type) {
    case "pie":
    case "donut":
      return <PieChartView spec={spec} />;
    case "scatter":
    case "positioning":
      return <ScatterChartView spec={spec} />;
    case "heatmap":
      return <HeatmapChartView spec={spec} />;
    case "radar":
      return <RadarChartView spec={spec} />;
    case "funnel":
      return <FunnelChartView spec={spec} />;
    case "waterfall":
      return <WaterfallChartView spec={spec} />;
    default:
      return <SeriesChartView spec={spec} />;
  }
}
