"use client";

import { useMemo } from "react";
import { renderChart } from "@/components/ChartViews";
import { parseChartSpec } from "@/lib/chart-spec";

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

  return renderChart(spec);
}
