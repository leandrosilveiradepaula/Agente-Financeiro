"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  Eraser,
  FileCode2,
  LogOut,
  LockKeyhole,
  Settings,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { AccordionSection } from "@/components/AccordionSection";
import { AgentDiagnosticsPanel } from "@/components/AgentDiagnosticsPanel";
import { BenchmarkHomologationPanel } from "@/components/BenchmarkHomologationPanel";
import { ErrorMessage } from "@/components/ErrorMessage";
import { ExampleQuestions } from "@/components/ExampleQuestions";
import { ExecutiveReportHistoryPanel } from "@/components/ExecutiveReportHistoryPanel";
import { ExecutiveSummary } from "@/components/ExecutiveSummary";
import { ExecutiveReportActions } from "@/components/ExecutiveReportActions";
import { InterfaceSettingsPanel } from "@/components/InterfaceSettingsPanel";
import { LoadingState } from "@/components/LoadingState";
import { ManualWatsonResultInput } from "@/components/ManualWatsonResultInput";
import { QueryHistoryPanel } from "@/components/QueryHistoryPanel";
import { QuestionInput } from "@/components/QuestionInput";
import { ResultModeTabs, type ResultMode } from "@/components/ResultModeTabs";
import { ResultTable } from "@/components/ResultTable";
import { SqlEditor } from "@/components/SqlEditor";
import { StatusCards } from "@/components/StatusCards";
import { WhatsAppOperationalSummary } from "@/components/WhatsAppOperationalSummary";
import { WhatsAppDemoPanel } from "@/components/WhatsAppDemoPanel";
import {
  clearExecutiveReportHistory,
  readExecutiveReportHistory,
  removeExecutiveReportHistory,
  upsertExecutiveReportHistory
} from "@/lib/executive-report-history";
import { buildExecutiveReportMarkdown } from "@/lib/executive-report-markdown";
import {
  getDefaultInterfaceSettings,
  readInterfaceSettings,
  resetInterfaceSettings,
  writeInterfaceSettings,
  type InterfaceSettings
} from "@/lib/interface-settings";
import { readQueryHistory, upsertQueryHistory, writeQueryHistory } from "@/lib/history";
import { normalizeWatsonResult } from "@/lib/watson-result-normalization";
import {
  AGENT_VERSION,
  type ExecuteWatsonResponse,
  type ExecutiveReportHistoryItem,
  type ExecutiveSummaryResult,
  type GenerateSqlResponse,
  type QueryHistoryItem
} from "@/lib/types";

type GenerationState = {
  response: GenerateSqlResponse | null;
  isLoading: boolean;
  error: string;
};

type ExecutionState = {
  response: ExecuteWatsonResponse | null;
  isLoading: boolean;
  error: string;
  message: string;
  source: "automatico" | "manual" | null;
};

type AuthState = "checking" | "locked" | "unlocked";

type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  profile: string;
};

const INTERFACE_VERSION = "interface-v2.2.12";
const INTERFACE_BASELINE = "v2.2.12 — Proteção de acesso à interface e APIs internas";

function statusTone(value: string): "neutral" | "success" | "warning" | "error" {
  const normalized = value.toLowerCase();

  if (normalized.includes("aprov") || normalized === "true" || normalized.includes("sucesso")) {
    return "success";
  }

  if (normalized.includes("erro") || normalized.includes("reprov") || normalized === "false") {
    return "error";
  }

  if (normalized.includes("pendente") || normalized.includes("aguard")) {
    return "warning";
  }

  return "neutral";
}

