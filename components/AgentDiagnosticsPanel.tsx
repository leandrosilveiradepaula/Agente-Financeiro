"use client";

import { Check, ClipboardCopy, HeartPulse, TriangleAlert, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ExecuteWatsonResponse,
  ExecutiveReportHistoryItem,
  ExecutiveSummaryResult,
  GenerateSqlResponse
} from "@/lib/types";

type DiagnosticStatus = "ok" | "attention" | "missing";

type AgentDiagnosticsPanelProps = {
  interfaceVersion: string;
  baseline: string;
  agentVersion: string;
  generation: {
    response: GenerateSqlResponse | null;
    isLoading: boolean;
    error: string;
  };
  execution: {
    response: ExecuteWatsonResponse | null;
    isLoading: boolean;
    error: string;
    message: string;
    source: "automatico" | "manual" | null;
  };
  metadata: {
    query_id?: string;
    execution_time_ms?: number | null;
    row_count?: number;
    success?: boolean;
    detected_intent?: string;
    validation_status?: string;
  };
  queryHistoryCount: number;
  executiveReportHistoryCount: number;
  lastExecutiveReport?: ExecutiveReportHistoryItem | null;
  executiveSummary: ExecutiveSummaryResult | null;
  onClearLocalErrors?: () => void;
};

function statusClasses(status: DiagnosticStatus) {
  if (status === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "attention") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-rose-200 bg-rose-50 text-rose-800";
}

function statusLabel(status: DiagnosticStatus) {
  if (status === "ok") {
    return "OK";
  }

  if (status === "attention") {
    return "Atenção";
  }

  return "Ausente";
}

function checkPresence(value: unknown): DiagnosticStatus {
  if (Array.isArray(value)) {
    return value.length ? "ok" : "missing";
  }

  return value ? "ok" : "missing";
}

