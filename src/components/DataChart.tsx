"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { renderChart } from "@/components/ChartViews";
import { isChartSpecIncomplete, parseChartSpec } from "@/lib/chart-spec";

interface DataChartProps {
  specText: string;
}

export default function DataChart({ specText }: DataChartProps) {
  const incomplete = useMemo(() => isChartSpecIncomplete(specText), [specText]);
  const spec = useMemo(() => parseChartSpec(specText), [specText]);

  if (!spec) {
    if (incomplete) {
      return (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 last:mb-0">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" />
          차트를 불러오는 중…
        </div>
      );
    }

    return (
      <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 last:mb-0">
        차트 데이터를 해석하지 못했습니다.
      </div>
    );
  }

  return renderChart(spec);
}
