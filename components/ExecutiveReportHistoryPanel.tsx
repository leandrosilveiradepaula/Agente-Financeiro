"use client";

import { Check, ClipboardCopy, FileDown, FileText, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  createExecutiveReportMarkdownFilename,
  downloadMarkdownFile
} from "@/lib/executive-report-markdown";
import type { ExecutiveReportHistoryItem } from "@/lib/types";

type ExecutiveReportHistoryPanelProps = {
  items: ExecutiveReportHistoryItem[];
  onRemoveItem: (id: string) => void;
  onClearHistory: () => void;
};

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Data indisponível";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function ExecutiveReportHistoryPanel({
  items,
  onRemoveItem,
  onClearHistory
}: ExecutiveReportHistoryPanelProps) {
  const [copiedId, setCopiedId] = useState("");
  const [downloadedId, setDownloadedId] = useState("");
  const [actionError, setActionError] = useState("");

  async function copyMarkdown(item: ExecutiveReportHistoryItem) {
    try {
      setActionError("");
      await navigator.clipboard.writeText(item.markdown);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(""), 1800);
    } catch {
      setActionError("Não foi possível copiar o Markdown salvo.");
    }
  }

  function downloadMarkdown(item: ExecutiveReportHistoryItem) {
    try {
      setActionError("");
      downloadMarkdownFile(item.markdown, createExecutiveReportMarkdownFilename(item.query_id));
      setDownloadedId(item.id);
      window.setTimeout(() => setDownloadedId(""), 1800);
    } catch {
      setActionError("Não foi possível baixar o Markdown salvo.");
    }
  }

  function clearHistory() {
    if (!window.confirm("Tem certeza que deseja limpar o histórico de relatórios?")) {
      return;
    }

    onClearHistory();
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-lake" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-ink">Histórico de relatórios</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-steel">
            {items.length}
          </span>
          {items.length ? (
            <button
              type="button"
              onClick={clearHistory}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-steel transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Limpar histórico
            </button>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
          {actionError}
        </div>
      ) : null}

      {items.length ? (
        <div className="flex max-h-[520px] flex-col gap-2 overflow-auto pr-1">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-md border border-slate-200 bg-slate-50 p-3 transition hover:border-blue-300 hover:bg-blue-50"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  {formatDate(item.generated_at)}
                </span>
                <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                  {item.row_count ?? 0} linhas
                </span>
              </div>
              <p className="line-clamp-3 text-sm font-semibold leading-5 text-ink">
                {item.question || "Pergunta não informada."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-steel">
                {item.query_id ? (
                  <span className="rounded-md bg-white px-2 py-1">ID {item.query_id}</span>
                ) : null}
                <span className="rounded-md bg-white px-2 py-1">
                  {item.detected_intent || item.summary.intent || "sem_intencao"}
                </span>
                <span className="rounded-md bg-white px-2 py-1">
                  {item.validation_status || "sem_status"}
                </span>
                {item.execution_time_ms !== null && item.execution_time_ms !== undefined ? (
                  <span className="rounded-md bg-white px-2 py-1">
                    {item.execution_time_ms} ms
                  </span>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => copyMarkdown(item)}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-ink transition hover:border-blue-300 hover:bg-blue-50"
                >
                  {copiedId === item.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                  ) : (
                    <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {copiedId === item.id ? "Copiado" : "Copiar Markdown"}
                </button>
                <button
                  type="button"
                  onClick={() => downloadMarkdown(item)}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-ink transition hover:border-blue-300 hover:bg-blue-50"
                >
                  {downloadedId === item.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                  ) : (
                    <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {downloadedId === item.id ? "Baixado" : "Baixar Markdown"}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-steel transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-steel">
          Nenhum relatório salvo ainda.
        </div>
      )}
    </section>
  );
}
