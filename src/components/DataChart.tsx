"use client";

import { useMemo } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  chartSpecToPieData,
  chartSpecToRows,
  parseChartSpec,
  type ChartSpec,
} from "@/lib/chart-spec";

const CHART_COLORS = ["#059669", "#2563eb", "#d97706", "#7c3aed", "#dc2626", "#0891b2"];

function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
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

function renderSeries(spec: ChartSpec) {
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
          : spec.type === "line"
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
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
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

    return <Bar key={series.name} dataKey={series.name} fill={color} radius={[4, 4, 0, 0]} />;
  });
}

interface DataChartProps {
  specText: string;
}

export default function DataChart({ specText }: DataChartProps) {
  const spec = useMemo(() => parseChartSpec(specText), [specText]);

  if (!spec) {
    return (
      <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 last:mb-0">
        차트 데이터를 해석하지 못했습니다.
      </div>
    );
  }

  if (spec.type === "pie") {
    const pieData = chartSpecToPieData(spec);

    return (
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm last:mb-0">
        {spec.title && (
          <h4 className="mb-3 text-sm font-semibold text-slate-900">{spec.title}</h4>
        )}
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={110}
                label={({ name, percent }) =>
                  `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                }
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
      </div>
    );
  }

  const rows = chartSpecToRows(spec);
  const useComposed = spec.type === "bar-line" || spec.series.some((s, i) => s.type);

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm last:mb-0">
      {spec.title && <h4 className="mb-3 text-sm font-semibold text-slate-900">{spec.title}</h4>}
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
            {useComposed ? renderSeries(spec) : renderSeries({ ...spec, type: spec.type === "line" ? "line" : "bar" })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
