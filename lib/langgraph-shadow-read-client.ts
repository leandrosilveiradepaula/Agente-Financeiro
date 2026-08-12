import "server-only";
import type {
  ShadowRunSummary,
  ShadowStepMetadata,
  ShadowRunVisualization,
  ShadowRunVisualizationEdge,
  ShadowRunVisualizationFlags,
  ShadowRunVisualizationStep
} from "@/lib/types";

const DEFAULT_LANGGRAPH_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_SHADOW_TIMEOUT_MS = 1500;
const MIN_SHADOW_TIMEOUT_MS = 100;
const MAX_SHADOW_TIMEOUT_MS = 10000;
const DEFAULT_SHADOW_LIST_LIMIT = 10;
const MAX_SHADOW_LIST_LIMIT = 50;
const MAX_SAFE_STRING_LENGTH = 180;
const MAX_SAFE_MESSAGES = 20;

type ShadowReadEnv = Record<string, string | undefined>;
type ShadowReadFetch = typeof fetch;

type ShadowReadClientOptions = {
  env?: ShadowReadEnv;
  fetchImpl?: ShadowReadFetch;
};

export type LangGraphShadowReadResult<T> =
  | {
      status: "ok";
      httpStatus: number;
      data: T;
    }
  | {
      status:
        | "bad_request"
        | "not_found"
        | "unavailable"
        | "timeout"
        | "network_error"
        | "invalid_response"
        | "configuration_error";
      httpStatus?: number;
      errorName?: string;
      errorMessage: "LangGraph shadow read failed";
    };

export async function listLangGraphShadowRuns(
  agentRunId: string,
  input?: { limit?: number },
  options: ShadowReadClientOptions = {}
): Promise<LangGraphShadowReadResult<ShadowRunSummary[]>> {
  const limit = clampShadowListLimit(input?.limit);
  return readLangGraphShadow(
    `/v1/internal/agent-runs/${encodeURIComponent(agentRunId)}/shadow-runs?limit=${limit}`,
    parseShadowRunList,
    options
  );
}

export async function getLangGraphShadowRun(
  shadowRecordId: string,
  options: ShadowReadClientOptions = {}
): Promise<LangGraphShadowReadResult<ShadowRunSummary>> {
  return readLangGraphShadow(
    `/v1/internal/shadow-runs/${encodeURIComponent(shadowRecordId)}`,
    parseShadowRunRecord,
    options
  );
}

export async function getLangGraphShadowRunVisualization(
  shadowRecordId: string,
  options: ShadowReadClientOptions = {}
): Promise<LangGraphShadowReadResult<ShadowRunVisualization>> {
  return readLangGraphShadow(
    `/v1/internal/shadow-runs/${encodeURIComponent(shadowRecordId)}/visualization`,
    parseShadowRunVisualization,
    options
  );
}

export function sanitizeShadowRunVisualizationForBrowser(
  value: unknown
): ShadowRunVisualization | null {
  return parseShadowRunVisualization(value);
}

