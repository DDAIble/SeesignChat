export type ChartSeriesType = "bar" | "line" | "area";

export interface ChartSeries {
  name: string;
  type?: ChartSeriesType;
  data: number[];
}

export interface ChartSpec {
  type: "bar" | "line" | "bar-line" | "area" | "pie";
  title?: string;
  xAxis?: string[];
  yAxisLabel?: string;
  series: ChartSeries[];
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

export function parseChartSpec(raw: string): ChartSpec | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Partial<ChartSpec>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.type || !Array.isArray(parsed.series) || parsed.series.length === 0) return null;

    const series: ChartSeries[] = [];
    for (const item of parsed.series) {
      if (!item || typeof item.name !== "string" || !isNumberArray(item.data)) return null;
      series.push({
        name: item.name,
        type: item.type,
        data: item.data,
      });
    }

    const xAxis = Array.isArray(parsed.xAxis)
      ? parsed.xAxis.map((label) => String(label))
      : undefined;

    if (parsed.type !== "pie") {
      const expectedLength = xAxis?.length ?? series[0].data.length;
      if (!expectedLength || expectedLength <= 0) return null;
      if (xAxis && xAxis.length !== expectedLength) return null;
      if (!series.every((s) => s.data.length === expectedLength)) return null;
    } else {
      if (!xAxis || xAxis.length !== series[0].data.length) return null;
      if (series.length !== 1) return null;
    }

    return {
      type: parsed.type,
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      xAxis,
      yAxisLabel: typeof parsed.yAxisLabel === "string" ? parsed.yAxisLabel : undefined,
      series,
    };
  } catch {
    return null;
  }
}

export function chartSpecToRows(spec: ChartSpec): Array<Record<string, string | number>> {
  const labels = spec.xAxis ?? spec.series[0].data.map((_, index) => `${index + 1}`);

  return labels.map((label, index) => {
    const row: Record<string, string | number> = { label };
    for (const series of spec.series) {
      row[series.name] = series.data[index] ?? 0;
    }
    return row;
  });
}

export function chartSpecToPieData(spec: ChartSpec): Array<{ name: string; value: number }> {
  const labels = spec.xAxis ?? [];
  const values = spec.series[0]?.data ?? [];
  return labels.map((name, index) => ({
    name,
    value: values[index] ?? 0,
  }));
}
