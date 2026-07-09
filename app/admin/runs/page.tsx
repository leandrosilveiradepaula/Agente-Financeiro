"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Clipboard,
  Database,
  Lock,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  X
} from "lucide-react";

type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  profile: string;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type AgentRun = {
  id: string;
  created_at: string;
  updated_at: string;
  request_id: string | null;
  run_id: string | null;
  user_email: string | null;
  user_name: string | null;
  user_profile: string | null;
  pergunta: string;
  pergunta_normalizada: string | null;
  detected_intent: string | null;
  intent_confidence: string | number | null;
  sql_generated: string | null;
  sql_executed: string | null;
  validation_status: string | null;
  validation_errors: JsonValue;
  validation_warnings: JsonValue;
  execution_status: string;
  execution_error: string | null;
  row_count: number | null;
  columns: JsonValue;
  data_preview: JsonValue;
  execution_time_ms: number | null;
  total_time_ms: number | null;
  executor_mode: string | null;
  executor_version: string | null;
  n8n_status_code: number | null;
  watson_status_code: number | null;
  metadata: JsonValue;
  can_view_sql?: boolean;
  sql_hidden?: boolean;
  sql_preview?: string | null;
};

type AccountPolicy = {
  profile: string;
  display_name: string;
  can_generate_sql: boolean;
  can_execute_sql: boolean;
  can_view_sql: boolean;
  can_view_own_runs: boolean;
  can_view_all_runs: boolean;
  can_manage_users: boolean;
  can_view_admin_area: boolean;
  max_rows: number | null;
  max_execution_time_ms: number | null;
};

type AccessState = "checking" | "unauthenticated" | "forbidden" | "allowed";

const STATUS_OPTIONS = ["todos", "generated", "executed", "failed", "blocked", "pending"];
const LIMIT_OPTIONS = ["25", "50", "100", "200"];
const SENSITIVE_KEY_PATTERNS = [
  "token",
  "authorization",
  "cookie",
  "bearer",
  "password",
  "secret",
  "access_token",
  "refresh_token",
  "x-agent-internal-token"
];

function formatDate(value: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (typeof value !== "number") return "-";
  return `${value} ms`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    executed: "Executado",
    failed: "Falhou",
    generated: "Gerado",
    pending: "Pendente",
    blocked: "Bloqueado"
  };

  return labels[status] ?? (status || "-");
}

function statusClass(status: string) {
  if (status === "executed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "generated") return "border-blue-200 bg-blue-50 text-blue-800";
  if (status === "blocked") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function sanitizeDisplayJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDisplayJson(item));
  }

  if (value && typeof value === "object") {
    const sanitized: Record<string, JsonValue> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERNS.some((pattern) => key.toLowerCase().includes(pattern))) {
        continue;
      }

      sanitized[key] = sanitizeDisplayJson(nestedValue);
    }

    return sanitized;
  }

  return value;
}

function jsonArray(value: JsonValue): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function jsonObjectRows(value: JsonValue) {
  return jsonArray(value).filter(
    (item): item is Record<string, JsonValue> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function JsonBlock({ value }: { value: JsonValue }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
      {JSON.stringify(sanitizeDisplayJson(value), null, 2)}
    </pre>
  );
}

function CodeBlock({ value }: { value: string | null }) {
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
      {value || "Não informado."}
    </pre>
  );
}

async function readApiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: unknown };
    return typeof data.error === "string" && data.error ? data.error : fallback;
  } catch {
    return fallback;
  }
}

