"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  UserCircle,
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
import { LlmUsageSummary } from "@/components/LlmUsageSummary";
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
  sanitizeExecutiveReportHistoryForPolicy,
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
import {
  readQueryHistory,
  sanitizeQueryHistoryForPolicy,
  upsertQueryHistory,
  writeQueryHistory
} from "@/lib/history";
import { normalizeWatsonResult } from "@/lib/watson-result-normalization";
import { getAgentDisplayVersion } from "@/lib/agent-display-version";
import type { LlmModelsResponse, PublicLlmModel } from "@/lib/llm-provider-types";
import {
  createNewSqlGenerationResetState,
  isLatestInterfaceRequest
} from "@/lib/agent-interface-state";
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

type ExecutiveSummaryState = {
  resultKey: string;
  summary: ExecutiveSummaryResult;
};

const PROFILE_POLICY_MANAGEMENT_ENABLED =
  process.env.NEXT_PUBLIC_PROFILE_POLICY_MANAGEMENT_ENABLED === "true";

type AuthState = "checking" | "locked" | "unlocked";

type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  profile: string;
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

function friendlyPolicyError(code?: string, fallback = "Não foi possível concluir a ação.") {
  const messages: Record<string, string> = {
    profile_cannot_generate_sql:
      "Seu perfil não possui permissão para realizar esta análise.",
    profile_cannot_execute_sql:
      "Seu perfil não possui permissão para realizar esta análise.",
    profile_not_allowed_for_intent:
      "Seu perfil não possui permissão para consultar esse tipo de informação.",
    profile_not_allowed_for_table:
      "Seu perfil não possui permissão para consultar uma das tabelas solicitadas.",
    profile_policy_not_found:
      "Não foi encontrada uma política ativa para o seu perfil.",
    no_allowed_tables_detected:
      "Não foi possível validar as tabelas da consulta para o seu perfil."
  };

  return code ? messages[code] ?? fallback : fallback;
}

