import type { AgentSession } from "@/lib/auth/auth-types";

const DEFAULT_LANGGRAPH_BASE_URL = "http://127.0.0.1:8000";
const N8N_SHADOW_TRANSPORT = "n8n";
const DEFAULT_SHADOW_TIMEOUT_MS = 1500;
const MIN_SHADOW_TIMEOUT_MS = 100;
const MAX_SHADOW_TIMEOUT_MS = 10000;

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
      correlation_metadata: buildCorrelationMetadata({
        event: "generate",
        route: "/api/generate-sql",
        requestId: input.requestId,
        agentVersion: input.agentVersion,
        now: options.now
      })
    },
    options
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
  options: LangGraphShadowClientOptions
): Promise<LangGraphShadowDispatchResult> {
  const env = options.env ?? process.env;

  if (!isLangGraphShadowEnabled(env)) {
    return { status: "disabled" };
  }

  let url: string;
  let s2sToken: string;

  try {
    if (env.LANGGRAPH_SHADOW_TRANSPORT?.trim().toLowerCase() === N8N_SHADOW_TRANSPORT) {
      url = getN8nShadowWebhookUrl(env);
      s2sToken = getN8nShadowToken(env);
    } else if (!env.LANGGRAPH_SHADOW_TRANSPORT ||
               env.LANGGRAPH_SHADOW_TRANSPORT.trim().toLowerCase() === "direct") {
      url = buildShadowUrl(env, path);
      s2sToken = getS2sToken(env);
    } else {
      throw new Error("unsupported shadow transport");
    }
  } catch {
    return sanitizedFailure("configuration_error");
  }

  const n8nTransport = env.LANGGRAPH_SHADOW_TRANSPORT?.trim().toLowerCase() === N8N_SHADOW_TRANSPORT;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getShadowTimeoutMs(env));
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: n8nTransport
        ? { "X-Agent-Shadow-Token": s2sToken, "Content-Type": "application/json" }
        : { Authorization: `Bearer ${s2sToken}`, "Content-Type": "application/json" },
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

    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        return sanitizedFailure("invalid_response");
      }
    }
    if (n8nTransport) {
      const ack = parsed as {accepted?: unknown; contract_version?: unknown; agent_run_id?: unknown} | null;
      const submitted = payload as {agent_run_id?: unknown};
      if (response.status !== 202 ||
          !ack || ack.accepted !== true ||
          ack.contract_version !== "1" ||
          ack.agent_run_id !== submitted.agent_run_id) {
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

function getShadowTimeoutMs(env: ShadowEnv): number {
  const rawTimeout = env.LANGGRAPH_SHADOW_TIMEOUT_MS?.trim();
  const parsedTimeout = rawTimeout ? Number.parseInt(rawTimeout, 10) : DEFAULT_SHADOW_TIMEOUT_MS;

  if (!Number.isFinite(parsedTimeout)) {
    return DEFAULT_SHADOW_TIMEOUT_MS;
  }

  return Math.min(
    Math.max(parsedTimeout, MIN_SHADOW_TIMEOUT_MS),
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

function getN8nShadowWebhookUrl(env: ShadowEnv): string {
  const raw = env.LANGGRAPH_SHADOW_N8N_WEBHOOK_URL?.trim();
  if (!raw) throw new Error("N8N shadow URL missing");
  const url = new URL(raw);
  if (url.protocol !== "https:" ||
      url.username || url.password || url.search || url.hash ||
      !url.pathname.endsWith("/webhook/langgraph-shadow-parallel-v1")) {
    throw new Error("N8N shadow URL invalid");
  }
  return url.toString();
}

function getN8nShadowToken(env: ShadowEnv): string {
  const token = env.N8N_SHADOW_WEBHOOK_TOKEN?.trim();
  if (!token) throw new Error("N8N shadow credential missing");
  return token;
}
