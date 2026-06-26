export type ChartSeriesType = "bar" | "line" | "area";

export interface ChartSeries {
  name: string;
  type?: ChartSeriesType;
  data: number[];
}

export interface ScatterPoint {
  name: string;
  x: number;
  y: number;
  size?: number;
}

export interface FunnelStage {
  name: string;
  value: number;
}

export type SeriesChartType =
  | "bar"
  | "line"
  | "bar-line"
  | "area"
  | "stacked-bar"
  | "grouped-bar"
  | "horizontal-bar"
  | "bump";

export interface SeriesChartSpec {
  type: SeriesChartType;
  title?: string;
  xAxis?: string[];
  yAxisLabel?: string;
  series: ChartSeries[];
}

export interface PieChartSpec {
  type: "pie" | "donut";
  title?: string;
  xAxis: string[];
  series: [ChartSeries];
}

export interface ScatterChartSpec {
  type: "scatter" | "positioning";
  title?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  points: ScatterPoint[];
}

export interface HeatmapChartSpec {
  type: "heatmap";
  title?: string;
  xLabels: string[];
  yLabels: string[];
  values: number[][];
  valueLabel?: string;
}

export interface RadarChartSpec {
  type: "radar";
  title?: string;
  dimensions: string[];
  series: ChartSeries[];
}

export interface FunnelChartSpec {
  type: "funnel";
  title?: string;
  stages: FunnelStage[];
}

export interface WaterfallChartSpec {
  type: "waterfall";
  title?: string;
  categories: string[];
  values: number[];
}

export type ChartSpec =
  | SeriesChartSpec
  | PieChartSpec
  | ScatterChartSpec
  | HeatmapChartSpec
  | RadarChartSpec
  | FunnelChartSpec
  | WaterfallChartSpec;

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function parseSeries(value: unknown): ChartSeries[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const series: ChartSeries[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || !isNumberArray(record.data)) return null;
    series.push({
      name: record.name,
      type:
        record.type === "bar" || record.type === "line" || record.type === "area"
          ? record.type
          : undefined,
      data: record.data,
    });
  }
  return series;
}

function validateSeriesAlignment(xAxis: string[] | undefined, series: ChartSeries[]): boolean {
  const expectedLength = xAxis?.length ?? series[0]?.data.length;
  if (!expectedLength || expectedLength <= 0) return false;
  if (xAxis && xAxis.length !== expectedLength) return false;
  return series.every((item) => item.data.length === expectedLength);
}

function parseSeriesChart(parsed: Record<string, unknown>, type: SeriesChartType): SeriesChartSpec | null {
  const series = parseSeries(parsed.series);
  if (!series) return null;

  const xAxis = Array.isArray(parsed.xAxis)
    ? parsed.xAxis.map((label) => String(label))
    : undefined;

  if (!validateSeriesAlignment(xAxis, series)) return null;

  return {
    type,
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    xAxis,
    yAxisLabel: typeof parsed.yAxisLabel === "string" ? parsed.yAxisLabel : undefined,
    series,
  };
}

function parsePieChart(parsed: Record<string, unknown>, type: "pie" | "donut"): PieChartSpec | null {
  const series = parseSeries(parsed.series);
  if (!series || series.length !== 1) return null;

  const xAxis = Array.isArray(parsed.xAxis)
    ? parsed.xAxis.map((label) => String(label))
    : null;
  if (!xAxis || xAxis.length !== series[0].data.length) return null;

  return {
    type,
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    xAxis,
    series: [series[0]],
  };
}

function parseScatterChart(
  parsed: Record<string, unknown>,
  type: "scatter" | "positioning"
): ScatterChartSpec | null {
  if (!Array.isArray(parsed.points) || parsed.points.length === 0) return null;

  const points: ScatterPoint[] = [];
  for (const item of parsed.points) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string") return null;
    if (typeof record.x !== "number" || typeof record.y !== "number") return null;
    points.push({
      name: record.name,
      x: record.x,
      y: record.y,
      size: typeof record.size === "number" ? record.size : undefined,
    });
  }

  return {
    type,
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    xAxisLabel: typeof parsed.xAxisLabel === "string" ? parsed.xAxisLabel : undefined,
    yAxisLabel: typeof parsed.yAxisLabel === "string" ? parsed.yAxisLabel : undefined,
    points,
  };
}

