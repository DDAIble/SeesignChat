"use client";

import { useEffect, useId, useState } from "react";

interface MermaidChartProps {
  code: string;
}

export default function MermaidChart({ code }: MermaidChartProps) {
  const reactId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderChart() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
          fontFamily: "inherit",
        });

        const renderId = `mermaid-${reactId}-${Date.now()}`;
        const result = await mermaid.render(renderId, code.trim());
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "차트를 렌더링하지 못했습니다.");
          setSvg("");
        }
      }
    }

    void renderChart();

    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  if (error) {
    return (
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 last:mb-0">
        차트를 표시하지 못했습니다. ({error})
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="mb-3 flex h-48 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-500 last:mb-0">
        차트를 불러오는 중…
      </div>
    );
  }

  return (
    <div
      className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm last:mb-0 [&_svg]:mx-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
