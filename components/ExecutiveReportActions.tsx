"use client";

import { Check, Copy, Download, Eye, FileDown, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import {
  exportExecutivePdf,
  type ExecutiveReportMetadata
} from "@/lib/exportExecutivePdf";
import {
  buildExecutiveReportMarkdown,
  createExecutiveReportMarkdownFilename,
  downloadMarkdownFile
} from "@/lib/executive-report-markdown";
import { exportExecutiveCsv, exportExecutiveXlsx } from "@/lib/exportExecutiveFiles";
import type { InterfaceSettings } from "@/lib/interface-settings";
import { prioritizePresentationColumns } from "@/lib/report-column-priority";
import type { ExecutiveSummaryResult, ResultRow } from "@/lib/types";

type ExecutiveReportActionsProps = {
  question: string;
  sql: string;
  columns: string[];
  data: ResultRow[];
  metadata: ExecutiveReportMetadata;
  executiveSummary?: ExecutiveSummaryResult | null;
  backendMarkdown?: string | null;
  canViewSql: boolean;
  settings?: Pick<
    InterfaceSettings,
    | "pdfMaxRows"
    | "pdfMaxColumns"
    | "pdfIncludeSql"
    | "pdfMaxSqlLines"
    | "markdownIncludeSql"
  >;
  onPdfExported?: () => void;
};

export function ExecutiveReportActions({
  question,
  sql,
  columns,
  data,
  metadata,
  executiveSummary,
  backendMarkdown,
  canViewSql,
  settings,
  onPdfExported
}: ExecutiveReportActionsProps) {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const previewColumns = prioritizePresentationColumns(columns, settings?.pdfMaxColumns ?? 8);
  const safeSql = canViewSql ? sql : "";
  const safeBackendMarkdown = canViewSql ? backendMarkdown : null;

  function getMarkdownReport() {
    return (
      safeBackendMarkdown?.trim() ||
      buildExecutiveReportMarkdown({
        question,
        sql: safeSql,
        metadata,
        executiveSummary,
        includeSql: canViewSql && (settings?.markdownIncludeSql ?? true)
      })
    );
  }

  async function copyReport() {
    try {
      setActionError("");
      await navigator.clipboard.writeText(getMarkdownReport());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setActionError("Não foi possível copiar o relatório. Tente novamente ou copie pela prévia.");
    }
  }

  function downloadMarkdownReport() {
    try {
      setActionError("");
      downloadMarkdownFile(
        getMarkdownReport(),
        createExecutiveReportMarkdownFilename(metadata.query_id)
      );
      setDownloaded(true);
      window.setTimeout(() => setDownloaded(false), 1800);
    } catch {
      setActionError("Não foi possível baixar o relatório em Markdown.");
    }
  }

  function exportPdf() {
    try {
      setActionError("");
      const pdfSettings = settings
        ? {
            pdfMaxRows: settings.pdfMaxRows,
            pdfMaxColumns: settings.pdfMaxColumns,
            pdfMaxSqlLines: settings.pdfMaxSqlLines,
            pdfIncludeSql: canViewSql && settings.pdfIncludeSql
          }
        : undefined;

      exportExecutivePdf({
        question,
        sql: safeSql,
        columns,
        data,
        metadata,
        executiveSummary,
        settings: pdfSettings
      });
      onPdfExported?.();
    } catch {
      setActionError("Não foi possível gerar o PDF. Verifique os dados carregados e tente novamente.");
    }
  }

  async function exportXlsx() {
    try {
      setActionError("");
      await exportExecutiveXlsx({
        question,
        columns,
        data,
        rowCount: metadata.row_count ?? data.length,
        success: Boolean(metadata.success),
        executionTimeMs: metadata.execution_time_ms,
        detectedIntent: metadata.detected_intent,
        executiveSummary
      });
    } catch {
      setActionError("Não foi possível gerar o Excel. Verifique os dados carregados e tente novamente.");
    }
  }

  function exportCsv() {
    try {
      setActionError("");
      exportExecutiveCsv(columns, data);
    } catch {
      setActionError("Não foi possível gerar o CSV. Verifique os dados carregados e tente novamente.");
    }
  }

  return (
    <section className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Resposta executiva</h3>
          <p className="mt-1 text-sm text-steel">Exportar relatório</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={exportPdf}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ledger px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Exportar PDF
          </button>
          <button
            type="button"
            onClick={exportXlsx}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            Excel
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            CSV
          </button>
          <button
            type="button"
            onClick={copyReport}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
            {copied ? "Copiado" : "Copiar relatório"}
          </button>
          <button
            type="button"
            onClick={downloadMarkdownReport}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            {downloaded ? (
              <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            ) : (
              <FileDown className="h-4 w-4" aria-hidden="true" />
            )}
            {downloaded ? "Baixado" : "Baixar Markdown"}
          </button>
          <button
            type="button"
            onClick={() => setPreviewOpen((current) => !current)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            Visualizar relatório
          </button>
        </div>
      </div>

      {actionError ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
          {actionError}
        </div>
      ) : null}

      {previewOpen ? (
        <div className="mt-4 rounded-md border border-slate-200 bg-white p-4">
          <h4 className="text-lg font-semibold text-ink">Prévia do relatório</h4>
          <div className="mt-4 space-y-4 text-sm leading-6 text-slate-700">
            <section>
              <h5 className="font-semibold text-ink">Pergunta</h5>
              <p>{question || "Pergunta não informada."}</p>
            </section>
            <section>
              <h5 className="font-semibold text-ink">Metadados</h5>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                <li>Versão: {metadata.agent_version || "Não informada"}</li>
                <li>Intenção: {metadata.detected_intent || "Não informada"}</li>
                <li>Validação: {metadata.validation_status || "Não informada"}</li>
                <li>Tempo: {metadata.execution_time_ms ?? "Não informado"}</li>
                <li>Linhas: {metadata.row_count ?? data.length}</li>
              </ul>
            </section>
            {executiveSummary ? (
            <section>
              <h5 className="font-semibold text-ink">Resumo executivo</h5>
              {executiveSummary.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {executiveSummary.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
              {executiveSummary.warnings?.length ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  <h6 className="font-semibold text-amber-950">Observações</h6>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {executiveSummary.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
            ) : null}
            {canViewSql && safeSql.trim() ? (
            <section>
              <h5 className="font-semibold text-ink">Consulta técnica</h5>
              <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
                {safeSql}
              </pre>
            </section>
            ) : null}
            <section>
              <h5 className="font-semibold text-ink">Tabela resumida</h5>
              <div className="mt-2 overflow-auto rounded-md border border-slate-200">
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {previewColumns.map((column) => (
                        <th key={column} className="px-2 py-2">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.slice(0, 5).map((row, index) => (
                      <tr key={index}>
                        {previewColumns.map((column) => (
                          <td key={column} className="px-2 py-2">
                            {String(row[column] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
