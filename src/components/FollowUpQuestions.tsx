"use client";

import { ArrowRight } from "lucide-react";

interface FollowUpQuestionsProps {
  questions: string[];
  onSelect: (question: string) => void;
  disabled?: boolean;
}

export default function FollowUpQuestions({
  questions,
  onSelect,
  disabled = false,
}: FollowUpQuestionsProps) {
  if (questions.length === 0) return null;

  return (
    <div className="mt-3 border-t border-slate-200/80 pt-3">
      <p className="mb-2 text-xs font-medium text-slate-500">이어서 물어보기</p>
      <ul className="space-y-1.5">
        {questions.map((question) => (
          <li key={question}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(question)}
              className="group flex w-full items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-emerald-600" />
              <span className="leading-snug">{question}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