function mergeQueryHistoryItems(...groups: QueryHistoryItem[][]) {
  const merged = new Map<string, QueryHistoryItem>();

  for (const item of groups.flat()) {
    const key = `${item.id}:${item.pergunta.trim().toLowerCase()}`;
    if (!merged.has(key)) {
      merged.set(key, item);
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10);
}

function buildExecutionResultKey(response: ExecuteWatsonResponse | null) {
  if (!response?.data.length || !response.columns.length) {
    return "";
  }

  return JSON.stringify({
    query_id: response.query_id || "",
    row_count: response.data.length,
    columns: response.columns,
    data: response.data
  });
}

async function fetchPersistentQueryHistory() {
  const response = await fetch("/api/history/runs", { cache: "no-store" });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { items?: QueryHistoryItem[] };
  return Array.isArray(data.items) ? data.items : [];
}

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(null);
  const [accountPolicy, setAccountPolicy] = useState<AccountPolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState("");
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
  const [executiveSummaryState, setExecutiveSummaryState] =
    useState<ExecutiveSummaryState | null>(null);
  const [useSqlCache, setUseSqlCache] = useState(false);
  const [llmModels, setLlmModels] = useState<PublicLlmModel[]>([]);
  const [selectedLlmModelId, setSelectedLlmModelId] = useState("");
  const [llmModelsLoading, setLlmModelsLoading] = useState(false);
  const [llmModelsError, setLlmModelsError] = useState("");
  const generationRequestRef = useRef(0);

  const canGenerateSqlByPolicy = Boolean(accountPolicy?.can_generate_sql);
  const canExecuteSqlByPolicy = Boolean(accountPolicy?.can_execute_sql);
  const canViewSqlByPolicy = accountPolicy?.can_view_sql !== false;
  const canUseAgent = canGenerateSqlByPolicy || canExecuteSqlByPolicy;
  const canSeeQueryHistory = Boolean(accountPolicy?.can_view_own_runs && canUseAgent);
  const canSeeReportHistory = Boolean(accountPolicy?.can_view_own_runs && canExecuteSqlByPolicy);
  const canManageOperationalTools = Boolean(accountPolicy?.can_manage_users);
  const canAuditOperationalTools = Boolean(
    accountPolicy?.can_manage_users || accountPolicy?.can_view_all_runs
  );
  const showWhatsAppOperationalTool = canManageOperationalTools;
  const showInterfaceSettingsTool = canManageOperationalTools;
  const showDiagnosticsTool = canAuditOperationalTools;
  const showBenchmarkTool = canAuditOperationalTools;
  const canSeeTechnicalDetails = canAuditOperationalTools;
  const hasOperationalTools =
    showWhatsAppOperationalTool ||
    showInterfaceSettingsTool ||
    showDiagnosticsTool ||
    showBenchmarkTool;
  const selectedLlmModel =
    llmModels.find((model) => model.id === selectedLlmModelId) ?? null;
  const canPrepareGeneration =
    question.trim().length > 0 &&
    canGenerateSqlByPolicy &&
    !policyLoading &&
    !llmModelsLoading &&
    Boolean(selectedLlmModel?.available_for_target);
  const canExecuteWatson =
    !generation.isLoading &&
    !execution.isLoading &&
    execution.response?.success !== true &&
    canExecuteSqlByPolicy &&
    !policyLoading &&
    Boolean(generation.response?.success) &&
    generation.response?.validation_status === "aprovado" &&
    Boolean(sql.trim() || generation.response?.agent_run_id || generation.response?.run_id);
  const isSqlHidden = Boolean(generation.response?.sql_hidden || generation.response?.can_view_sql === false);
  const detectedIntent = generation.response?.detected_intent || "";
  const hasDetectedIntent = Boolean(detectedIntent && detectedIntent !== "nao_informado");
  const hasSuccessfulExecution = execution.response?.success === true;
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
  const executionResultKey = useMemo(
    () => buildExecutionResultKey(execution.response),
    [execution.response]
  );
  const executiveSummary =
    executiveSummaryState?.resultKey === executionResultKey ? executiveSummaryState.summary : null;
  const backendExecutiveSummary =
    execution.response?.relatorio_executivo ??
    execution.response?.executive_summary ??
    null;
  const isCombinedBackendExecution = Boolean(generation.response?.execution_result);
  const hasExecutionResult = Boolean(execution.response?.success && execution.response.columns.length);
  const reportExecutiveSummary =
    backendExecutiveSummary ?? (!isCombinedBackendExecution ? executiveSummary : null);
  const displayAgentVersion = useMemo(
    () => getAgentDisplayVersion(),
    []
  );

  useEffect(() => {
    const settings = readInterfaceSettings();
    setInterfaceSettings(settings);
    setResultMode(settings.defaultResultMode);
    setUseSqlCache(settings.useSqlCache);
  }, []);

  useEffect(() => {
    const userId = authenticatedUser?.id;
    let active = true;

    if (authState !== "unlocked" || !userId || !accountPolicy) {
      setHistoryItems([]);
      setExecutiveReportHistory([]);
      return () => {
        active = false;
      };
    }

    async function loadQueryHistory() {
      if (!canSeeQueryHistory) {
        setHistoryItems([]);
        return;
      }

      const localItems = sanitizeQueryHistoryForPolicy(readQueryHistory(userId), {
        canViewSql: canViewSqlByPolicy
      });
      const persistentItems = sanitizeQueryHistoryForPolicy(await fetchPersistentQueryHistory(), {
        canViewSql: canViewSqlByPolicy
      });

      if (active) {
        setHistoryItems(mergeQueryHistoryItems(persistentItems, localItems));
      }
    }

    loadQueryHistory();

    setExecutiveReportHistory(
      canSeeReportHistory
        ? sanitizeExecutiveReportHistoryForPolicy(readExecutiveReportHistory(userId), {
            canViewSql: canViewSqlByPolicy
          })
        : []
    );

    return () => {
      active = false;
    };
  }, [
    accountPolicy,
    authState,
    authenticatedUser?.id,
    canSeeQueryHistory,
    canSeeReportHistory,
    canViewSqlByPolicy
  ]);

  useEffect(() => {
    if (accountPolicy && !accountPolicy.can_execute_sql && resultMode === "manual") {
      setResultMode("auto");
    }
  }, [accountPolicy, resultMode]);

  useEffect(() => {
    let active = true;

    async function loadLlmModels() {
      if (authState !== "unlocked" || !accountPolicy?.can_generate_sql) {
        setLlmModels([]);
        setSelectedLlmModelId("");
        setLlmModelsError("");
        return;
      }

      setLlmModelsLoading(true);
      setLlmModelsError("");

      try {
        const response = await fetch("/api/llm-models?target=official", {
          cache: "no-store"
        });
        const data = (await response.json()) as LlmModelsResponse;

        if (!response.ok || !data.success) {
          throw new Error(data.error || "llm_models_load_failed");
        }

        if (!active) return;

        setLlmModels(data.models);
        const defaultId = data.default_selection
          ? `${data.default_selection.provider_key}:${data.default_selection.model_key}:${data.default_selection.config_version}`
          : "";
        const defaultModel =
          data.models.find((model) => model.id === defaultId && model.available_for_target) ??
          data.models.find((model) => model.available_for_target) ??
          null;
        setSelectedLlmModelId(defaultModel?.id ?? "");
      } catch {
        if (active) {
          setLlmModels([]);
          setSelectedLlmModelId("");
          setLlmModelsError("Não foi possível carregar os modelos de IA disponíveis.");
        }
      } finally {
        if (active) setLlmModelsLoading(false);
      }
    }

    loadLlmModels();

    return () => {
      active = false;
    };
  }, [accountPolicy?.can_generate_sql, authState]);

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
          if (data.authenticated) {
            await loadAccountPolicy(active);
          } else {
            setAccountPolicy(null);
            setPolicyError("");
          }
        }
      } catch {
        if (active) {
          setAuthState("locked");
          setAuthenticatedUser(null);
          setAccountPolicy(null);
          setPolicyError("");
        }
      }
    }

    checkSession();

    return () => {
      active = false;
    };
  }, []);

  async function loadAccountPolicy(active = true) {
    setPolicyLoading(true);
    setPolicyError("");

    try {
      const response = await fetch("/api/account/policy", { cache: "no-store" });
      const data = (await response.json()) as {
        success?: boolean;
        policy?: AccountPolicy;
        error?: string;
      };

      if (!response.ok || !data.success || !data.policy) {
        throw new Error(data.error || "policy_load_failed");
      }

      if (active) {
        setAccountPolicy(data.policy);
      }
    } catch (error) {
      if (active) {
        const code = error instanceof Error ? error.message : "policy_load_failed";
        setAccountPolicy(null);
        setPolicyError(friendlyPolicyError(code, "Não foi possível carregar as permissões do seu perfil."));
      }
    } finally {
      if (active) {
        setPolicyLoading(false);
      }
    }
  }

  function saveHistoryItem(item: QueryHistoryItem) {
    const userId = authenticatedUser?.id;
    if (!userId || !canSeeQueryHistory) return;

    const safeItem = canViewSqlByPolicy ? item : { ...item, sql: "" };

    setHistoryItems((currentItems) => {
      const nextItems = upsertQueryHistory(currentItems, safeItem);
      writeQueryHistory(nextItems, userId);
      return nextItems;
    });
  }

  const markExecutiveSummaryGenerated = useCallback((summary: ExecutiveSummaryResult, resultKey?: string) => {
    if (!resultKey || resultKey !== executionResultKey) {
      return;
    }

    setExecutiveSummaryState({ resultKey, summary });

    if (!question.trim() || !canSeeReportHistory || !authenticatedUser?.id) {
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
      canViewSqlByPolicy ? execution.response.relatorio_executivo_markdown?.trim() || "" : "";
    const reportMarkdown =
      markdown ||
      buildExecutiveReportMarkdown({
        question,
        sql: canViewSqlByPolicy ? sql : "",
        metadata: resultMetadata,
        executiveSummary: summary,
        includeSql: canViewSqlByPolicy && interfaceSettings.markdownIncludeSql
      });

    if (!reportMarkdown.trim()) {
      return;
    }

    setExecutiveReportHistory((currentItems) =>
      upsertExecutiveReportHistory(currentItems, {
        id: crypto.randomUUID(),
        question: question.trim(),
        sql: canViewSqlByPolicy ? sql : "",
        markdown: reportMarkdown,
        summary,
        query_id: execution.response?.query_id || undefined,
        detected_intent: generation.response?.detected_intent || summary.intent,
        validation_status: generation.response?.validation_status,
        row_count: execution.response?.row_count,
        execution_time_ms: execution.response?.execution_time_ms,
        generated_at: new Date().toISOString()
      }, authenticatedUser.id)
    );
  }, [authenticatedUser?.id, canSeeReportHistory, canViewSqlByPolicy, execution.response, executionResultKey, generation.response?.detected_intent, generation.response?.validation_status, interfaceSettings.markdownIncludeSql, question, resultMetadata, sql]);

  const markPdfExported = useCallback(() => {
    if (!question.trim() || !authenticatedUser?.id || !canSeeQueryHistory) {
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
        writeQueryHistory(nextItems, authenticatedUser.id);
      }

      return nextItems;
    });
  }, [authenticatedUser?.id, canSeeQueryHistory, question, sql]);

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
    const safeSql = canViewSqlByPolicy ? item.sql : "";
    setQuestion(item.pergunta);
    setSql(safeSql);
    setGeneration({
      response: {
        success: true,
        agent_version: item.agent_version,
        detected_intent: item.detected_intent,
        validation_status: item.validation_status,
        sql: safeSql,
        raw: null,
        can_view_sql: canViewSqlByPolicy,
        sql_hidden: !canViewSqlByPolicy,
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
      writeQueryHistory(nextItems, authenticatedUser?.id);
      return nextItems;
    });
  }

  function clearHistory() {
    if (!window.confirm("Tem certeza que deseja limpar o histórico local?")) {
      return;
    }

    setHistoryItems([]);
    writeQueryHistory([], authenticatedUser?.id);
  }

  function removeExecutiveReportHistoryItem(id: string) {
    setExecutiveReportHistory(removeExecutiveReportHistory(id, authenticatedUser?.id));
  }

  function clearExecutiveReports() {
    setExecutiveReportHistory(clearExecutiveReportHistory(authenticatedUser?.id));
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
    setExecutiveSummaryState(null);
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
      await loadAccountPolicy();
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
      setAccountPolicy(null);
      setPolicyError("");
      setAuthError("");
      clearWorkspace();
    }
  }

  async function generateSql() {
    const pergunta = question.trim();

    if (!pergunta || generation.isLoading) {
      return;
    }

    if (!accountPolicy?.can_generate_sql) {
      setGeneration((current) => ({
        ...current,
        isLoading: false,
        error: "Seu perfil não possui permissão para gerar consultas neste agente financeiro."
      }));
      return;
    }

    if (!selectedLlmModel?.available_for_target) {
      setGeneration((current) => ({
        ...current,
        isLoading: false,
        error: "Selecione um modelo de IA disponível para esta análise."
      }));
      return;
    }

    const requestId = generationRequestRef.current + 1;
    generationRequestRef.current = requestId;

    const resetState = createNewSqlGenerationResetState();
    setSql(resetState.sql);
    setGeneration(resetState.generation);
    setExecution(resetState.execution);
    setExecutiveSummaryState(resetState.executiveSummaryState);
    setManualWatsonJson("");

    try {
      const response = await fetch("/api/generate-sql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          pergunta,
          llm_selection: {
            provider_key: selectedLlmModel.provider_key,
            model_key: selectedLlmModel.model_key,
            config_version: selectedLlmModel.config_version
          },
          options: {
            use_sql_cache: useSqlCache
          }
        })
      });

      const data = (await response.json()) as GenerateSqlResponse;

      if (!isLatestInterfaceRequest(requestId, generationRequestRef.current)) {
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(data.message || friendlyPolicyError(data.error, data.error || "Não foi possível concluir esta análise. Tente novamente ou reformule sua pergunta."));
      }

      const executionResult = data.execution_result;

      setSql(data.sql);
      setExecution({
        response: executionResult ?? null,
        isLoading: false,
        error: "",
        message: executionResult?.success ? "Resultado carregado." : "",
        source: executionResult ? "automatico" : null
      });
      setExecutiveSummaryState(null);
      setGeneration({
        response: data,
        isLoading: false,
        error: ""
      });
      saveHistoryItem(
        buildHistoryItem({
          pergunta,
          generatedSql: data.sql,
          generateResponse: data,
          executeResponse: executionResult,
          resultSource: executionResult ? "automatico" : undefined
        })
      );
    } catch (error) {
      if (!isLatestInterfaceRequest(requestId, generationRequestRef.current)) {
        return;
      }

      setGeneration((current) => ({
        ...current,
        isLoading: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível concluir esta análise. Tente novamente ou reformule sua pergunta."
      }));
    }
  }

  async function executeWatson() {
    if (!canExecuteWatson) {
      if (!accountPolicy?.can_execute_sql) {
        setExecution({
          response: null,
          isLoading: false,
          error: "Seu perfil não possui permissão para executar consultas.",
          message: "",
          source: "automatico"
        });
      }
      return;
    }

    const generatedSql = sql.trim();
    const agentRunId = generation.response?.agent_run_id || generation.response?.run_id || "";

    if (!generatedSql && !agentRunId) {
      setExecution({
        response: null,
        isLoading: false,
          error: "Faça uma análise antes de executar a consulta.",
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
    setExecutiveSummaryState(null);

    try {
      const response = await fetch("/api/execute-watson", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          pergunta: question.trim(),
          ...(generatedSql ? { sql: generatedSql } : {}),
          run_id: generation.response?.run_id,
          agent_run_id: generation.response?.agent_run_id
        })
      });

      const data = (await response.json()) as ExecuteWatsonResponse;

      if (!response.ok) {
        const message = (data as ExecuteWatsonResponse & { message?: string }).message;
        throw new Error(
          message ||
            data.error_message ||
            friendlyPolicyError(data.error, data.error || "Não foi possível concluir esta análise. Tente novamente ou reformule sua pergunta.")
        );
      }

      if (!data.success) {
        setExecution({
          response: data,
          isLoading: false,
          error: data.error_message || data.error || "Não foi possível concluir esta análise. Tente novamente ou reformule sua pergunta.",
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
      if (error instanceof Error && error.message.startsWith("Seu perfil")) {
        setExecution({
          response: null,
          isLoading: false,
          error: error.message,
          message: "",
          source: "automatico"
        });
        return;
      }

      setExecution({
        response: null,
        isLoading: false,
        error: "O serviço de análise está temporariamente indisponível.",
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
      setExecutiveSummaryState(null);
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
      setExecutiveSummaryState(null);
      return;
    }

    if (!normalized.columns.length) {
      setExecution({
        response: null,
        isLoading: false,
        error: "Formato inesperado no resultado informado.",
        message: "",
        source: "manual"
      });
      setExecutiveSummaryState(null);
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
        ? "Erro na análise"
        : generation.response?.success
          ? "Análise preparada"
          : "Aguardando pergunta",
      icon: generation.error ? XCircle : generation.response?.success ? CheckCircle2 : Clock3,
      tone: generation.error ? "error" : generation.response?.success ? "success" : "neutral",
      badge: generation.error ? "erro" : generation.response?.success ? "sucesso" : "pendente"
    },
    ...(hasDetectedIntent
      ? [
          {
            label: "Tipo de análise",
            value: "Identificada",
            icon: BarChart3,
            tone: "success" as const
          }
        ]
      : []),
    {
      label: "Validação",
      value: generation.error
        ? "Erro"
        : hasSuccessfulExecution
          ? "Concluído"
          : generation.response?.validation_status === "aprovado"
            ? "Análise validada"
          : generation.response?.validation_status || "Pendente",
      icon: generation.error ? XCircle : ShieldCheck,
      tone: generation.error
        ? "error"
        : hasSuccessfulExecution
          ? "success"
          : statusTone(generation.response?.validation_status || "Pendente"),
      badge: generation.error
        ? "erro"
        : hasSuccessfulExecution
          ? "concluído"
          : statusBadge(generation.response?.validation_status || "pendente")
    },
    ...(displayAgentVersion
      ? [
          {
            label: "Versão",
            value: displayAgentVersion,
            icon: ShieldCheck,
            tone: "neutral" as const
          }
        ]
      : []),
    {
      label: "Execução",
      value: execution.response?.success
        ? execution.source === "manual"
          ? "Resultado carregado manualmente"
          : `${execution.response.row_count} linhas`
        : execution.error
          ? "Serviço temporariamente indisponível"
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
              <h1 className="text-xl font-semibold text-ink">Agente Financeiro</h1>
            </div>
          </div>

          <p className="mb-4 text-sm leading-6 text-steel">
            Acesse o ambiente financeiro do Grupo Horizonte.
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
              Grupo Horizonte
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink sm:text-4xl">
              Agente Financeiro
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-steel">
              Inteligência para conversar com seus dados.
            </p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-steel">
              Faça perguntas sobre o desempenho financeiro do Grupo Horizonte e obtenha respostas baseadas nos dados disponíveis.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            {displayAgentVersion ? (
              <div className="inline-flex w-fit items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-ledger shadow-sm">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {displayAgentVersion}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                interface-v1.0-demo
              </span>
              <span className="inline-flex rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                Ambiente demonstrativo
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
              {authenticatedUser ? (
                <Link
                  href="/minha-conta"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <UserCircle className="h-4 w-4" aria-hidden="true" />
                  Minha conta
                </Link>
              ) : null}
              {accountPolicy?.can_view_all_runs ? (
                <Link
                  href="/admin/runs"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <BarChart3 className="h-4 w-4" aria-hidden="true" />
                  Histórico
                </Link>
              ) : null}
              {accountPolicy?.can_manage_users ? (
                <Link
                  href="/admin/security"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                  Segurança
                </Link>
              ) : null}
              {accountPolicy?.can_manage_users && PROFILE_POLICY_MANAGEMENT_ENABLED ? (
                <Link
                  href="/admin/profile-policies"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Políticas
                </Link>
              ) : null}
              {accountPolicy?.can_manage_users ? (
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
            {policyLoading ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900">
                Carregando permissões do perfil...
              </div>
            ) : null}
            {policyError ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
                {policyError}
              </div>
            ) : null}
            <QuestionInput
              canSubmit={canPrepareGeneration}
              disabled={!canGenerateSqlByPolicy || policyLoading}
              disabledMessage={
                !policyLoading && !canGenerateSqlByPolicy
                  ? "Seu perfil não possui permissão para realizar esta análise."
                  : undefined
              }
              isLoading={generation.isLoading}
              question={question}
              useSqlCache={useSqlCache}
              llmModels={llmModels}
              selectedLlmModelId={selectedLlmModelId}
              llmModelsLoading={llmModelsLoading}
              llmModelsError={llmModelsError}
              onQuestionChange={setQuestion}
              onLlmModelChange={setSelectedLlmModelId}
              onUseSqlCacheChange={updateUseSqlCache}
              onSubmit={generateSql}
            />
            <ExampleQuestions onSelectQuestion={setQuestion} />
            {canSeeQueryHistory ? (
              <QueryHistoryPanel
                items={historyItems}
                onSelectItem={loadHistoryItem}
                onRemoveItem={removeHistoryItem}
                onClearHistory={clearHistory}
              />
            ) : null}
            {canSeeReportHistory && interfaceSettings.showExecutiveReportHistory ? (
              <ExecutiveReportHistoryPanel
                items={executiveReportHistory}
                onRemoveItem={removeExecutiveReportHistoryItem}
                onClearHistory={clearExecutiveReports}
              />
            ) : null}
            {hasOperationalTools ? (
              <section className="space-y-3">
                <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-soft">
                  <h2 className="text-base font-semibold text-ink">Ferramentas operacionais</h2>
                  <p className="mt-1 text-xs font-medium text-steel">
                    Painéis auxiliares recolhidos para manter a tela principal limpa.
                  </p>
                </div>

                {showWhatsAppOperationalTool ? (
                  <AccordionSection
                    title="Demonstração WhatsApp"
                    summary={<WhatsAppOperationalSummary />}
                  >
                    <WhatsAppDemoPanel />
                  </AccordionSection>
                ) : null}

                {showInterfaceSettingsTool ? (
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
                ) : null}

                {showDiagnosticsTool ? (
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
                      agentVersion={displayAgentVersion}
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
                ) : null}

                {showBenchmarkTool ? (
                  <AccordionSection title="Benchmark e homologação" summary="5 casos homologados">
                    <BenchmarkHomologationPanel baseline={INTERFACE_BASELINE} />
                  </AccordionSection>
                ) : null}
              </section>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <StatusCards items={statusItems} />

            {generation.isLoading ? (
              <LoadingState message="Analisando sua pergunta..." />
            ) : null}
            {execution.isLoading ? <LoadingState message="Analisando sua pergunta..." /> : null}
            {generation.error ? <ErrorMessage message={generation.error} /> : null}
            {execution.error ? <ErrorMessage message={execution.error} /> : null}
            {generation.response?.success && !generation.error ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                Análise preparada.
              </div>
            ) : null}
            {execution.message ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                {execution.message}
              </div>
            ) : null}

            {generation.response?.success &&
            (generation.response.sql_cache_hit === true ||
              typeof generation.response.llm_total_tokens === "number") ? (
              <LlmUsageSummary
                llmProvider={generation.response.llm_provider}
                llmModel={generation.response.llm_model}
                llmPromptTokens={generation.response.llm_prompt_tokens}
                llmCompletionTokens={generation.response.llm_completion_tokens}
                llmTotalTokens={generation.response.llm_total_tokens}
                llmUsageSource={generation.response.llm_usage_source}
                sqlCacheHit={generation.response.sql_cache_hit}
                sqlCacheSavedTotalTokens={generation.response.sql_cache_saved_total_tokens}
                estimatedCostUsd={generation.response.estimated_cost_usd}
                estimatedSavingsUsd={generation.response.estimated_savings_usd}
              />
            ) : null}

            {isSqlHidden ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-sm font-semibold text-blue-900">
                A consulta técnica foi preparada, mas não é exibida para o seu perfil.
              </div>
            ) : (
              <SqlEditor
                sql={sql}
                canCopy={!isSqlHidden && accountPolicy?.can_view_sql !== false}
                onSqlChange={setSql}
                cache={generation.response?.cache}
              />
            )}

            <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
              <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-5 w-5 text-lake" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-ink">Resultados</h2>
                </div>
                {!hasSuccessfulExecution ? (
                  <ResultModeTabs
                    mode={resultMode}
                    disabledModes={!canExecuteSqlByPolicy ? ["manual"] : []}
                    onModeChange={setResultMode}
                  />
                ) : null}
              </div>

              {!hasSuccessfulExecution && resultMode === "auto" ? (
                <>
                  {!canExecuteSqlByPolicy ? (
                    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                      Seu perfil não possui permissão para realizar esta análise.
                    </div>
                  ) : null}
                  <div className="mb-4 flex justify-end">
                    <button
                      type="button"
                      disabled={!canExecuteWatson}
                      onClick={executeWatson}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-lake px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      <Database className="h-4 w-4" aria-hidden="true" />
                      {execution.isLoading ? "Executando..." : "Executar consulta"}
                    </button>
                  </div>
                </>
              ) : !hasSuccessfulExecution ? (
                <div className="mb-4">
                  <ManualWatsonResultInput
                    value={manualWatsonJson}
                    onValueChange={setManualWatsonJson}
                    onLoadResult={loadManualWatsonResult}
                    onClearJson={clearManualJson}
                  />
                </div>
              ) : null}

              {execution.response ? (
                <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {canSeeTechnicalDetails ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase text-slate-500">ID técnico</p>
                      <p className="mt-1 truncate text-sm font-semibold text-ink">
                        {execution.response.query_id || "Não informado"}
                      </p>
                    </div>
                  ) : null}
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

              {hasExecutionResult && execution.response && (backendExecutiveSummary || !isCombinedBackendExecution) ? (
                <ExecutiveSummary
                  key={executionResultKey}
                  question={question}
                  columns={execution.response!.columns}
                  data={execution.response!.data}
                  metadata={resultMetadata}
                  resultKey={executionResultKey}
                  backendSummary={
                    backendExecutiveSummary
                  }
                  allowLocalFallback={!isCombinedBackendExecution}
                  onSummaryGenerated={markExecutiveSummaryGenerated}
                />
              ) : null}

              {!hasExecutionResult ? (
                <div className="mb-4 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-steel">
                  O resumo executivo será gerado após o carregamento do resultado.
                </div>
              ) : null}

              {hasExecutionResult && execution.response ? (
                <ExecutiveReportActions
                  question={question}
                  sql={isSqlHidden ? "" : sql}
                  columns={execution.response!.columns}
                  data={execution.response!.data}
                  metadata={resultMetadata}
                  executiveSummary={reportExecutiveSummary}
                  backendMarkdown={execution.response!.relatorio_executivo_markdown ?? null}
                  canViewSql={!isSqlHidden && canViewSqlByPolicy}
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