export default function AdminRunsPage() {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [loggedUser, setLoggedUser] = useState<AuthenticatedUser | null>(null);
  const [accountPolicy, setAccountPolicy] = useState<AccountPolicy | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({
    status: "todos",
    user_email: "",
    intent: "",
    limit: "50"
  });

  const summary = useMemo(
    () => ({
      total: runs.length,
      executed: runs.filter((run) => run.execution_status === "executed").length,
      failed: runs.filter((run) => run.execution_status === "failed").length,
      pendingOrGenerated: runs.filter((run) =>
        ["pending", "generated"].includes(run.execution_status)
      ).length
    }),
    [runs]
  );

  const intentOptions = useMemo(
    () =>
      Array.from(
        new Set(runs.map((run) => run.detected_intent).filter((value): value is string => Boolean(value)))
      ).sort(),
    [runs]
  );

  const showError = useCallback((text: string) => {
    setError(text);
    setMessage("");
  }, []);

  const showMessage = useCallback((text: string) => {
    setMessage(text);
    setError("");
  }, []);

  const loadRuns = useCallback(
    async (nextFilters = filters) => {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams();

        if (nextFilters.status !== "todos") params.set("status", nextFilters.status);
        if (nextFilters.user_email.trim()) params.set("user_email", nextFilters.user_email.trim());
        if (nextFilters.intent.trim()) params.set("intent", nextFilters.intent.trim());
        params.set("limit", nextFilters.limit);

        const response = await fetch(`/api/admin/runs?${params.toString()}`, {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "runs_load_failed"));
        }

        const data = (await response.json()) as { runs?: AgentRun[] };
        setRuns(data.runs ?? []);
      } catch (caughtError) {
        const reason = caughtError instanceof Error ? caughtError.message : "erro_desconhecido";
        showError(`Não foi possível carregar o histórico: ${reason}`);
      } finally {
        setLoading(false);
      }
    },
    [filters, showError]
  );

  const checkAccessAndLoad = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
      const sessionData = (await sessionResponse.json()) as {
        authenticated?: boolean;
        user?: AuthenticatedUser | null;
      };

      if (!sessionData.authenticated || !sessionData.user) {
        setAccessState("unauthenticated");
        setLoggedUser(null);
        return;
      }

      setLoggedUser(sessionData.user);

      const policyResponse = await fetch("/api/account/policy", { cache: "no-store" });
      const policyData = (await policyResponse.json()) as {
        success?: boolean;
        policy?: AccountPolicy;
        error?: string;
      };

      if (!policyResponse.ok || !policyData.success || !policyData.policy) {
        throw new Error(policyData.error || "policy_load_failed");
      }

      setAccountPolicy(policyData.policy);

      if (!policyData.policy.can_view_all_runs) {
        setAccessState("forbidden");
        return;
      }

      setAccessState("allowed");
      await loadRuns();
    } catch {
      showError("Não foi possível carregar a área de histórico.");
    } finally {
      setLoading(false);
    }
  }, [loadRuns, showError]);

  useEffect(() => {
    checkAccessAndLoad();
  }, [checkAccessAndLoad]);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadRuns(filters);
  }

  async function clearFilters() {
    const cleared = {
      status: "todos",
      user_email: "",
      intent: "",
      limit: "50"
    };

    setFilters(cleared);
    await loadRuns(cleared);
  }

  async function openDetails(runId: string) {
    setSelectedRun(null);
    setDetailLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/runs/${runId}`, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(await readApiError(response, "run_detail_failed"));
      }

      const data = (await response.json()) as { run?: AgentRun };
      setSelectedRun(data.run ?? null);
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : "erro_desconhecido";
      showError(`Não foi possível carregar os detalhes: ${reason}`);
    } finally {
      setDetailLoading(false);
    }
  }

  async function copyText(value: string | null, label: string) {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      showMessage(`${label} copiada.`);
    } catch {
      showError(`Não foi possível copiar ${label.toLowerCase()}.`);
    }
  }

  if (accessState === "checking" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <div className="rounded-md border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-steel shadow-soft">
          Carregando histórico...
        </div>
      </main>
    );
  }

  if (accessState === "unauthenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <section className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 shadow-soft">
          <ShieldAlert className="h-8 w-8 text-amber-600" aria-hidden="true" />
          <h1 className="mt-3 text-2xl font-semibold text-ink">Acesso negado</h1>
          <p className="mt-2 text-sm text-steel">
            Faça login na interface do agente financeiro para acessar esta área.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-lake px-4 text-sm font-semibold text-white hover:bg-teal-800"
          >
            Voltar ao login
          </Link>
        </section>
      </main>
    );
  }

  if (accessState === "forbidden") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <section className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 shadow-soft">
          <Lock className="h-8 w-8 text-rose-600" aria-hidden="true" />
          <h1 className="mt-3 text-2xl font-semibold text-ink">Acesso restrito</h1>
          <p className="mt-2 text-sm text-steel">
            Acesso restrito a usuários com permissão de auditoria.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-ink hover:bg-slate-50"
          >
            Voltar ao Agente
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-3 text-sm font-semibold text-lake">
              <Database className="h-5 w-5" aria-hidden="true" />
              Auditoria
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink">
              Histórico de execuções
            </h1>
            <p className="mt-2 text-sm text-steel">
              Audite perguntas, SQLs geradas, execuções e erros do agente financeiro.
            </p>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            {loggedUser ? (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-steel shadow-sm lg:text-right">
                <p className="font-semibold text-ink">{loggedUser.name}</p>
                <p>{loggedUser.email}</p>
                <p className="font-medium text-lake">{loggedUser.profile}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Link
                href="/"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Voltar ao Agente
              </Link>
              {accountPolicy?.can_manage_users ? (
                <Link
                  href="/admin/users"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-800 shadow-sm transition hover:border-blue-300 hover:bg-blue-100"
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Usuários
                </Link>
              ) : null}
              {accountPolicy?.can_manage_users ? (
                <Link
                  href="/admin/profile-policies"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Políticas
                </Link>
              ) : null}
            </div>
          </div>
        </header>

        {message ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-4">
          <SummaryCard label="Total de execuções" value={summary.total} tone="neutral" />
          <SummaryCard label="Executadas com sucesso" value={summary.executed} tone="success" />
          <SummaryCard label="Falhas" value={summary.failed} tone="error" />
          <SummaryCard label="Pendentes/Geradas" value={summary.pendingOrGenerated} tone="info" />
        </section>

        <form
          onSubmit={applyFilters}
          className="grid gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-soft lg:grid-cols-[160px_1fr_1fr_140px_auto_auto]"
        >
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-steel">Status</span>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status === "todos" ? "todos" : status}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-steel">
              Usuário/e-mail
            </span>
            <input
              type="text"
              value={filters.user_email}
              onChange={(event) => setFilters((current) => ({ ...current, user_email: event.target.value }))}
              className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-steel">Intenção</span>
            <input
              type="text"
              list="intent-options"
              value={filters.intent}
              onChange={(event) => setFilters((current) => ({ ...current, intent: event.target.value }))}
              className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm"
            />
            <datalist id="intent-options">
              {intentOptions.map((intent) => (
                <option key={intent} value={intent} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-steel">Limite</span>
            <select
              value={filters.limit}
              onChange={(event) => setFilters((current) => ({ ...current, limit: event.target.value }))}
              className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm"
            >
              {LIMIT_OPTIONS.map((limit) => (
                <option key={limit} value={limit}>
                  {limit}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md bg-lake px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-10 items-center justify-center self-end rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:bg-slate-50"
          >
            Limpar filtros
          </button>
        </form>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-steel">
                <tr>
                  <th className="px-4 py-3">Data/hora</th>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Perfil</th>
                  <th className="px-4 py-3">Pergunta</th>
                  <th className="px-4 py-3">Intenção</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Linhas</th>
                  <th className="px-4 py-3">Tempo</th>
                  <th className="px-4 py-3">Erro</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-sm font-medium text-steel">
                      Nenhuma execução encontrada.
                    </td>
                  </tr>
                ) : (
                  runs.map((run) => (
                    <tr key={run.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3 text-steel">{formatDate(run.created_at)}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink">{run.user_name ?? "-"}</p>
                        <p className="text-xs text-steel">{run.user_email ?? "-"}</p>
                      </td>
                      <td className="px-4 py-3 text-steel">{run.user_profile ?? "-"}</td>
                      <td className="max-w-xs px-4 py-3 text-steel" title={run.pergunta}>
                        <span className="line-clamp-2">{run.pergunta}</span>
                      </td>
                      <td className="px-4 py-3 text-steel">{run.detected_intent ?? "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(run.execution_status)}`}>
                          {statusLabel(run.execution_status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-steel">{run.row_count ?? "-"}</td>
                      <td className="px-4 py-3 text-steel">
                        {formatDuration(run.execution_time_ms ?? run.total_time_ms)}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-rose-700" title={run.execution_error ?? ""}>
                        <span className="line-clamp-2">{run.execution_error ?? "-"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDetails(run.id)}
                          className="admin-action-button"
                        >
                          Detalhes
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {(selectedRun || detailLoading) ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-8">
            <section className="w-full max-w-5xl rounded-md border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-ink">Detalhes da execução</h2>
                <button
                  type="button"
                  onClick={() => setSelectedRun(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-steel hover:bg-slate-50"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="max-h-[80vh] overflow-y-auto p-5">
                {detailLoading ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-steel">
                    Carregando detalhes...
                  </div>
                ) : selectedRun ? (
                  <RunDetails run={selectedRun} onCopy={copyText} />
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "error" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-900"
        : tone === "info"
          ? "border-blue-200 bg-blue-50 text-blue-900"
          : "border-slate-200 bg-white text-ink";

  return (
    <article className={`rounded-md border p-4 shadow-soft ${toneClass}`}>
      <p className="text-xs font-bold uppercase tracking-wide opacity-75">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </article>
  );
}

function RunDetails({ run, onCopy }: { run: AgentRun; onCopy: (value: string | null, label: string) => void }) {
  const rows = jsonObjectRows(run.data_preview);
  const columns = jsonArray(run.columns).map(String);
  const hideSql = run.sql_hidden || run.can_view_sql === false;

  return (
    <div className="space-y-5">
      <DetailSection title="Informações gerais">
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <DetailItem label="ID" value={run.id} />
          <DetailItem label="request_id" value={run.request_id ?? "-"} />
          <DetailItem label="run_id" value={run.run_id ?? "-"} />
          <DetailItem label="Data criação" value={formatDate(run.created_at)} />
          <DetailItem label="Última atualização" value={formatDate(run.updated_at)} />
          <DetailItem label="Usuário" value={run.user_name ?? "-"} />
          <DetailItem label="E-mail" value={run.user_email ?? "-"} />
          <DetailItem label="Perfil" value={run.user_profile ?? "-"} />
          <DetailItem label="Status" value={statusLabel(run.execution_status)} />
          <DetailItem label="Intenção" value={run.detected_intent ?? "-"} />
          <DetailItem label="Tempo de execução" value={formatDuration(run.execution_time_ms)} />
          <DetailItem label="Linhas retornadas" value={String(run.row_count ?? "-")} />
        </div>
      </DetailSection>

      <DetailSection title="Pergunta">
        <p className="text-sm font-semibold text-ink">{run.pergunta}</p>
        <p className="mt-2 text-xs text-steel">{run.pergunta_normalizada ?? "-"}</p>
      </DetailSection>

      {hideSql ? (
        <DetailSection title="SQL">
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-sm font-semibold text-blue-900">
            A SQL desta execução não é exibida para o seu perfil.
          </div>
        </DetailSection>
      ) : (
        <>
          <SqlSection title="SQL gerada" value={run.sql_generated} onCopy={() => onCopy(run.sql_generated, "SQL gerada")} />
          <SqlSection title="SQL executada" value={run.sql_executed} onCopy={() => onCopy(run.sql_executed, "SQL executada")} />
        </>
      )}

      <DetailSection title="Resultado">
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-steel">
                <tr>
                  {(columns.length ? columns : Object.keys(rows[0])).map((column) => (
                    <th key={column} className="px-3 py-2">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, index) => (
                  <tr key={index}>
                    {(columns.length ? columns : Object.keys(row)).map((column) => (
                      <td key={column} className="px-3 py-2 text-steel">
                        {String(row[column] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-steel">Sem dados de preview.</p>
        )}
      </DetailSection>

      {run.execution_error ? (
        <DetailSection title="Erro">
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
            {run.execution_error}
          </p>
        </DetailSection>
      ) : null}

      <DetailSection title="Validação">
        <DetailItem label="validation_status" value={run.validation_status ?? "-"} />
        <div className="mt-3 grid gap-3">
          <div>
            <p className="mb-1 text-sm font-semibold text-ink">validation_errors</p>
            <JsonBlock value={run.validation_errors} />
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold text-ink">validation_warnings</p>
            <JsonBlock value={run.validation_warnings} />
          </div>
        </div>
      </DetailSection>

      <DetailSection title="Metadados">
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <DetailItem label="executor_mode" value={run.executor_mode ?? "-"} />
          <DetailItem label="executor_version" value={run.executor_version ?? "-"} />
          <DetailItem label="n8n_status_code" value={String(run.n8n_status_code ?? "-")} />
          <DetailItem label="watson_status_code" value={String(run.watson_status_code ?? "-")} />
        </div>
        <div className="mt-3">
          <p className="mb-1 text-sm font-semibold text-ink">metadata</p>
          <JsonBlock value={run.metadata} />
        </div>
      </DetailSection>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 p-4">
      <h3 className="mb-3 text-base font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs font-bold uppercase tracking-wide text-steel">{label}</p>
      <p className="mt-1 break-words font-semibold text-ink">{value}</p>
    </div>
  );
}

function SqlSection({ title, value, onCopy }: { title: string; value: string | null; onCopy: () => void }) {
  return (
    <DetailSection title={title}>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={onCopy} disabled={!value} className="admin-action-button">
          <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
          Copiar {title.toLowerCase()}
        </button>
      </div>
      <CodeBlock value={value} />
    </DetailSection>
  );
}
