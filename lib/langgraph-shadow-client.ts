import type { AgentSession } from "@/lib/auth/auth-types";
import type { LlmSelection } from "@/lib/llm-provider-types";

const DEFAULT_LANGGRAPH_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_SHADOW_TIMEOUT_MS = 1500;
const MIN_SHADOW_TIMEOUT_MS = 100;
const MAX_SHADOW_TIMEOUT_MS = 300000;

type ShadowEnv = Record<string, string | undefined>;

type ShadowRoute = "/api/generate-sql" | "/api/execute-watson";
type ShadowEvent = "generate" | "execute_approved";

export type LangGraphShadowPrincipal = {
  id: string;
  email: string;
  profile: string;
};

export type LangGraphShadowCorrelationMetadata = {
  source: "nextjs_bff";
  event: ShadowEvent;
  route: ShadowRoute;
  timestamp: string;
  request_id: string;
  agent_version?: string;
};

type LangGraphShadowFetch = typeof fetch;

type LangGraphShadowClientOptions = {
  env?: ShadowEnv;
  fetchImpl?: LangGraphShadowFetch;
  now?: () => Date;
};

export type DispatchGenerateShadowInput = {
  agentRunId: string;
  question: string;
  principal: LangGraphShadowPrincipal;
  requestId: string;
  agentVersion?: string;
  llmSelection?: LlmSelection | null;
  timeoutMs?: number | null;
};

export type DispatchExecuteApprovedShadowInput = {
  agentRunId: string;
  approvedSql: string;
  principal: LangGraphShadowPrincipal;
  requestId: string;
  agentVersion?: string;
};

export type LangGraphShadowDispatchResult = {
  status:
    | "disabled"
    | "sent"
    | "http_error"
    | "network_error"
    | "timeout"
    | "invalid_response"
    | "configuration_error";
  httpStatus?: number;
  errorName?: string;
  errorMessage?: string;
};

export function isLangGraphShadowEnabled(env: ShadowEnv = process.env): boolean {
  return env.LANGGRAPH_SHADOW_ENABLED?.trim().toLowerCase() === "true";
}

// Configuration readiness only; not proof that a request has reached LangGraph.
export function isLangGraphShadowDispatchConfigured(env: ShadowEnv = process.env): boolean {
  if (!isLangGraphShadowEnabled(env)) return false;
  if (env.LANGGRAPH_OFFICIAL_VIA_N8N?.trim().toLowerCase() === "true") return false;
  if (!env.LANGGRAPH_S2S_TOKEN?.trim()) return false;
  const raw = env.LANGGRAPH_INTERNAL_BASE_URL?.trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (!(["http:", "https:"].includes(url.protocol)) ||
        !url.hostname || url.username || url.password || url.search || url.hash ||
        (url.pathname !== "/" && url.pathname !== "")) return false;
    if (env.VERCEL === "1" && (url.protocol !== "https:" ||
        ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) return false;
    return true;
  } catch {
    return false;
  }
}

export function buildLangGraphShadowPrincipal(
  session: AgentSession
): LangGraphShadowPrincipal {
  return {
    id: session.userId,
    email: session.email,
    profile: session.userProfile
  };
}

export async function dispatchLangGraphGenerateShadow(
  input: DispatchGenerateShadowInput,
  options: LangGraphShadowClientOptions = {}
): Promise<LangGraphShadowDispatchResult> {
  return dispatchLangGraphShadow(
    "/v1/internal/sql-agent/generate",
    {
      contract_version: "1",
      agent_run_id: input.agentRunId,
      question: input.question,
      principal: input.principal,
      ...(input.llmSelection ? { llm_selection: input.llmSelection } : {}),
      correlation_metadata: buildCorrelationMetadata({
        event: "generate",
        route: "/api/generate-sql",
        requestId: input.requestId,
        agentVersion: input.agentVersion,
        now: options.now
      })
    },
    options,
    input.timeoutMs
  );
}