async function readLangGraphShadow<T>(
  path: string,
  parser: (value: unknown) => T | null,
  options: ShadowReadClientOptions
): Promise<LangGraphShadowReadResult<T>> {
  const env = options.env ?? process.env;
  let url: string;
  let s2sToken: string;

  try {
    url = buildShadowUrl(env, path);
    s2sToken = getS2sToken(env);
  } catch {
    return sanitizedFailure("configuration_error");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getShadowTimeoutMs(env));
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${s2sToken}`,
        Accept: "application/json"
      },
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      return sanitizedHttpFailure(response.status);
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      return sanitizedFailure("invalid_response", undefined, response.status);
    }

    const parsed = parser(body);

    if (!parsed) {
      return sanitizedFailure("invalid_response", undefined, response.status);
    }

    return {
      status: "ok",
      httpStatus: response.status,
      data: parsed
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

function parseShadowRunList(value: unknown): ShadowRunSummary[] | null {
  const body = isRecord(value) ? value : {};
  const items = Array.isArray(value)
    ? value
    : Array.isArray(body.shadow_runs)
      ? body.shadow_runs
      : Array.isArray(body.items)
        ? body.items
        : Array.isArray(body.runs)
          ? body.runs
          : null;

  if (!items) return null;

  const parsed = items.map(parseShadowRunRecord);

  return parsed.every((item): item is ShadowRunSummary => Boolean(item)) ? parsed : null;
}

function parseShadowRunRecord(value: unknown): ShadowRunSummary | null {
  const candidate = unwrapShadowRun(value);
  if (!candidate) return null;

  const shadowRecordId = stringField(candidate, "shadow_record_id");
  const agentRunId = stringField(candidate, "agent_run_id");
  const eventType = stringField(candidate, "event_type");
  const status = stringField(candidate, "status");
  const createdAt = stringField(candidate, "created_at");

  if (!shadowRecordId || !agentRunId || !eventType || !status || !createdAt) {
    return null;
  }

  return {
    shadow_record_id: shadowRecordId,
    agent_run_id: agentRunId,
    event_type: eventType,
    status,
    created_at: createdAt,
    completed_at: nullableStringField(candidate, "completed_at"),
    requires_reapproval: booleanField(candidate, "requires_reapproval"),
    ...(hasBoolean(candidate, "has_repair") ? { has_repair: Boolean(candidate.has_repair) } : {}),
    ...(hasBoolean(candidate, "has_error") ? { has_error: Boolean(candidate.has_error) } : {}),
    ...(safeStringArrayField(candidate, "warnings").length
      ? { warnings: safeStringArrayField(candidate, "warnings") }
      : {}),
    ...(safeStringArrayField(candidate, "errors").length
      ? { errors: safeStringArrayField(candidate, "errors") }
      : {})
  };
}

function parseShadowRunVisualization(value: unknown): ShadowRunVisualization | null {
  if (!isRecord(value)) return null;

  const contractVersion = stringField(value, "contract_version");
  const run = parseShadowRunRecord(value.run);
  const steps = Array.isArray(value.steps) ? value.steps.map(parseStep) : null;
  const edges = Array.isArray(value.edges) ? value.edges.map(parseEdge) : null;

  if (
    !contractVersion ||
    !run ||
    !steps ||
    !edges ||
    !steps.every((step): step is ShadowRunVisualizationStep => Boolean(step)) ||
    !edges.every((edge): edge is ShadowRunVisualizationEdge => Boolean(edge))
  ) {
    return null;
  }

  return {
    contract_version: contractVersion,
    run,
    steps,
    edges,
    flags: parseFlags(value.flags)
  };
}

function parseStep(value: unknown): ShadowRunVisualizationStep | null {
  if (!isRecord(value)) return null;

  const id = stringField(value, "id");
  const label = stringField(value, "label");
  const status = stringField(value, "status");
  const order = numberField(value, "order");

  if (!id || !label || !status || order === null) {
    return null;
  }

  return {
    id,
    order,
    label,
    status,
    ...(isRecord(value.metadata) ? { metadata: sanitizeShadowStepMetadata(value.metadata) } : {}),
    ...(safeStringArrayField(value, "warnings").length
      ? { warnings: safeStringArrayField(value, "warnings") }
      : {}),
    ...(safeStringArrayField(value, "errors").length
      ? { errors: safeStringArrayField(value, "errors") }
      : {})
  };
}

function parseEdge(value: unknown): ShadowRunVisualizationEdge | null {
  if (!isRecord(value)) return null;

  const source = stringField(value, "source");
  const target = stringField(value, "target");

  if (!source || !target) {
    return null;
  }

  return {
    source,
    target,
    label: nullableStringField(value, "label")
  };
}

function parseFlags(value: unknown): ShadowRunVisualizationFlags {
  if (!isRecord(value)) return {};

  return {
    ...(hasBoolean(value, "requires_reapproval")
      ? { requires_reapproval: Boolean(value.requires_reapproval) }
      : {}),
    ...(hasBoolean(value, "has_repair") ? { has_repair: Boolean(value.has_repair) } : {}),
    ...(hasBoolean(value, "has_error") ? { has_error: Boolean(value.has_error) } : {}),
    ...(safeStringArrayField(value, "warnings").length
      ? { warnings: safeStringArrayField(value, "warnings") }
      : {}),
    ...(safeStringArrayField(value, "errors").length ? { errors: safeStringArrayField(value, "errors") } : {})
  };
}

function unwrapShadowRun(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.shadow_run)) return value.shadow_run;
  if (isRecord(value.run)) return value.run;
  return value;
}

function sanitizeShadowStepMetadata(value: unknown): ShadowStepMetadata {
  if (!isRecord(value)) return {};

  const metadata: ShadowStepMetadata = {};
  assignSafeNumber(metadata, value, "attempt");
  assignSafeNumber(metadata, value, "attempts");
  assignSafeNumber(metadata, value, "cycle");
  assignSafeNumber(metadata, value, "cycles");
  assignSafeNumber(metadata, value, "duration_ms");
  assignSafeString(metadata, value, "failure_category");
  assignSafeString(metadata, value, "gate");
  assignSafeString(metadata, value, "kind");
  assignSafeString(metadata, value, "phase");
  assignSafeString(metadata, value, "preflight_status");
  assignSafeString(metadata, value, "reason_code");
  assignSafeNumber(metadata, value, "repair_attempt");
  assignSafeNumber(metadata, value, "repair_iteration");
  assignSafeBoolean(metadata, value, "requires_reapproval");
  assignSafeString(metadata, value, "result");

  return metadata;
}

function assignSafeNumber(
  target: ShadowStepMetadata,
  source: Record<string, unknown>,
  key: keyof ShadowStepMetadata
) {
  const value = source[key];

  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    target[key] = value as never;
  }
}

function assignSafeString(
  target: ShadowStepMetadata,
  source: Record<string, unknown>,
  key: keyof ShadowStepMetadata
) {
  const value = source[key];

  if (typeof value === "string" && value.trim()) {
    target[key] = value.trim().slice(0, MAX_SAFE_STRING_LENGTH) as never;
  }
}

function assignSafeBoolean(
  target: ShadowStepMetadata,
  source: Record<string, unknown>,
  key: keyof ShadowStepMetadata
) {
  const value = source[key];

  if (typeof value === "boolean") {
    target[key] = value as never;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function nullableStringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function numberField(value: Record<string, unknown>, key: string): number | null {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true;
}

function hasBoolean(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "boolean";
}

function safeStringArrayField(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  return Array.isArray(field)
    ? field
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .slice(0, MAX_SAFE_MESSAGES)
        .map((item) => item.trim().slice(0, MAX_SAFE_STRING_LENGTH))
    : [];
}

function buildShadowUrl(env: ShadowReadEnv, path: string): string {
  const baseUrl = env.LANGGRAPH_INTERNAL_BASE_URL?.trim() || DEFAULT_LANGGRAPH_BASE_URL;
  const url = new URL(baseUrl);

  return `${url.toString().replace(/\/+$/, "")}${path}`;
}

function getS2sToken(env: ShadowReadEnv): string {
  const token = env.LANGGRAPH_S2S_TOKEN?.trim();
  if (!token) {
    throw new Error("LANGGRAPH_S2S_TOKEN is required.");
  }
  return token;
}

function getShadowTimeoutMs(env: ShadowReadEnv): number {
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

function clampShadowListLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SHADOW_LIST_LIMIT;
  }

  return Math.min(Math.trunc(value), MAX_SHADOW_LIST_LIMIT);
}

function sanitizedHttpFailure(status: number): LangGraphShadowReadResult<never> {
  if (status === 400) return sanitizedFailure("bad_request", undefined, status);
  if (status === 404) return sanitizedFailure("not_found", undefined, status);
  return sanitizedFailure("unavailable", undefined, status);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function sanitizedFailure(
  status: Exclude<LangGraphShadowReadResult<never>["status"], "ok">,
  error?: unknown,
  httpStatus?: number
): LangGraphShadowReadResult<never> {
  return {
    status,
    httpStatus,
    errorName: error instanceof Error ? error.name : undefined,
    errorMessage: "LangGraph shadow read failed"
  };
}