function parseHeatmapChart(parsed: Record<string, unknown>): HeatmapChartSpec | null {
  const xLabels = Array.isArray(parsed.xLabels)
    ? parsed.xLabels.map((label) => String(label))
    : null;
  const yLabels = Array.isArray(parsed.yLabels)
    ? parsed.yLabels.map((label) => String(label))
    : null;
  const values = parsed.values;

  if (!xLabels?.length || !yLabels?.length || !Array.isArray(values)) return null;
  if (values.length !== yLabels.length) return null;
  if (!values.every((row) => Array.isArray(row) && row.length === xLabels.length)) return null;
  if (!values.every((row) => (row as number[]).every((value) => typeof value === "number"))) {
    return null;
  }

  return {
    type: "heatmap",
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    xLabels,
    yLabels,
    values: values as number[][],
    valueLabel: typeof parsed.valueLabel === "string" ? parsed.valueLabel : undefined,
  };
}

function parseRadarChart(parsed: Record<string, unknown>): RadarChartSpec | null {
  const dimensions = Array.isArray(parsed.dimensions)
    ? parsed.dimensions.map((label) => String(label))
    : null;
  const series = parseSeries(parsed.series);
  if (!dimensions?.length || !series?.length) return null;
  if (!series.every((item) => item.data.length === dimensions.length)) return null;

  return {
    type: "radar",
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    dimensions,
    series,
  };
}

function parseFunnelChart(parsed: Record<string, unknown>): FunnelChartSpec | null {
  if (!Array.isArray(parsed.stages) || parsed.stages.length === 0) return null;

  const stages: FunnelStage[] = [];
  for (const item of parsed.stages) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.value !== "number") return null;
    stages.push({ name: record.name, value: record.value });
  }

  return {
    type: "funnel",
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    stages,
  };
}

function parseWaterfallChart(parsed: Record<string, unknown>): WaterfallChartSpec | null {
  const categories = Array.isArray(parsed.categories)
    ? parsed.categories.map((label) => String(label))
    : null;
  const values = isNumberArray(parsed.values) ? parsed.values : null;
  if (!categories?.length || !values || categories.length !== values.length) return null;

  return {
    type: "waterfall",
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    categories,
    values,
  };
}

export function parseChartSpec(raw: string): ChartSpec | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") return null;

    switch (parsed.type) {
      case "bar":
      case "line":
      case "bar-line":
      case "area":
      case "stacked-bar":
      case "grouped-bar":
      case "horizontal-bar":
      case "bump":
        return parseSeriesChart(parsed, parsed.type);
      case "pie":
      case "donut":
        return parsePieChart(parsed, parsed.type);
      case "scatter":
      case "positioning":
        return parseScatterChart(parsed, parsed.type);
      case "heatmap":
        return parseHeatmapChart(parsed);
      case "radar":
        return parseRadarChart(parsed);
      case "funnel":
        return parseFunnelChart(parsed);
      case "waterfall":
        return parseWaterfallChart(parsed);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function chartSpecToRows(spec: SeriesChartSpec): Array<Record<string, string | number>> {
  const labels = spec.xAxis ?? spec.series[0].data.map((_, index) => `${index + 1}`);

  return labels.map((label, index) => {
    const row: Record<string, string | number> = { label };
    for (const series of spec.series) {
      row[series.name] = series.data[index] ?? 0;
    }
    return row;
  });
}

export function chartSpecToPieData(spec: PieChartSpec): Array<{ name: string; value: number }> {
  return spec.xAxis.map((name, index) => ({
    name,
    value: spec.series[0].data[index] ?? 0,
  }));
}

export function chartSpecToRadarRows(
  spec: RadarChartSpec
): Array<Record<string, string | number>> {
  return spec.dimensions.map((dimension, index) => {
    const row: Record<string, string | number> = { dimension };
    for (const series of spec.series) {
      row[series.name] = series.data[index] ?? 0;
    }
    return row;
  });
}

export function getHeatmapRange(values: number[][]): { min: number; max: number } {
  const flat = values.flat();
  return {
    min: Math.min(...flat),
    max: Math.max(...flat),
  };
}

export function heatmapColor(value: number, min: number, max: number): string {
  if (max === min) return "#86efac";
  const ratio = (value - min) / (max - min);
  const hue = 150;
  const lightness = 92 - ratio * 44;
  const saturation = 45 + ratio * 35;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}
