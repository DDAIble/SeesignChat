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

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers: number[] = [];
  for (const item of value) {
    const num = coerceNumber(item);
    if (num === null) return null;
    numbers.push(num);
  }
  return numbers;
}

function isNumberArray(value: unknown): value is number[] {
  return toNumberArray(value) !== null;
}

function stripJsonCommentsAndTrailingCommas(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
}

function extractNameValuePairs(items: unknown[]): { names: string[]; values: number[] } | null {
  const names: string[] = [];
  const values: number[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = record.name ?? record.label ?? record.category;
    const value = coerceNumber(record.value ?? record.count ?? record.y);
    if (typeof name === "string" && value !== null) {
      names.push(name);
      values.push(value);
    }
  }
  return names.length > 0 ? { names, values } : null;
}

/** AI가 자주 쓰는 변형 JSON을 표준 chart spec 형식으로 변환 */
export function normalizeChartPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  const result = { ...parsed };
  const type = typeof parsed.type === "string" ? parsed.type : "bar";

  if (!result.series && Array.isArray(parsed.labels) && Array.isArray(parsed.values)) {
    const labels = parsed.labels.map((label) => String(label));
    const values = toNumberArray(parsed.values) ?? [];
    result.xAxis = labels;
    result.series = [
      {
        name: typeof parsed.seriesName === "string" ? parsed.seriesName : "건수",
        data: values,
      },
    ];
    if (!parsed.type && values.length > 0) {
      result.type = "pie";
    }
  }

  if (!result.series && Array.isArray(parsed.data)) {
    const pairs = extractNameValuePairs(parsed.data);
    if (pairs) {
      result.xAxis = pairs.names;
      result.series = [{ name: "건수", data: pairs.values }];
      if (type === "pie" || type === "donut" || !parsed.type) {
        result.type = type === "bar" ? "pie" : type;
      }
    }
  }

  if (Array.isArray(parsed.series) && parsed.series.length > 0) {
    const first = parsed.series[0];
    if (first && typeof first === "object") {
      const record = first as Record<string, unknown>;
      if (Array.isArray(record.data) && record.data.length > 0) {
        const firstPoint = record.data[0];
        if (
          firstPoint &&
          typeof firstPoint === "object" &&
          ("name" in firstPoint || "label" in firstPoint) &&
          ("value" in firstPoint || "count" in firstPoint)
        ) {
          const pairs = extractNameValuePairs(record.data);
          if (pairs) {
            result.xAxis = pairs.names;
            result.series = [
              {
                name: typeof record.name === "string" ? record.name : "건수",
                data: pairs.values,
              },
            ];
            if (type === "pie" || type === "donut" || type === "bar") {
              result.type = "pie";
            }
          }
        }
      }
    }
  }

  if (Array.isArray(result.series)) {
    result.series = (result.series as unknown[]).map((item) => {
      if (!item || typeof item !== "object") return item;
      const record = { ...(item as Record<string, unknown>) };
      if (Array.isArray(record.data)) {
        const coerced = toNumberArray(record.data);
        if (coerced) record.data = coerced;
      }
      return record;
    });
  }

  if (Array.isArray(result.values)) {
    const coerced = toNumberArray(result.values);
    if (coerced) result.values = coerced;
  }

  return result;
}

export function isChartSpecIncomplete(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    JSON.parse(stripJsonCommentsAndTrailingCommas(trimmed));
    return false;
  } catch {
    return true;
  }
}

function parseSeries(value: unknown): ChartSeries[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const series: ChartSeries[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const data = toNumberArray(record.data);
    if (typeof record.name !== "string" || !data) return null;
    series.push({
      name: record.name,
      type:
        record.type === "bar" || record.type === "line" || record.type === "area"
          ? record.type
          : undefined,
      data,
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
    const cleaned = stripJsonCommentsAndTrailingCommas(trimmed);
    const normalized = normalizeChartPayload(JSON.parse(cleaned) as Record<string, unknown>);
    if (!normalized || typeof normalized !== "object" || typeof normalized.type !== "string") {
      return null;
    }

    switch (normalized.type) {
      case "bar":
      case "line":
      case "bar-line":
      case "area":
      case "stacked-bar":
      case "grouped-bar":
      case "horizontal-bar":
      case "bump":
        return parseSeriesChart(normalized, normalized.type);
      case "pie":
      case "donut":
        return parsePieChart(normalized, normalized.type);
      case "scatter":
      case "positioning":
        return parseScatterChart(normalized, normalized.type);
      case "heatmap":
        return parseHeatmapChart(normalized);
      case "radar":
        return parseRadarChart(normalized);
      case "funnel":
        return parseFunnelChart(normalized);
      case "waterfall":
        return parseWaterfallChart(normalized);
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
