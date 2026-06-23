"use client";

import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { AnalysisTraceData, AnalysisTraceStep } from "@/lib/analysis-trace";

interface AnalysisTracePanelProps {
  trace: AnalysisTraceData;
}

function StepIcon({ status }: { status: AnalysisTraceStep["status"] }) {
  if (status === "done") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  }
  if (status === "running") {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-500" />;
  }
  if (status === "error") {
    return <XCircle className="h-4 w-4 shrink-0 text-red-500" />;
  }
  return <Circle className="h-4 w-4 shrink-0 text-slate-300" />;
}

export default function AnalysisTracePanel({ trace }: AnalysisTracePanelProps) {
  return (
    <div className="rounded-2xl rounded-tl-sm border border-emerald-100 bg-gradient-to-b from-emerald-50/80 to-white px-4 py-3 text-sm text-slate-700 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
        <p className="font-medium text-slate-800">{trace.headline}</p>
      </div>
      <div className="space-y-2 border-l-2 border-emerald-100 pl-3">
        {trace.steps.map((step) => (
          <div key={step.id} className="flex gap-2">
            <StepIcon status={step.status} />
            <div className="min-w-0">
              <p
                className={
                  step.status === "running"
                    ? "font-medium text-slate-800"
                    : step.status === "done"
                      ? "text-slate-700"
                      : "text-slate-500"
                }
              >
                {step.label}
              </p>
              {step.detail ? (
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{step.detail}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
