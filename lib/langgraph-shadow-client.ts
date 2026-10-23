import type { AgentSession } from "@/lib/auth/auth-types";
import type { LlmSelection } from "@/lib/llm-provider-types";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";

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
  organization_id?: string;
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

// Configuration readiness is not proof of network reachability.
export type ShadowDispatchBlocker =
  | "feature_disabled"
  | "already_official"
  | "unsupported_transport"
  | "generate_target_unconfigured"
  | "execute_target_unconfigured";

// Local configuration only: this is NOT a probe of n8n, LLM execution or
// correlated evidence. Restrict to status booleans and structural reason codes.
export function inspectLangGraphShadowDispatchConfiguration(
  env: ShadowEnv = process.env
) {
  const transportValue = env.LANGGRAPH_SHADOW_TRANSPORT?.trim() || "direct";
  const supported = ["direct", "n8n", "n8n_relay"].includes(transportValue);
  const enabled = isLangGraphShadowEnabled(env);
  const isAlreadyOfficial = env.LANGGRAPH_OFFICIAL_VIA_N8N?.trim().toLowerCase() === "true";
  const generateTargetConfigured =
    dispatchTarget(env, "/v1/internal/sql-agent/generate") !== null;
  const executeTargetConfigured =
    dispatchTarget(env, "/v1/internal/sql-agent/execute-approved-shadow") !== null;
  const blockers: ShadowDispatchBlocker[] = [];
  if (!enabled) blockers.push("feature_disabled");
  if (isAlreadyOfficial) blockers.push("already_official");
  if (!supported) blockers.push("unsupported_transport");
  if (!generateTargetConfigured) blockers.push("generate_target_unconfigured");
  if (!executeTargetConfigured) blockers.push("execute_target_unconfigured");
  return {
    enabled,
    transport: supported ? transportValue : "unsupported",
    generate_target_configured: generateTargetConfigured,
    execute_target_configured: executeTargetConfigured,
    dispatch_ready: blockers.length === 0,
    blockers
  };
}

export function isLangGraphShadowDispatchConfigured(env: ShadowEnv = process.env): boolean {
  // Preserve existing generate-only relay semantics. The administrator's
  // dispatch_ready flag is stricter: both generation AND approved-execution
  // endpoints must be configured before declaring G2 fully prepared.
  const readiness = inspectLangGraphShadowDispatchConfiguration(env);
  return readiness.enabled &&
    !readiness.blockers.includes("already_official") &&
    readiness.generate_target_configured;
}

export function buildLangGraphShadowPrincipal(
  session: AgentSession
): LangGraphShadowPrincipal | null {
  const tenant = getSessionTenantIdentity(session);
  if (tenant.status === "required") return null;
  return {
    id: session.userId,
    email: session.email,
    profile: session.userProfile,
    ...(tenant.status === "ready" ? { organization_id: tenant.organizationId } : {})
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

  const target = dispatchTarget(env, path);
  if (!target) return sanitizedFailure("configuration_error");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getShadowTimeoutMs(env, modelTimeoutMs)
  );
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(target.url, {
      method: "POST",
      headers: target.mode === "n8n"
        ? { "X-Agent-Shadow-Token": target.token, "Content-Type": "application/json" }
        : { Authorization: `Bearer ${target.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error",
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

    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      return sanitizedFailure("invalid_response");
    }

    if (target.mode === "n8n") {
      const submitted = payload as {
        agent_run_id?: unknown;
        correlation_metadata?: { event?: unknown };
      };
      if (response.status !== 202 ||
          !isRecord(parsed) ||
          parsed.accepted !== true ||
          parsed.contract_version !== "1" ||
          parsed.agent_run_id !== submitted.agent_run_id ||
          parsed.event !== submitted.correlation_metadata?.event) {
        return sanitizedFailure("invalid_response");
      }
    } else if (target.mode === "n8n_relay" && (
      !isRecord(parsed) ||
      parsed.relay_status !== "accepted" ||
      parsed.agent_run_id !== (payload as { agent_run_id?: string }).agent_run_id
    )) {
      return sanitizedFailure("invalid_response");
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

type DispatchTarget = {
  url: string;
  token: string;
  mode: "direct" | "n8n_relay" | "n8n";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function dispatchTarget(env: ShadowEnv, path: string): DispatchTarget | null {
  const transport = env.LANGGRAPH_SHADOW_TRANSPORT?.trim() || "direct";
  // Separate n8n orchestration: Header Auth and 202 correlation contract,
  // never the LangGraph Bearer credential. This does not enable the workflow.
  if (transport === "n8n") {
    const raw = env.LANGGRAPH_SHADOW_N8N_WEBHOOK_URL?.trim();
    const token = env.N8N_SHADOW_WEBHOOK_TOKEN?.trim();
    if (!raw || !token) return null;
    const url = safeEndpointUrl(raw, true);
    if (!url || new URL(url).pathname !== "/webhook/langgraph-shadow-parallel-v1") {
      return null;
    }
    return { url, token, mode: "n8n" };
  }
  if (transport === "n8n_relay") {
    const key = path === "/v1/internal/sql-agent/generate"
      ? "LANGGRAPH_SHADOW_RELAY_GENERATE_URL"
      : path === "/v1/internal/sql-agent/execute-approved-shadow"
        ? "LANGGRAPH_SHADOW_RELAY_EXECUTE_URL"
        : null;
    const raw = key ? env[key]?.trim() : undefined;
    const token = env.LANGGRAPH_SHADOW_RELAY_TOKEN?.trim();
    if (!raw || !token) return null;
    const url = safeEndpointUrl(raw, true);
    return url ? { url, token, mode: "n8n_relay" } : null;
  }
  if (transport !== "direct") return null;
  const token = env.LANGGRAPH_S2S_TOKEN?.trim();
  const raw = env.LANGGRAPH_INTERNAL_BASE_URL?.trim();
  if (!token || !raw) return null;
  const base = safeEndpointUrl(raw, false);
  if (!base) return null;
  const url = new URL(base);
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (env.VERCEL === "1" && (url.protocol !== "https:" ||
      isLocalOrPrivateHostname(url.hostname))) return null;
  return { url: base.replace(/\/+$/, "") + path, token, mode: "direct" };
}

function safeEndpointUrl(raw: string, relay: boolean): string | null {
  try {
    const url = new URL(raw);
    if (!url.hostname || url.username || url.password || url.search ||
        url.hash || !["http:", "https:"].includes(url.protocol)) return null;
    if (relay && (url.protocol !== "https:" ||
        isLocalOrPrivateHostname(url.hostname) || url.pathname === "/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isLocalOrPrivateHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (["localhost", "::1", "[::1]"].includes(h) ||
      h.endsWith(".localhost") || h.endsWith(".local") ||
      h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h.startsWith("127.") ||
      h.startsWith("10.") || h.startsWith("192.168.") ||
      h.startsWith("169.254.")) return true;
  const match = /^172\.(\d+)\./.exec(h);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
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
