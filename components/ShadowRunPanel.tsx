"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  GitBranch,
  XCircle
} from "lucide-react";
import type {
  ShadowRunSummary,
  ShadowStepMetadata,
  ShadowRunVisualization,
  ShadowRunVisualizationStep
} from "@/lib/types";

type ShadowListState =
  | { status: "loading"; runs: ShadowRunSummary[]; message?: string }
  | { status: "ready"; runs: ShadowRunSummary[]; message?: string }
  | { status: "empty"; runs: ShadowRunSummary[]; message?: string }
  | { status: "unavailable"; runs: ShadowRunSummary[]; message: string }
  | { status: "forbidden"; runs: ShadowRunSummary[]; message: string }
  | { status: "error"; runs: ShadowRunSummary[]; message: string };

type VisualizationState =
  | { status: "idle"; data: null; message?: string }
  | { status: "loading"; data: null; message?: string }
  | { status: "ready"; data: ShadowRunVisualization; message?: string }
  | { status: "unavailable"; data: null; message: string }
  | { status: "forbidden"; data: null; message: string }
  | { status: "not_found"; data: null; message: string }
  | { status: "error"; data: null; message: string };

type ComparisonSqlAssessment = {
  verdict: "normalized_sql_match" | "structural_differences" | "inconclusive";
  different_facets: string[];
  tenant_identity_attested: boolean;
  same_data_snapshot_attested: false;
  financial_parity_proven: false;
  real_sql_executed: false;
  requires_reapproval: boolean;
};

type ComparisonStage =
  | { status: "ok"; data: ComparisonSqlAssessment }
  | { status: "not_recorded" | "rejected" | "unavailable" };

type ComparisonData = {
  generated: ComparisonStage;
  executed: ComparisonStage;
  official_sql_text_changed: boolean | null;
};

type ComparisonState =
  | { status: "idle" | "loading"; shadowId: string | null }
  | { status: "ready"; shadowId: string; data: ComparisonData }
  | { status: "error"; shadowId: string; message: string };

const SQL_COMPARISON_LABELS: Record<string, string> = {
  physical_tables: "Tabelas",
  joined_relations: "Relacionamentos e joins",
  predicates: "Filtros e valores",
  projections: "Colunas e expressões",
  groupings: "Agrupamentos",
  orderings: "Ordenação",
  functions: "Funções e agregações",
  query_shape: "Estrutura da consulta"
};

const METADATA_LABELS = {
  attempt: "Tentativa",
  attempts: "Tentativas",
  cycle: "Ciclo",
  cycles: "Ciclos",
  duration_ms: "Duracao",
  failure_category: "Categoria",
  gate: "Gate",
  kind: "Tipo",
  phase: "Fase",
  preflight_status: "Preflight",
  reason_code: "Codigo",
  repair_attempt: "Repair",
  repair_iteration: "Iteracao",
  requires_reapproval: "Reaprovacao",
  result: "Resultado"
} satisfies Record<keyof ShadowStepMetadata, string>;

function formatDate(value: string | null | undefined) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    completed: "Concluido",
    error: "Erro",
    failed: "Falhou",
    pending: "Pendente",
    repair_required: "Repair requerido",
    running: "Em andamento",
    skipped: "Ignorado",
    success: "Sucesso"
  };

  return labels[status] ?? (status || "-");
}

function eventLabel(eventType: string) {
  const labels: Record<string, string> = {
    execute_approved: "Execute Approved Shadow",
    execute_approved_shadow: "Execute Approved Shadow",
    generate: "Generate Shadow",
    generate_shadow: "Generate Shadow"
  };

  return labels[eventType] ?? eventType;
}

function badgeClass(tone: "neutral" | "success" | "warning" | "error" | "info") {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "error") return "border-rose-200 bg-rose-50 text-rose-800";
  if (tone === "info") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function statusTone(status: string): "neutral" | "success" | "warning" | "error" | "info" {
  const normalized = status.toLowerCase();
  if (["completed", "success", "ok"].includes(normalized)) return "success";
  if (["failed", "error"].includes(normalized)) return "error";
  if (["repair_required", "warning"].includes(normalized)) return "warning";
  if (["running", "pending"].includes(normalized)) return "info";
  return "neutral";
}