function statusBadge(value: string) {
  const normalized = value.toLowerCase();

  if (normalized.includes("aprov")) {
    return "aprovado";
  }

  if (normalized.includes("reprov")) {
    return "reprovado";
  }

  if (normalized.includes("erro")) {
    return "erro";
  }

  return value || "pendente";
}

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(null);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [sql, setSql] = useState("");
  const [historyItems, setHistoryItems] = useState<QueryHistoryItem[]>([]);
  const [executiveReportHistory, setExecutiveReportHistory] = useState<
    ExecutiveReportHistoryItem[]
  >([]);
  const [interfaceSettings, setInterfaceSettings] = useState<InterfaceSettings>(
    getDefaultInterfaceSettings()
  );
  const [generation, setGeneration] = useState<GenerationState>({
    response: null,
    isLoading: false,
    error: ""
  });
  const [execution, setExecution] = useState<ExecutionState>({
    response: null,
    isLoading: false,
    error: "",
    message: "",
    source: null
  });
  const [resultMode, setResultMode] = useState<ResultMode>("auto");
  const [manualWatsonJson, setManualWatsonJson] = useState("");
  const [executiveSummary, setExecutiveSummary] = useState<ExecutiveSummaryResult | null>(null);
  const [useSqlCache, setUseSqlCache] = useState(false);

  const canPrepareGeneration = question.trim().length > 0;
  const canExecuteWatson = !generation.isLoading && !execution.isLoading;
  const detectedIntent = generation.response?.detected_intent || "";
  const hasDetectedIntent = Boolean(detectedIntent && detectedIntent !== "nao_informado");
  const resultMetadata = useMemo(
    () => ({
      agent_version: generation.response?.agent_version,
      validation_status: generation.response?.validation_status,
      query_id: execution.response?.query_id,
      execution_time_ms: execution.response?.execution_time_ms,
      row_count: execution.response?.row_count,
      success: execution.response?.success,
      detected_intent: generation.response?.detected_intent
    }),
    [
      execution.response?.execution_time_ms,
      execution.response?.query_id,
      execution.response?.row_count,
      execution.response?.success,
      generation.response?.agent_version,
      generation.response?.detected_intent,
      generation.response?.validation_status
    ]
  );

  useEffect(() => {
    setHistoryItems(readQueryHistory());
    setExecutiveReportHistory(readExecutiveReportHistory());
    const settings = readInterfaceSettings();
    setInterfaceSettings(settings);
    setResultMode(settings.defaultResultMode);
    setUseSqlCache(settings.useSqlCache);
  }, []);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store"
        });
        const data = (await response.json()) as {
          authenticated?: boolean;
          user?: AuthenticatedUser | null;
        };

        if (active) {
          setAuthState(data.authenticated ? "unlocked" : "locked");
          setAuthenticatedUser(data.authenticated ? data.user ?? null : null);
        }
      } catch {
        if (active) {
          setAuthState("locked");
          setAuthenticatedUser(null);
        }
      }
    }

    checkSession();

    return () => {
      active = false;
    };
  }, []);

  function saveHistoryItem(item: QueryHistoryItem) {
    setHistoryItems((currentItems) => {
      const nextItems = upsertQueryHistory(currentItems, item);
      writeQueryHistory(nextItems);
      return nextItems;
    });
  }

  const markExecutiveSummaryGenerated = useCallback((summary: ExecutiveSummaryResult) => {
    setExecutiveSummary(summary);

    if (!question.trim() || !sql.trim()) {
      return;
    }

    setHistoryItems((currentItems) => {
      let changed = false;
      const generatedAt = new Date().toISOString();
      const nextItems = currentItems.map((item) => {
        const isCurrent =
          item.pergunta.trim().toLowerCase() === question.trim().toLowerCase() &&
          item.sql.trim() === sql.trim();

        if (!isCurrent || item.hasExecutiveSummary) {
          return item;
        }

        changed = true;
        return {
          ...item,
          hasExecutiveSummary: true,
          executiveSummaryGeneratedAt: generatedAt
        };
      });

      if (changed) {
        writeQueryHistory(nextItems);
      }

      return nextItems;
    });

    if (
      !execution.response?.success ||
      !execution.response.data.length ||
      !execution.response.columns.length
    ) {
      return;
    }

    const markdown =
      execution.response.relatorio_executivo_markdown?.trim() ||
      buildExecutiveReportMarkdown({
        question,
        sql,
        metadata: resultMetadata,
        executiveSummary: summary,
        includeSql: interfaceSettings.markdownIncludeSql
      });

    if (!markdown.trim()) {
      return;
    }

    setExecutiveReportHistory((currentItems) =>
      upsertExecutiveReportHistory(currentItems, {
        id: crypto.randomUUID(),
        question: question.trim(),
        sql,
        markdown,
        summary,
        query_id: execution.response?.query_id || undefined,
        detected_intent: generation.response?.detected_intent || summary.intent,
        validation_status: generation.response?.validation_status,
        row_count: execution.response?.row_count,
        execution_time_ms: execution.response?.execution_time_ms,
        generated_at: new Date().toISOString()
      })
    );
  }, [execution.response, generation.response?.detected_intent, generation.response?.validation_status, interfaceSettings.markdownIncludeSql, question, resultMetadata, sql]);

  const markPdfExported = useCallback(() => {
    if (!question.trim() || !sql.trim()) {
      return;
    }

    setHistoryItems((currentItems) => {
      let changed = false;
      const exportedAt = new Date().toISOString();
      const nextItems = currentItems.map((item) => {
        const isCurrent =
          item.pergunta.trim().toLowerCase() === question.trim().toLowerCase() &&
          item.sql.trim() === sql.trim();

        if (!isCurrent) {
          return item;
        }

        changed = true;
        return {
          ...item,
          pdfExported: true,
          pdfExportedAt: exportedAt
        };
      });

      if (changed) {
        writeQueryHistory(nextItems);
      }

      return nextItems;
    });
  }, [question, sql]);

  function buildHistoryItem({
    pergunta,
    generatedSql,
    generateResponse,
    executeResponse,
    resultSource
  }: {
    pergunta: string;
    generatedSql: string;
    generateResponse: GenerateSqlResponse;
    executeResponse?: ExecuteWatsonResponse;
    resultSource?: "automatico" | "manual";
  }): QueryHistoryItem {
    return {
      id: crypto.randomUUID(),
      pergunta,
      sql: generatedSql,
      agent_version: generateResponse.agent_version,
      detected_intent: generateResponse.detected_intent,
      validation_status: generateResponse.validation_status,
      created_at: new Date().toISOString(),
      executed_watson: Boolean(executeResponse?.success),
      result_source: executeResponse?.success ? resultSource ?? "automatico" : undefined,
      query_id: executeResponse?.query_id || undefined,
      cache_enabled: generateResponse.cache?.enabled,
      cache_hit: generateResponse.cache?.hit,
      cache_source: generateResponse.cache?.source,
      cache_status: generateResponse.cache?.status
    };
  }

  function loadHistoryItem(item: QueryHistoryItem) {
    setQuestion(item.pergunta);
    setSql(item.sql);
    setGeneration({
      response: {
        success: true,
        agent_version: item.agent_version,
        detected_intent: item.detected_intent,
        validation_status: item.validation_status,
        sql: item.sql,
        raw: null,
        cache:
          item.cache_enabled !== undefined
            ? {
                enabled: item.cache_enabled,
                hit: Boolean(item.cache_hit),
                source: item.cache_source || (item.cache_enabled ? "unknown" : "disabled_by_user"),
                status: item.cache_status
              }
            : undefined
      },
      isLoading: false,
      error: ""
    });
    setExecution({
      response: item.executed_watson
        ? {
            success: true,
            query_id: item.query_id || "",
            execution_time_ms: null,
            row_count: 0,
            columns: [],
            data: [],
            raw: null
          }
        : null,
      isLoading: false,
      error: "",
      message: "",
      source: item.result_source ?? (item.executed_watson ? "automatico" : null)
    });
  }

  function removeHistoryItem(id: string) {
    setHistoryItems((currentItems) => {
      const nextItems = currentItems.filter((item) => item.id !== id);
      writeQueryHistory(nextItems);
      return nextItems;
    });
  }

  function clearHistory() {
    if (!window.confirm("Tem certeza que deseja limpar o histórico local?")) {
      return;
    }

    setHistoryItems([]);
    writeQueryHistory([]);
  }

  function removeExecutiveReportHistoryItem(id: string) {
    setExecutiveReportHistory(removeExecutiveReportHistory(id));
  }

  function clearExecutiveReports() {
    setExecutiveReportHistory(clearExecutiveReportHistory());
  }

  function clearLocalErrors() {
    setGeneration((current) => ({
      ...current,
      error: ""
    }));
    setExecution((current) => ({
      ...current,
      error: "",
      message: ""
    }));
  }

  function saveInterfaceSettings(settings: InterfaceSettings) {
    const savedSettings = writeInterfaceSettings(settings);
    setInterfaceSettings(savedSettings);
    setResultMode(savedSettings.defaultResultMode);
    setUseSqlCache(savedSettings.useSqlCache);
  }

  function restoreInterfaceSettings() {
    const defaultSettings = resetInterfaceSettings();
    setInterfaceSettings(defaultSettings);
    setResultMode(defaultSettings.defaultResultMode);
    setUseSqlCache(defaultSettings.useSqlCache);
  }

  function updateUseSqlCache(value: boolean) {
    setUseSqlCache(value);
    setInterfaceSettings((current) => writeInterfaceSettings({ ...current, useSqlCache: value }));
  }

  function clearWorkspace() {
    setQuestion("");
    setSql("");
    setGeneration({
      response: null,
      isLoading: false,
      error: ""
    });
    setExecution({
      response: null,
      isLoading: false,
      error: "",
      message: "",
      source: null
    });
    setManualWatsonJson("");
    setExecutiveSummary(null);
  }

  async function unlockInterface(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim() || !password || authLoading) {
      return;
    }

    setAuthLoading(true);
    setAuthError("");

    try {
      const response = await fetch("/api/auth/access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email.trim(),
          password
        })
      });

      const data = (await response.json()) as {
        success?: boolean;
        user?: AuthenticatedUser | null;
      };

      if (!response.ok || !data.success) {
        setAuthError(response.status === 401 ? "E-mail ou senha inválidos." : "Não foi possível entrar agora.");
        setAuthState("locked");
        return;
      }

      setPassword("");
      setAuthenticatedUser(data.user ?? null);
      setAuthState("unlocked");
    } catch {
      setAuthError("Não foi possível entrar agora.");
      setAuthState("locked");
    } finally {
      setAuthLoading(false);
    }
  }

  async function lockInterface() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST"
      });
    } finally {
      setAuthState("locked");
      setPassword("");
      setAuthenticatedUser(null);
      setAuthError("");
      clearWorkspace();
    }
  }

  async function generateSql() {
    const pergunta = question.trim();

    if (!pergunta || generation.isLoading) {
      return;
    }

    setGeneration((current) => ({
      ...current,
      isLoading: true,
      error: ""
    }));

    try {
      const response = await fetch("/api/generate-sql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          pergunta,
          options: {
            use_sql_cache: useSqlCache
          }
        })
      });

      const data = (await response.json()) as GenerateSqlResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Nao foi possivel gerar a SQL.");
      }

      setSql(data.sql);
      setExecution({
        response: null,
        isLoading: false,
        error: "",
        message: "",
        source: null
      });
      setExecutiveSummary(null);
      setGeneration({
        response: data,
        isLoading: false,
        error: ""
      });
      saveHistoryItem(
        buildHistoryItem({
          pergunta,
          generatedSql: data.sql,
          generateResponse: data
        })
      );
    } catch (error) {
      setGeneration((current) => ({
        ...current,
        isLoading: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro inesperado ao gerar SQL."
      }));
    }
  }

  async function executeWatson() {
    if (!canExecuteWatson) {
      return;
    }

    const generatedSql = sql.trim();

    if (!generatedSql) {
      setExecution({
        response: null,
        isLoading: false,
        error: "Gere uma SQL antes de executar no Watson.",
        message: "",
        source: "automatico"
      });
      return;
    }

    setExecution({
      response: null,
      isLoading: true,
      error: "",
      message: "",
      source: "automatico"
    });
    setExecutiveSummary(null);

    try {
      const response = await fetch("/api/execute-watson", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          pergunta: question.trim(),
          sql: generatedSql
        })
      });

      const data = (await response.json()) as ExecuteWatsonResponse;

      if (!response.ok) {
        throw new Error(data.error_message || data.error || "Erro ao executar no Watson.");
      }

      if (!data.success) {
        setExecution({
          response: data,
          isLoading: false,
          error: data.error_message || data.error || "Watson retornou erro ao executar a SQL.",
          message: "",
          source: "automatico"
        });
        return;
      }

      setExecution({
        response: data,
        isLoading: false,
        error: "",
        message: "Resultado carregado.",
        source: "automatico"
      });
      saveHistoryItem(
        buildHistoryItem({
          pergunta: question.trim(),
          generatedSql,
          generateResponse:
            generation.response ?? {
              success: true,
              agent_version: AGENT_VERSION,
              detected_intent: "nao_informado",
              validation_status: "nao_informado",
              sql: generatedSql,
              raw: null
            },
          executeResponse: data,
          resultSource: "automatico"
        })
      );
    } catch (error) {
      setExecution({
        response: null,
        isLoading: false,
        error: "Execução automática ainda não configurada. Use o modo manual para colar o retorno do Watson.",
        message: "",
        source: "automatico"
      });
    }
  }

  function loadManualWatsonResult() {
    let raw: unknown;

    try {
      raw = JSON.parse(manualWatsonJson);
    } catch {
      setExecution({
        response: null,
        isLoading: false,
        error: "JSON inválido. Verifique o conteúdo colado.",
        message: "",
        source: "manual"
      });
      setExecutiveSummary(null);
      return;
    }

    const normalized = normalizeWatsonResult(raw);

    if (!normalized.data.length) {
      setExecution({
        response: null,
        isLoading: false,
        error: "Nenhum dado encontrado no retorno.",
        message: "",
        source: "manual"
      });
      setExecutiveSummary(null);
      return;
    }

    if (!normalized.columns.length) {
      setExecution({
        response: null,
        isLoading: false,
        error: "Formato inesperado no retorno do Watson.",
        message: "",
        source: "manual"
      });
      setExecutiveSummary(null);
      return;
    }

    setExecution({
      response: normalized,
      isLoading: false,
      error: "",
      message: normalized.inferred_columns
        ? "Resultado carregado com sucesso. Colunas inferidas automaticamente a partir dos dados."
        : "Resultado carregado com sucesso.",
      source: "manual"
    });

    if (generation.response) {
      saveHistoryItem(
        buildHistoryItem({
          pergunta: question.trim(),
          generatedSql: sql,
          generateResponse: generation.response,
          executeResponse: normalized,
          resultSource: "manual"
        })
      );
    }
  }

  function clearManualJson() {
    setManualWatsonJson("");
    setExecution((current) => ({
      ...current,
      error: current.source === "manual" ? "" : current.error,
      message: current.source === "manual" ? "" : current.message
    }));
  }

  const statusItems = [
    {
      label: "Status",
      value: generation.error
        ? "Erro ao gerar SQL"
        : generation.response?.success
          ? "SQL gerada com sucesso"
          : "Aguardando pergunta",
      icon: generation.error ? XCircle : generation.response?.success ? CheckCircle2 : Clock3,
      tone: generation.error ? "error" : generation.response?.success ? "success" : "neutral",
      badge: generation.error ? "erro" : generation.response?.success ? "sucesso" : "pendente"
    },
    {
      label: "Intenção",
      value: hasDetectedIntent ? detectedIntent : "Não detectada",
      icon: BarChart3,
      tone: hasDetectedIntent ? "success" : "neutral"
    },
    {
      label: "Validação",
      value: generation.error
        ? "Erro"
        : generation.response?.validation_status === "aprovado"
          ? "Validação aprovada"
          : generation.response?.validation_status || "Pendente",
      icon: generation.error ? XCircle : ShieldCheck,
      tone: generation.error
        ? "error"
        : statusTone(generation.response?.validation_status || "Pendente"),
      badge: generation.error
        ? "erro"
        : statusBadge(generation.response?.validation_status || "pendente")
    },
    {
      label: "Versão",
      value: generation.response?.agent_version || AGENT_VERSION,
      icon: ShieldCheck,
      tone: "neutral"
    },
    {
      label: "Execução",
      value: execution.response?.success
        ? execution.source === "manual"
          ? "Resultado carregado manualmente"
          : `${execution.response.row_count} linhas`
        : execution.error
          ? "Execução automática não configurada"
          : "Não iniciada",
      icon: execution.error ? XCircle : execution.response?.success ? CheckCircle2 : Clock3,
      tone: execution.error ? "error" : execution.response?.success ? "success" : "neutral",
      badge: execution.error ? "erro" : execution.source === "manual" ? "manual" : execution.response?.success ? "sucesso" : "pendente"
    }
  ] as const;

  if (authState !== "unlocked") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-8 text-ink">
        <section className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 shadow-soft">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-emerald-50 text-lake">
              <LockKeyhole className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-lake">Acesso restrito</p>
              <h1 className="text-xl font-semibold text-ink">Agente SQL Financeiro DuckLake</h1>
            </div>
          </div>

          <p className="mb-4 text-sm leading-6 text-steel">
            Acesso restrito. Informe suas credenciais para continuar.
          </p>

          <form onSubmit={unlockInterface} className="space-y-3">
            <label className="block">
              <span className="text-sm font-semibold text-ink">E-mail</span>
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setAuthError("");
                }}
                disabled={authLoading || authState === "checking"}
                className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none disabled:bg-slate-100"
                autoComplete="email"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-ink">Senha</span>
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setAuthError("");
                }}
                disabled={authLoading || authState === "checking"}
                className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none disabled:bg-slate-100"
                autoComplete="current-password"
              />
            </label>

            {authError ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
                {authError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!email.trim() || !password || authLoading || authState === "checking"}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-lake px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
            >
              {authState === "checking" ? "Verificando..." : authLoading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-3 text-sm font-semibold text-lake">
              <Database className="h-5 w-5" aria-hidden="true" />
              DuckLake Financeiro
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink sm:text-4xl">
              Agente SQL Financeiro DuckLake
            </h1>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="inline-flex w-fit items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-ledger shadow-sm">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {AGENT_VERSION}
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                interface-v1.0-demo
              </span>
              <span className="inline-flex rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                Execução Watson: manual
              </span>
            </div>
            {authenticatedUser ? (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-steel shadow-sm sm:text-right">
                <p className="font-semibold text-ink">{authenticatedUser.name}</p>
                <p>{authenticatedUser.email}</p>
                <p className="font-medium text-lake">{authenticatedUser.profile}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {authenticatedUser?.profile === "admin" ? (
                <Link
                  href="/admin/users"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-800 shadow-sm transition hover:border-blue-300 hover:bg-blue-100"
                >
                  <Settings className="h-4 w-4" aria-hidden="true" />
                  Administração
                </Link>
              ) : null}
              <button
                type="button"
                onClick={clearWorkspace}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
              >
                <Eraser className="h-4 w-4" aria-hidden="true" />
                Limpar
              </button>
              <button
                type="button"
                onClick={lockInterface}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sair
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <QuestionInput
              canSubmit={canPrepareGeneration}
              isLoading={generation.isLoading}
              question={question}
              useSqlCache={useSqlCache}
              onQuestionChange={setQuestion}
              onUseSqlCacheChange={updateUseSqlCache}
              onSubmit={generateSql}
            />
            <ExampleQuestions onSelectQuestion={setQuestion} />
            <QueryHistoryPanel
              items={historyItems}
              onSelectItem={loadHistoryItem}
              onRemoveItem={removeHistoryItem}
              onClearHistory={clearHistory}
            />
            {interfaceSettings.showExecutiveReportHistory ? (
              <ExecutiveReportHistoryPanel
                items={executiveReportHistory}
                onRemoveItem={removeExecutiveReportHistoryItem}
                onClearHistory={clearExecutiveReports}
              />
            ) : null}
            <section className="space-y-3">
              <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-soft">
                <h2 className="text-base font-semibold text-ink">Ferramentas operacionais</h2>
                <p className="mt-1 text-xs font-medium text-steel">
                  Painéis auxiliares recolhidos para manter a tela principal limpa.
                </p>
              </div>

              <AccordionSection
                title="Demonstração WhatsApp"
                summary={<WhatsAppOperationalSummary />}
              >
                <WhatsAppDemoPanel />
              </AccordionSection>

              <AccordionSection
                title="Configurações da interface"
                summary="Preferências locais da interface"
              >
                <InterfaceSettingsPanel
                  settings={interfaceSettings}
                  onSaveSettings={saveInterfaceSettings}
                  onResetSettings={restoreInterfaceSettings}
                />
              </AccordionSection>

              <AccordionSection
                title="Diagnóstico do agente"
                summary={
                  execution.response
                    ? execution.response.success
                      ? `Execução OK • ${execution.response.row_count} linhas`
                      : "Execução com erro"
                    : "Sem execução atual"
                }
              >
                <AgentDiagnosticsPanel
                  interfaceVersion={INTERFACE_VERSION}
                  baseline={INTERFACE_BASELINE}
                  agentVersion={AGENT_VERSION}
                  generation={generation}
                  execution={execution}
                  metadata={resultMetadata}
                  queryHistoryCount={historyItems.length}
                  executiveReportHistoryCount={executiveReportHistory.length}
                  lastExecutiveReport={executiveReportHistory[0] ?? null}
                  executiveSummary={executiveSummary}
                  onClearLocalErrors={clearLocalErrors}
                />
              </AccordionSection>

              <AccordionSection title="Benchmark e homologação" summary="5 casos homologados">
                <BenchmarkHomologationPanel baseline={INTERFACE_BASELINE} />
              </AccordionSection>
            </section>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <StatusCards items={statusItems} />

            {generation.isLoading ? (
              <LoadingState message="Gerando SQL via Watson Orchestration..." />
            ) : null}
            {execution.isLoading ? <LoadingState message="Executando no Watson..." /> : null}
            {generation.error ? <ErrorMessage message={generation.error} /> : null}
            {execution.error ? <ErrorMessage message={execution.error} /> : null}
            {generation.response?.success && !generation.error ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                SQL gerada com sucesso.
              </div>
            ) : null}
            {execution.message ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                {execution.message}
              </div>
            ) : null}

            <SqlEditor sql={sql} onSqlChange={setSql} cache={generation.response?.cache} />

            <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
              <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-5 w-5 text-lake" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-ink">Resultado</h2>
                </div>
                <ResultModeTabs mode={resultMode} onModeChange={setResultMode} />
              </div>

              {resultMode === "auto" ? (
                <div className="mb-4 flex justify-end">
                  <button
                    type="button"
                    disabled={!canExecuteWatson}
                    onClick={executeWatson}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-lake px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    <Database className="h-4 w-4" aria-hidden="true" />
                    {execution.isLoading ? "Executando..." : "Executar no Watson"}
                  </button>
                </div>
              ) : (
                <div className="mb-4">
                  <ManualWatsonResultInput
                    value={manualWatsonJson}
                    onValueChange={setManualWatsonJson}
                    onLoadResult={loadManualWatsonResult}
                    onClearJson={clearManualJson}
                  />
                </div>
              )}

              {execution.response ? (
                <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Query ID</p>
                    <p className="mt-1 truncate text-sm font-semibold text-ink">
                      {execution.response.query_id || "Não informado"}
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Tempo</p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {execution.response.execution_time_ms === null
                        ? "Não informado"
                        : `${execution.response.execution_time_ms} ms`}
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Linhas</p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {execution.response.row_count}
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Status</p>
                    <p
                      className={`mt-1 text-sm font-semibold ${
                        execution.response.success ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {execution.response.success ? "success" : "erro"}
                    </p>
                  </div>
                </div>
              ) : null}

              {execution.response?.data.length ? (
                <ExecutiveSummary
                  question={question}
                  columns={execution.response.columns}
                  data={execution.response.data}
                  metadata={resultMetadata}
                  backendSummary={
                    execution.response.relatorio_executivo ??
                    execution.response.executive_summary ??
                    null
                  }
                  onSummaryGenerated={markExecutiveSummaryGenerated}
                />
              ) : null}

              {!execution.response?.data.length ? (
                <div className="mb-4 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-steel">
                  O resumo executivo será gerado após o carregamento do resultado.
                </div>
              ) : null}

              {execution.response?.data.length && executiveSummary ? (
                <ExecutiveReportActions
                  question={question}
                  sql={sql}
                  columns={execution.response.columns}
                  data={execution.response.data}
                  metadata={resultMetadata}
                  executiveSummary={executiveSummary}
                  backendMarkdown={execution.response.relatorio_executivo_markdown ?? null}
                  settings={interfaceSettings}
                  onPdfExported={markPdfExported}
                />
              ) : null}

              <ResultTable
                columns={execution.response?.columns ?? []}
                data={execution.response?.data ?? []}
              />
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
