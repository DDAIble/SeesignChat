"use client";

import { Sparkles } from "lucide-react";
import type { AggregateLearningProgress } from "@/lib/learning-progress";

interface LearningProgressBarProps {
  progress: AggregateLearningProgress;
}

export default function LearningProgressBar({ progress }: LearningProgressBarProps) {
  if (!progress.isIndexing) return null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
          <Sparkles className="h-4 w-4 text-emerald-600 animate-pulse" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            SEE:SIGN이 파일을 학습 중입니다
          </p>
          <p className="mt-1 text-xs text-slate-600">{progress.headline}</p>
          {progress.detail && (
            <p className="mt-0.5 text-[11px] text-slate-400">{progress.detail}</p>
          )}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-700">
          {progress.percent}%
        </span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-500 ease-out"
          style={{ width: `${progress.percent}%` }}
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="파일 학습 진행률"
        />
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        학습이 완료되면 대화를 시작할 수 있습니다.
      </p>
    </div>
  );
}