function renderSafeValue(value: ShadowStepMetadata[keyof ShadowStepMetadata]) {
  if (typeof value === "boolean") return value ? "Sim" : "Nao";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return null;
}

function safeMetadataEntries(metadata: ShadowRunVisualizationStep["metadata"]) {
  if (!metadata) return [];

  return (Object.entries(METADATA_LABELS) as Array<[keyof ShadowStepMetadata, string]>).reduce<
    Array<{ key: keyof ShadowStepMetadata; label: string; value: string }>
  >((entries, [key, label]) => {
    const value = renderSafeValue(metadata[key]);

    if (value) {
      entries.push({ key, label, value });
    }

    return entries;
  }, []);
}

async function readApiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: unknown };
    return typeof data.error === "string" && data.error ? data.error : fallback;
  } catch {
    return fallback;
  }
}

function getShortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

export function ShadowRunPanel({ agentRunId }: { agentRunId: string }) {
  const [listState, setListState] = useState<ShadowListState>({
    status: "loading",
    runs: []
  });
  const [selectedShadowId, setSelectedShadowId] = useState<string | null>(null);
  const [comparisonEnabled, setComparisonEnabled] = useState(false);
  const [comparisonState, setComparisonState] = useState<ComparisonState>({
    status: "idle", shadowId: null
  });
  const [visualizationState, setVisualizationState] = useState<VisualizationState>({
    status: "idle",
    data: null
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setListState({ status: "loading", runs: [] });
    setSelectedShadowId(null);
    setComparisonEnabled(false);
    setVisualizationState({ status: "idle", data: null });

    async function loadShadowRuns() {
      try {
        const response = await fetch(
          `/api/admin/runs/${encodeURIComponent(agentRunId)}/shadow-runs?limit=20`,
          {
            cache: "no-store",
            signal: controller.signal
          }
        );

        if (!active) return;

        if (response.status === 403) {
          setListState({
            status: "forbidden",
            runs: [],
            message: "Sem permissao para visualizar o Shadow desta execucao."
          });
          return;
        }

        if (response.status === 503) {
          setListState({
            status: "unavailable",
            runs: [],
            message: "Shadow indisponivel no momento."
          });
          return;
        }

        if (!response.ok) {
          const reason = await readApiError(response, "shadow_load_failed");
          if (!active) return;
          setListState({
            status: "error",
            runs: [],
            message: `Nao foi possivel carregar Shadow: ${reason}`
          });
          return;
        }

        const data = (await response.json()) as {
          shadow_runs?: ShadowRunSummary[];
          comparison_enabled?: boolean;
        };
        const runs = data.shadow_runs ?? [];

        if (!active) return;
        setComparisonEnabled(data.comparison_enabled === true);

        if (runs.length === 0) {
          setListState({
            status: "empty",
            runs: [],
            message: "Nenhum Shadow Run encontrado para esta execucao."
          });
          return;
        }

        setListState({ status: "ready", runs });
        setSelectedShadowId(runs[0].shadow_record_id);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setListState({
          status: "unavailable",
          runs: [],
          message: "Shadow indisponivel no momento."
        });
      }
    }

    loadShadowRuns();

    return () => {
      active = false;
      controller.abort();
    };
  }, [agentRunId]);

  useEffect(() => {
    if (!selectedShadowId) {
      setVisualizationState({ status: "idle", data: null });
      return;
    }

    const shadowId = selectedShadowId;
    const controller = new AbortController();
    let active = true;

    setVisualizationState({ status: "loading", data: null });

    async function loadVisualization() {
      try {
        const response = await fetch(
          `/api/admin/shadow-runs/${encodeURIComponent(shadowId)}/visualization`,
          {
            cache: "no-store",
            signal: controller.signal
          }
        );

        if (!active) return;

        if (response.status === 403) {
          setVisualizationState({
            status: "forbidden",
            data: null,
            message: "Sem permissao para visualizar este Shadow."
          });
          return;
        }

        if (response.status === 404) {
          setVisualizationState({
            status: "not_found",
            data: null,
            message: "Visualizacao Shadow nao encontrada."
          });
          return;
        }

        if (response.status === 503) {
          setVisualizationState({
            status: "unavailable",
            data: null,
            message: "Visualizacao Shadow indisponivel no momento."
          });
          return;
        }

        if (!response.ok) {
          const reason = await readApiError(response, "shadow_visualization_failed");
          if (!active) return;
          setVisualizationState({
            status: "error",
            data: null,
            message: `Nao foi possivel carregar visualizacao: ${reason}`
          });
          return;
        }

        const data = (await response.json()) as { visualization?: ShadowRunVisualization };

        if (!active) return;

        if (!data.visualization) {
          setVisualizationState({
            status: "error",
            data: null,
            message: "Visualizacao Shadow invalida."
          });
          return;
        }

        setVisualizationState({ status: "ready", data: data.visualization });
      } catch {
        if (!active || controller.signal.aborted) return;
        setVisualizationState({
          status: "unavailable",
          data: null,
          message: "Visualizacao Shadow indisponivel no momento."
        });
      }
    }

    loadVisualization();

    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedShadowId]);

  const selectedRun = useMemo(
    () =>
      listState.runs.find((run) => run.shadow_record_id === selectedShadowId) ?? null,
    [listState.runs, selectedShadowId]
  );

  async function compareSelectedRun() {
    if (!selectedShadowId || selectedRun?.event_type !== "generate") return;
    const shadowId = selectedShadowId;
    setComparisonState({ status: "loading", shadowId });
    try {
      const endpoint = "/api/admin/runs/" + encodeURIComponent(agentRunId) +
        "/shadow-comparison?shadow_record_id=" + encodeURIComponent(shadowId);
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) {
        setComparisonState({
          status: "error", shadowId,
          message: response.status === 503
            ? "Comparador indisponível até ativação controlada."
            : response.status === 403
              ? "Seu perfil não está autorizado a comparar SQL."
              : "Não foi possível comparar as duas consultas desta execução."
        });
        return;
      }
      const body = (await response.json()) as {
        success?: boolean;
        comparison?: ComparisonData;
      };
      if (body.success !== true || !body.comparison) throw Error("invalid comparison");
      setComparisonState({ status: "ready", shadowId, data: body.comparison });
    } catch {
      setComparisonState({
        status: "error", shadowId,
        message: "Não foi possível obter a comparação SQL."
      });
    }
  }

  return (
    <section className="rounded-md border border-slate-200 p-4">
      <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-lake">
            <GitBranch className="h-4 w-4" aria-hidden="true" />
            Shadow LangGraph
          </div>
          <p className="mt-1 text-xs font-medium text-steel">
            Observabilidade read-only correlacionada ao run oficial.
          </p>
        </div>
        <span className={`w-fit rounded-md border px-2 py-1 text-xs font-semibold ${badgeClass("neutral")}`}>
          {listState.runs.length ? `${listState.runs.length} registros` : "Sem registros"}
        </span>
      </div>

      <div className="mt-4">
        {listState.status === "loading" ? (
          <StateMessage tone="info" text="Carregando Shadow LangGraph..." />
        ) : ["empty", "unavailable", "forbidden", "error"].includes(listState.status) ? (
          <StateMessage
            tone={listState.status === "unavailable" ? "warning" : listState.status === "empty" ? "neutral" : "error"}
            text={listState.message}
          />
        ) : (
          <div className="space-y-4">
            <ShadowRunSelector
              runs={listState.runs}
              selectedShadowId={selectedShadowId}
              onSelect={setSelectedShadowId}
            />

            {selectedRun ? <ShadowRunSummaryCards run={selectedRun} /> : null}

            {selectedRun?.event_type === "generate" && !comparisonEnabled ? (
              <StateMessage tone="neutral" text="A comparação de SQL está desativada neste ambiente." />
            ) : null}

            {selectedRun?.event_type === "generate" && comparisonEnabled ? (
              <div className="space-y-2 rounded-md border border-slate-200 p-3">
                <button
                  type="button"
                  onClick={compareSelectedRun}
                  disabled={comparisonState.status === "loading" &&
                    comparisonState.shadowId === selectedShadowId}
                  className="rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Comparar SQL gerada e executada (sem executar novamente)
                </button>
                <p className="text-xs text-steel">
                  Compara as duas versões registradas pelo fluxo oficial com a mesma geração LangGraph. Não executa SQL e não comprova equivalência financeira.
                </p>
                {comparisonState.shadowId === selectedShadowId &&
                 comparisonState.status === "loading" ? (
                  <StateMessage tone="info" text="Comparando estruturas SQL..." />
                ) : null}
                {comparisonState.shadowId === selectedShadowId &&
                 comparisonState.status === "error" ? (
                  <StateMessage tone="warning" text={comparisonState.message} />
                ) : null}
                {comparisonState.shadowId === selectedShadowId &&
                 comparisonState.status === "ready" ? (
                  <div className="space-y-3 text-sm">
                    <SqlComparisonStage
                      label="SQL gerada pelo fluxo oficial"
                      stage={comparisonState.data.generated}
                    />
                    <SqlComparisonStage
                      label="SQL registrada como executada pelo fluxo oficial"
                      stage={comparisonState.data.executed}
                    />
                    {comparisonState.data.official_sql_text_changed === true ? (
                      <p className="font-medium text-amber-800">
                        A SQL oficial foi alterada entre geração e execução.
                        Verifique o cleaner e os filtros; a diferença pode ser apenas formatação.
                      </p>
                    ) : null}
                    <p className="font-medium text-steel">
                      Comparação estrutural somente. Paridade financeira e equivalência
                      numérica não comprovadas; nenhuma consulta executada por este comparador.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {visualizationState.status === "loading" ? (
              <StateMessage tone="info" text="Carregando visualizacao Shadow..." />
            ) : visualizationState.status === "ready" ? (
              <ShadowVisualization visualization={visualizationState.data} />
            ) : visualizationState.status !== "idle" ? (
              <StateMessage
                tone={visualizationState.status === "unavailable" ? "warning" : "error"}
                text={visualizationState.message}
              />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function SqlComparisonStage({
  label,
  stage
}: {
  label: string;
  stage: ComparisonStage;
}) {
  if (stage.status !== "ok") {
    return (
      <div className="rounded-md border border-slate-200 p-3">
        <p className="font-semibold text-ink">{label}</p>
        <p className="text-steel">
          {stage.status === "not_recorded" ? "SQL não registrada nesta etapa."
            : stage.status === "rejected" ? "SQL não comparável com segurança."
              : "Comparação desta etapa indisponível."}
        </p>
      </div>
    );
  }
  const info = stage.data;
  const verdict = info.verdict === "normalized_sql_match"
    ? "Consultas normalizadas coincidem"
    : info.verdict === "structural_differences"
      ? "Divergências estruturais identificadas"
      : "Comparação inconclusiva";
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <p className="font-semibold text-ink">{label}</p>
      <p>{verdict}</p>
      {info.different_facets.length ? (
        <p>
          Aspectos diferentes: {info.different_facets
            .map((facet) => SQL_COMPARISON_LABELS[facet] ?? "Outros")
            .join(", ")}
        </p>
      ) : null}
      {!info.tenant_identity_attested ? (
        <p className="text-amber-800">Isolamento por tenant ainda não comprovado.</p>
      ) : null}
      {info.requires_reapproval ? (
        <p className="text-amber-800">SQL reparada requer nova aprovação.</p>
      ) : null}
    </div>
  );
}

function ShadowRunSelector({
  runs,
  selectedShadowId,
  onSelect
}: {
  runs: ShadowRunSummary[];
  selectedShadowId: string | null;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {runs.map((run) => {
        const selected = run.shadow_record_id === selectedShadowId;

        return (
          <button
            key={run.shadow_record_id}
            type="button"
            onClick={() => onSelect(run.shadow_record_id)}
            className={`rounded-md border px-3 py-2 text-left transition ${
              selected
                ? "border-blue-300 bg-blue-50 shadow-sm"
                : "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{eventLabel(run.event_type)}</span>
              <StatusBadge status={run.status} />
              {run.requires_reapproval ? (
                <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${badgeClass("warning")}`}>
                  Reaprovacao necessaria
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs font-medium text-steel">
              {formatDate(run.created_at)} | {getShortId(run.shadow_record_id)}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function ShadowRunSummaryCards({ run }: { run: ShadowRunSummary }) {
  return (
    <div className="grid gap-3 text-sm md:grid-cols-3">
      <MetricCard label="Tipo" value={eventLabel(run.event_type)} />
      <MetricCard label="Status" value={statusLabel(run.status)} />
      <MetricCard label="Inicio" value={formatDate(run.created_at)} />
      <MetricCard label="Fim" value={formatDate(run.completed_at)} />
      <MetricCard label="Requires Reapproval" value={run.requires_reapproval ? "Sim" : "Nao"} />
      <MetricCard label="Repair" value={run.has_repair ? "Observado" : "Nao observado"} />
      <MetricCard label="Erro" value={run.has_error ? "Observado" : "Nao observado"} />
    </div>
  );
}

function ShadowVisualization({ visualization }: { visualization: ShadowRunVisualization }) {
  const flags = visualization.flags;
  const warnings = [...(flags.warnings ?? []), ...(visualization.run.warnings ?? [])];
  const errors = [...(flags.errors ?? []), ...(visualization.run.errors ?? [])];

  return (
    <div className="space-y-4">
      {visualization.run.requires_reapproval || flags.requires_reapproval ? (
        <StateMessage tone="warning" text="Reaprovacao necessaria para qualquer execucao futura modificada." />
      ) : null}

      {visualization.run.has_repair || flags.has_repair ? (
        <StateMessage tone="warning" text="Repair observado durante o processamento Shadow." />
      ) : null}

      <MessageList tone="warning" title="Warnings" items={warnings} />
      <MessageList tone="error" title="Errors" items={errors} />

      <div>
        <h4 className="text-sm font-semibold text-ink">Timeline</h4>
        <ol className="mt-3 space-y-3">
          {visualization.steps.map((step) => (
            <TimelineStep key={step.id} step={step} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function TimelineStep({ step }: { step: ShadowRunVisualizationStep }) {
  const metadata = safeMetadataEntries(step.metadata);

  return (
    <li className="relative rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <StepIcon status={step.status} />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-steel">
              Step {step.order}
            </p>
            <p className="break-words text-sm font-semibold text-ink">{step.label}</p>
          </div>
        </div>
        <StatusBadge status={step.status} />
      </div>

      {metadata.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {metadata.map((item) => (
            <span
              key={item.key}
              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-steel"
            >
              {item.label}: {item.value}
            </span>
          ))}
        </div>
      ) : null}

      <MessageList tone="warning" title="Warnings" items={step.warnings ?? []} compact />
      <MessageList tone="error" title="Errors" items={step.errors ?? []} compact />
    </li>
  );
}

function StepIcon({ status }: { status: string }) {
  const tone = statusTone(status);
  const className =
    tone === "success"
      ? "text-emerald-600"
      : tone === "warning"
        ? "text-amber-600"
        : tone === "error"
          ? "text-rose-600"
          : tone === "info"
            ? "text-blue-600"
            : "text-slate-500";

  if (tone === "success") return <CheckCircle2 className={`mt-0.5 h-5 w-5 ${className}`} aria-hidden="true" />;
  if (tone === "warning") return <AlertTriangle className={`mt-0.5 h-5 w-5 ${className}`} aria-hidden="true" />;
  if (tone === "error") return <XCircle className={`mt-0.5 h-5 w-5 ${className}`} aria-hidden="true" />;
  if (tone === "info") return <Clock3 className={`mt-0.5 h-5 w-5 ${className}`} aria-hidden="true" />;
  return <Circle className={`mt-0.5 h-5 w-5 ${className}`} aria-hidden="true" />;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`w-fit rounded-md border px-2 py-1 text-xs font-semibold ${badgeClass(statusTone(status))}`}>
      {statusLabel(status)}
    </span>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs font-bold uppercase tracking-wide text-steel">{label}</p>
      <p className="mt-1 break-words font-semibold text-ink">{value}</p>
    </div>
  );
}

function StateMessage({ tone, text }: { tone: "neutral" | "info" | "warning" | "error"; text?: string }) {
  const className =
    tone === "info"
      ? "border-blue-200 bg-blue-50 text-blue-900"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-slate-200 bg-slate-50 text-steel";

  return (
    <div className={`rounded-md border px-3 py-3 text-sm font-semibold ${className}`}>
      {text}
    </div>
  );
}

function MessageList({
  tone,
  title,
  items,
  compact
}: {
  tone: "warning" | "error";
  title: string;
  items: string[];
  compact?: boolean;
}) {
  if (!items.length) return null;

  const className =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-rose-200 bg-rose-50 text-rose-800";

  return (
    <div className={`${compact ? "mt-3" : ""} rounded-md border px-3 py-2 text-sm ${className}`}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs font-medium">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