export async function dispatchLangGraphExecuteApprovedShadow(
  input: DispatchExecuteApprovedShadowInput,
  options: LangGraphShadowClientOptions = {}
): Promise<LangGraphShadowDispatchResult> {
  return dispatchLangGraphShadow(
    "/v1/internal/sql-agent/execute-approved-shadow",
    {
      contract_version: "1",
      agent_run_id: input.agentRunId,
      approved_sql: input.approvedSql,
      principal: input.principal,
      correlation_metadata: buildCorrelationMetadata({
        event: "execute_approved",
        route: "/api/execute-watson",
        requestId: input.requestId,
        agentVersion: input.agentVersion,
        now: options.now
      })
    },
    options
  );
}

async function dispatchLangGraphShadow(
  path: string,
  payload: unknown,
  options: LangGraphShadowClientOptions,
  modelTimeoutMs?: number | null
): Promise<LangGraphShadowDispatchResult> {
  const env = options.env ?? process.env;

  if (!isLangGraphShadowEnabled(env)) {
    return { status: "disabled" };
  }

  let url: string;
  let s2sToken: string;

  try {
    url = buildShadowUrl(env, path);
    s2sToken = getS2sToken(env);
  } catch {
    return sanitizedFailure("configuration_error");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getShadowTimeoutMs(env, modelTimeoutMs)
  );
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s2sToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        status: "http_error",
        httpStatus: response.status,
        errorMessage: "LangGraph shadow dispatch failed"
      };
    }

    const text = await response.text();

    if (text) {
      try {
        JSON.parse(text);
      } catch {
        return sanitizedFailure("invalid_response");
      }
    }

    return {
      status: "sent",
      httpStatus: response.status
    };
  } catch (error) {
    if (isAbortError(error)) {
      return sanitizedFailure("timeout", error);
    }

    return sanitizedFailure("network_error", error);
  } finally {
    clearTimeout(timeout);
  }
}

function buildCorrelationMetadata({
  event,
  route,
  requestId,
  agentVersion,
  now
}: {
  event: ShadowEvent;
  route: ShadowRoute;
  requestId: string;
  agentVersion?: string;
  now?: () => Date;
}): LangGraphShadowCorrelationMetadata {
  return {
    source: "nextjs_bff",
    event,
    route,
    timestamp: (now ?? (() => new Date()))().toISOString(),
    request_id: requestId,
    ...(agentVersion ? { agent_version: agentVersion } : {})
  };
}

function buildShadowUrl(env: ShadowEnv, path: string): string {
  const baseUrl = env.LANGGRAPH_INTERNAL_BASE_URL?.trim() || DEFAULT_LANGGRAPH_BASE_URL;
  const url = new URL(baseUrl);

  return `${url.toString().replace(/\/+$/, "")}${path}`;
}

function getS2sToken(env: ShadowEnv): string {
  const token = env.LANGGRAPH_S2S_TOKEN?.trim();
  if (!token) {
    throw new Error("LANGGRAPH_S2S_TOKEN is required.");
  }
  return token;
}

function getShadowTimeoutMs(
  env: ShadowEnv,
  modelTimeoutMs?: number | null
): number {
  const rawTimeout = env.LANGGRAPH_SHADOW_TIMEOUT_MS?.trim();
  const envTimeout = rawTimeout ? Number.parseInt(rawTimeout, 10) : Number.NaN;
  const selectedTimeout = Number.isFinite(envTimeout)
    ? envTimeout
    : Number.isFinite(modelTimeoutMs)
      ? Number(modelTimeoutMs)
      : DEFAULT_SHADOW_TIMEOUT_MS;

  return Math.min(
    Math.max(selectedTimeout, MIN_SHADOW_TIMEOUT_MS),
    MAX_SHADOW_TIMEOUT_MS
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function sanitizedFailure(
  status: Exclude<LangGraphShadowDispatchResult["status"], "disabled" | "sent" | "http_error">,
  error?: unknown
): LangGraphShadowDispatchResult {
  return {
    status,
    errorName: error instanceof Error ? error.name : undefined,
    errorMessage: "LangGraph shadow dispatch failed"
  };
}
