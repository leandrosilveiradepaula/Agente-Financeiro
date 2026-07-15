"use client";

import { Check, Copy, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { generateExecutiveSummary } from "@/lib/generateExecutiveSummary";
import type { ExecutiveSummaryResult, ResultRow } from "@/lib/types";

type ExecutiveSummaryProps = {
  question?: string;
  columns: string[];
  data: ResultRow[];
  metadata?: {
    query_id?: string;
    execution_time_ms?: number | null;
    row_count?: number;
    success?: boolean;
    detected_intent?: string;
  };
  backendSummary?: ExecutiveSummaryResult | null;
  onSummaryGenerated?: (summary: ExecutiveSummaryResult) => void;
};

function summaryToText(summary: ExecutiveSummaryResult) {
  return [
    summary.title,
    "",
    ...summary.paragraphs,
    "",
    "Principais destaques:",
    ...summary.highlights.map((highlight) => `- ${highlight}`),
    ...(summary.warnings?.length
      ? ["", "Pontos de atenção:", ...summary.warnings.map((warning) => `- ${warning}`)]
      : [])
  ].join("\n");
}

export function ExecutiveSummary({
  question,
  columns,
  data,
  metadata,
  backendSummary,
  onSummaryGenerated
}: ExecutiveSummaryProps) {
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const hasResultRows = data.length > 0;
  const usesBackendSummary = Boolean(backendSummary) && !hasResultRows;
  const summary = useMemo(() => {
    if (!hasResultRows && backendSummary) {
      return backendSummary;
    }

    return generateExecutiveSummary({ question, columns, data, metadata });
  }, [backendSummary, columns, data, hasResultRows, metadata, question, revision]);

  useEffect(() => {
    onSummaryGenerated?.(summary);
  }, [onSummaryGenerated, summary]);

  async function copySummary() {
    await navigator.clipboard.writeText(summaryToText(summary));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="mb-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-lake" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-ink">Resumo executivo</h3>
          </div>
          <p className="mt-1 text-sm text-steel">
            Interpretação automática baseada no resultado carregado
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={copySummary}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
            {copied ? "Copiado" : "Copiar resumo"}
          </button>
          {!usesBackendSummary ? (
            <button
              type="button"
              onClick={() => setRevision((current) => current + 1)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Regerar resumo
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2 text-sm leading-6 text-slate-700">
        {summary.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      {summary.highlights.length ? (
        <ul className="mt-4 space-y-2">
          {summary.highlights.map((highlight) => (
            <li key={highlight} className="rounded-md bg-slate-50 px-3 py-2 text-sm text-ink">
              {highlight}
            </li>
          ))}
        </ul>
      ) : null}

      {summary.warnings?.length ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {summary.warnings.join(" ")}
        </div>
      ) : null}

      <p className="mt-4 text-xs font-medium text-slate-500">
        {usesBackendSummary
          ? "Resumo executivo gerado pelo serviço de orquestração."
          : "Resumo executivo gerado a partir dos resultados normalizados da interface."}
      </p>
    </section>
  );
}