function formatDate(value?: string) {
  if (!value) {
    return "Nenhum relatório salvo";
  }

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

function CheckRow({ label, status }: { label: string; status: DiagnosticStatus }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${statusClasses(status)}`}>
        {statusLabel(status)}
      </span>
    </div>
  );
}

export function AgentDiagnosticsPanel({
  interfaceVersion,
  baseline,
  agentVersion,
  generation,
  execution,
  metadata,
  queryHistoryCount,
  executiveReportHistoryCount,
  lastExecutiveReport,
  executiveSummary,
  onClearLocalErrors
}: AgentDiagnosticsPanelProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [localStorageStatus, setLocalStorageStatus] = useState<DiagnosticStatus>("attention");
  const response = execution.response;
  const hasCurrentExecution = Boolean(response);
  const backendSummary = response?.relatorio_executivo ?? response?.executive_summary ?? null;
  const currentIntent =
    backendSummary?.intent ||
    executiveSummary?.intent ||
    metadata.detected_intent ||
    generation.response?.detected_intent ||
    "Não informada";
  const hasLocalErrors = Boolean(generation.error || execution.error);
  useEffect(() => {
    try {
      const key = "__ducklake_diag_test__";
      window.localStorage.setItem(key, "1");
      window.localStorage.removeItem(key);
      setLocalStorageStatus("ok");
    } catch {
      setLocalStorageStatus("missing");
    }
  }, []);

  const contractChecks = [
    { label: "relatorio_executivo presente", status: checkPresence(response?.relatorio_executivo) },
    { label: "executive_summary presente", status: checkPresence(response?.executive_summary) },
    {
      label: "relatorio_executivo_markdown presente",
      status: checkPresence(response?.relatorio_executivo_markdown)
    },
    { label: "columns presente", status: checkPresence(response?.columns) },
    { label: "data presente", status: checkPresence(response?.data) },
    { label: "query_id presente", status: checkPresence(response?.query_id) },
    {
      label: "row_count presente",
      status:
        response?.row_count !== null && response?.row_count !== undefined ? "ok" : "missing"
    },
    {
      label: "success true",
      status: response?.success === true ? "ok" : response ? "attention" : "missing"
    }
  ] satisfies Array<{ label: string; status: DiagnosticStatus }>;

  const diagnosticsText = [
    "Agente SQL Financeiro DuckLake — Diagnóstico",
    "",
    `Data/hora: ${new Date().toLocaleString("pt-BR")}`,
    `Interface: ${interfaceVersion}`,
    `Baseline: ${baseline}`,
    `Agente: ${agentVersion}`,
    `Query ID: ${metadata.query_id || "Não informado"}`,
    `Intenção: ${currentIntent}`,
    `Sucesso: ${String(response?.success ?? "Não informado")}`,
    `Linhas: ${metadata.row_count ?? "Não informado"}`,
    `Tempo: ${
      metadata.execution_time_ms === null || metadata.execution_time_ms === undefined
        ? "Não informado"
        : `${metadata.execution_time_ms} ms`
    }`,
    `Relatório executivo: ${backendSummary ? "presente" : "ausente"}`,
    `Markdown executivo: ${response?.relatorio_executivo_markdown ? "presente" : "ausente"}`,
    `Columns: ${response?.columns?.length ? "presente" : "ausente"}`,
    `Data: ${response?.data?.length ? "presente" : "ausente"}`,
    `Fonte: ${execution.source || "não iniciada"}`,
    `Histórico de queries: ${queryHistoryCount}`,
    `Histórico de relatórios: ${executiveReportHistoryCount}`,
    `Erro geração: ${generation.error || "nenhum"}`,
    `Erro execução: ${execution.error || "nenhum"}`
  ].join("\n");

  async function copyDiagnostics() {
    try {
      setCopyError("");
      await navigator.clipboard.writeText(diagnosticsText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError("Não foi possível copiar o diagnóstico.");
    }
  }

  if (!hasCurrentExecution) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-lake" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-ink">Diagnostico do agente</h2>
          </div>
          <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
            {interfaceVersion}
          </span>
        </div>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Baseline</p>
            <p className="mt-1 text-sm font-semibold text-ink">{baseline}</p>
            <p className="mt-1 text-xs text-steel">Ambiente: navegador local</p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-steel">
            Nenhuma execucao carregada para diagnostico.
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Historico local</p>
            <div className="grid gap-2">
              <CheckRow label={`queries salvas: ${queryHistoryCount}`} status="ok" />
              <CheckRow label={`relatorios salvos: ${executiveReportHistoryCount}`} status="ok" />
              <CheckRow label="localStorage disponivel" status={localStorageStatus} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <HeartPulse className="h-5 w-5 text-lake" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-ink">Diagnóstico do agente</h2>
        </div>
        <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
          {interfaceVersion}
        </span>
      </div>

      <div className="space-y-3 text-sm">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Baseline</p>
          <p className="mt-1 text-sm font-semibold text-ink">{baseline}</p>
          <p className="mt-1 text-xs text-steel">Ambiente: navegador local</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <CheckRow label="success" status={response?.success ? "ok" : response ? "attention" : "missing"} />
          <CheckRow label="query_id" status={checkPresence(metadata.query_id)} />
          <CheckRow label="row_count" status={metadata.row_count !== undefined ? "ok" : "missing"} />
          <CheckRow
            label="execution_time_ms"
            status={metadata.execution_time_ms !== undefined ? "ok" : "missing"}
          />
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Resultado atual</p>
          <div className="mt-2 grid gap-1 text-xs text-steel">
            <span>Query ID: {metadata.query_id || "Não informado"}</span>
            <span>Intenção: {currentIntent}</span>
            <span>Linhas: {metadata.row_count ?? "Não informado"}</span>
            <span>
              Tempo:{" "}
              {metadata.execution_time_ms === null || metadata.execution_time_ms === undefined
                ? "Não informado"
                : `${metadata.execution_time_ms} ms`}
            </span>
            <span>Fonte: {execution.source || "não iniciada"}</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Contrato backend</p>
          <div className="grid gap-2">
            {contractChecks.map((item) => (
              <CheckRow key={item.label} label={item.label} status={item.status} />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Histórico local</p>
          <div className="grid gap-2">
            <CheckRow label={`queries salvas: ${queryHistoryCount}`} status="ok" />
            <CheckRow label={`relatórios salvos: ${executiveReportHistoryCount}`} status="ok" />
            <CheckRow label="localStorage disponível" status={localStorageStatus} />
            <CheckRow
              label={`último relatório: ${formatDate(lastExecutiveReport?.generated_at)}`}
              status={lastExecutiveReport ? "ok" : "attention"}
            />
          </div>
        </div>

        {(generation.error || execution.error || copyError) ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
            <div className="flex items-center gap-1">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copyError || generation.error || execution.error}</span>
            </div>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={copyDiagnostics}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            ) : (
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {copied ? "Copiado" : "Copiar diagnóstico"}
          </button>
          <button
            type="button"
            disabled={!hasLocalErrors}
            onClick={onClearLocalErrors}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-ink shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Limpar erros locais
          </button>
        </div>
      </div>
    </section>
  );
}
