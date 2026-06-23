export type AnalysisTraceStepStatus = "pending" | "running" | "done" | "error";

export interface AnalysisTraceStep {
  id: string;
  label: string;
  detail?: string;
  status: AnalysisTraceStepStatus;
}

export interface AnalysisTraceData {
  headline: string;
  steps: AnalysisTraceStep[];
}

export interface AnalysisTraceEmitter {
  setHeadline: (headline: string) => void;
  upsertStep: (step: AnalysisTraceStep) => void;
  patchStep: (id: string, patch: Partial<AnalysisTraceStep>) => void;
}

export function createAnalysisTraceEmitter(writer: {
  write: (part: Record<string, unknown>) => void;
}): AnalysisTraceEmitter {
  let headline = "데이터 분석 준비 중…";
  const steps = new Map<string, AnalysisTraceStep>();

  function emit(): void {
    writer.write({
      type: "data-analysis-trace",
      id: "analysis-trace",
      data: {
        headline,
        steps: [...steps.values()],
      } satisfies AnalysisTraceData,
      transient: true,
    });
  }

  return {
    setHeadline(next) {
      headline = next;
      emit();
    },
    upsertStep(step) {
      steps.set(step.id, step);
      emit();
    },
    patchStep(id, patch) {
      const existing = steps.get(id);
      if (!existing) return;
      steps.set(id, { ...existing, ...patch });
      emit();
    },
  };
}

export function isAnalysisTraceData(value: unknown): value is AnalysisTraceData {
  if (!value || typeof value !== "object") return false;
  const data = value as AnalysisTraceData;
  return typeof data.headline === "string" && Array.isArray(data.steps);
}
