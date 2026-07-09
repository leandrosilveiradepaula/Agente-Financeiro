import "server-only";
import { db } from "@/lib/db";
import type { AgentSession, RequestMetadata } from "@/lib/auth/auth-types";
import type { ResultRow } from "@/lib/types";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonRecord = { [key: string]: JsonValue };

const SENSITIVE_KEYS = new Set([
  "authorization",
  "access_token",
  "cookie",
  "cookies",
  "header",
  "headers",
  "password",
  "password_hash",
  "refresh_token",
  "n8n_internal_webhook_token",
  "session_token_hash",
  "token",
  "tokens",
  "x-agent-internal-token"
]);

export type AgentRunRow = {
  id: string;
  created_at: string;
  updated_at: string;
  request_id: string | null;
  run_id: string | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  user_profile: string | null;
  auth_source: string | null;
  pergunta: string;
  pergunta_normalizada: string | null;
  detected_intent: string | null;
  intent_confidence: string | number | null;
  sql_generated: string | null;
  sql_executed: string | null;
  validation_status: string | null;
  validation_errors: unknown;
  validation_warnings: unknown;
  execution_status: string;
  execution_error: string | null;
  row_count: number | null;
  columns: unknown;
  data_preview: unknown;
  execution_time_ms: number | null;
  total_time_ms: number | null;
  source: string | null;
  executor_mode: string | null;
  executor_version: string | null;
  n8n_status_code: number | null;
  watson_status_code: number | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: unknown;
};

export type SanitizedAgentRun = Omit<
  AgentRunRow,
  "validation_errors" | "validation_warnings" | "columns" | "data_preview" | "metadata"
> & {
  validation_errors: JsonValue;
  validation_warnings: JsonValue;
  columns: JsonValue;
  data_preview: JsonValue;
  metadata: JsonValue;
};

function normalizeQuestion(question: string) {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

function sanitizeJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item));
  }

  if (typeof value === "object") {
    const sanitized: JsonRecord = {};

    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      sanitized[key] = sanitizeJsonValue(nestedValue);
    }

    return sanitized;
  }

  return String(value);
}

function sanitizeJsonRecord(value?: Record<string, unknown>): JsonRecord {
  const sanitized = sanitizeJsonValue(value ?? {});
  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)
    ? sanitized
    : {};
}

function sanitizeJsonArray(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return sanitizeJsonValue(value);
  }

  return [];
}

function asInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function extractRowsPreview(data: ResultRow[] | undefined) {
  return sanitizeJsonValue((data ?? []).slice(0, 20));
}

export function sanitizeAgentRun(run: AgentRunRow): SanitizedAgentRun {
  return {
    ...run,
    validation_errors: sanitizeJsonArray(run.validation_errors),
    validation_warnings: sanitizeJsonArray(run.validation_warnings),
    columns: sanitizeJsonArray(run.columns),
    data_preview: sanitizeJsonArray(run.data_preview),
    metadata: sanitizeJsonValue(run.metadata)
  };
}

async function getRunById(id: string) {
  const result = await db.query<AgentRunRow>(
    `
    SELECT *
    FROM public.ai_agent_runs
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function getAgentRunById(id: string) {
  const run = await getRunById(id);
  return run ? sanitizeAgentRun(run) : null;
}

export async function createAgentRun(input: {
  requestId: string;
  runId?: string;
  session: AgentSession;
  pergunta: string;
  source?: string;
  metadata: RequestMetadata;
  extraMetadata?: Record<string, unknown>;
}) {
  const runId = input.runId || crypto.randomUUID();
  const result = await db.query<AgentRunRow>(
    `
    INSERT INTO public.ai_agent_runs (
      request_id,
      run_id,
      user_id,
      user_email,
      user_name,
      user_profile,
      auth_source,
      pergunta,
      pergunta_normalizada,
      source,
      ip_address,
      user_agent,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
    RETURNING *
    `,
    [
      input.requestId,
      runId,
      input.session.userId,
      input.session.email,
      input.session.name,
      input.session.userProfile,
      "database_session",
      input.pergunta,
      normalizeQuestion(input.pergunta),
      input.source ?? "interface",
      input.metadata.ipAddress,
      input.metadata.userAgent,
      JSON.stringify(sanitizeJsonRecord(input.extraMetadata))
    ]
  );

  return sanitizeAgentRun(result.rows[0]);
}

export async function updateAgentRunGeneratedSql(input: {
  id: string;
  detectedIntent?: string | null;
  intentConfidence?: number | null;
  sqlGenerated?: string | null;
  validationStatus?: string | null;
  validationErrors?: unknown[];
  validationWarnings?: unknown[];
  executionStatus?: "generated" | "failed" | "blocked";
  executionError?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await db.query(
    `
    UPDATE public.ai_agent_runs
    SET
      detected_intent = $2,
      intent_confidence = $3,
      sql_generated = $4,
      validation_status = $5,
      validation_errors = $6::jsonb,
      validation_warnings = $7::jsonb,
      execution_status = $8,
      execution_error = $9,
      metadata = metadata || $10::jsonb,
      updated_at = now()
    WHERE id = $1
    `,
    [
      input.id,
      input.detectedIntent ?? null,
      input.intentConfidence ?? null,
      input.sqlGenerated ?? null,
      input.validationStatus ?? null,
      JSON.stringify(sanitizeJsonValue(input.validationErrors ?? [])),
      JSON.stringify(sanitizeJsonValue(input.validationWarnings ?? [])),
      input.executionStatus ?? "generated",
      input.executionError ?? null,
      JSON.stringify(sanitizeJsonRecord(input.metadata))
    ]
  );

  return getAgentRunById(input.id);
}

export async function updateAgentRunExecution(input: {
  id: string;
  sqlExecuted?: string | null;
  executionStatus: "executed" | "failed" | "blocked";
  executionError?: string | null;
  rowCount?: number | null;
  columns?: string[];
  data?: ResultRow[];
  executionTimeMs?: number | null;
  totalTimeMs?: number | null;
  executorMode?: string | null;
  executorVersion?: string | null;
  n8nStatusCode?: number | null;
  watsonStatusCode?: number | null;
  metadata?: Record<string, unknown>;
}) {
  await db.query(
    `
    UPDATE public.ai_agent_runs
    SET
      sql_executed = $2,
      execution_status = $3,
      execution_error = $4,
      row_count = $5,
      columns = $6::jsonb,
      data_preview = $7::jsonb,
      execution_time_ms = $8,
      total_time_ms = $9,
      executor_mode = $10,
      executor_version = $11,
      n8n_status_code = $12,
      watson_status_code = $13,
      metadata = metadata || $14::jsonb,
      updated_at = now()
    WHERE id = $1
    `,
    [
      input.id,
      input.sqlExecuted ?? null,
      input.executionStatus,
      input.executionError ?? null,
      input.rowCount ?? null,
      JSON.stringify(sanitizeJsonValue(input.columns ?? [])),
      JSON.stringify(extractRowsPreview(input.data)),
      asInteger(input.executionTimeMs),
      asInteger(input.totalTimeMs),
      input.executorMode ?? null,
      input.executorVersion ?? null,
      input.n8nStatusCode ?? null,
      input.watsonStatusCode ?? null,
      JSON.stringify(sanitizeJsonRecord(input.metadata))
    ]
  );

  return getAgentRunById(input.id);
}

export async function markAgentRunBlocked(input: {
  agentRunId: string;
  executionError: string;
  detectedIntent?: string | null;
  metadata?: Record<string, unknown>;
  validationStatus?: string | null;
  validationErrors?: unknown[];
  sqlGenerated?: string | null;
  sqlExecuted?: string | null;
}) {
  await db.query(
    `
    UPDATE public.ai_agent_runs
    SET
      execution_status = 'blocked',
      execution_error = $2,
      detected_intent = COALESCE($3, detected_intent),
      validation_status = COALESCE($4, validation_status),
      validation_errors = $5::jsonb,
      sql_generated = COALESCE($6, sql_generated),
      sql_executed = COALESCE($7, sql_executed),
      metadata = metadata || $8::jsonb,
      updated_at = now()
    WHERE id = $1
    `,
    [
      input.agentRunId,
      input.executionError,
      input.detectedIntent ?? null,
      input.validationStatus ?? null,
      JSON.stringify(sanitizeJsonValue(input.validationErrors ?? [])),
      input.sqlGenerated ?? null,
      input.sqlExecuted ?? null,
      JSON.stringify(sanitizeJsonRecord(input.metadata))
    ]
  );

  return getAgentRunById(input.agentRunId);
}

export async function listAgentRuns(input: {
  status?: string;
  userEmail?: string;
  intent?: string;
  limit: number;
  offset: number;
}) {
  const filters: string[] = [];
  const values: Array<string | number> = [];

  if (input.status) {
    values.push(input.status);
    filters.push(`execution_status = $${values.length}`);
  }

  if (input.userEmail) {
    values.push(`%${input.userEmail.toLowerCase()}%`);
    filters.push(`lower(coalesce(user_email, '')) LIKE $${values.length}`);
  }

  if (input.intent) {
    values.push(input.intent);
    filters.push(`detected_intent = $${values.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  values.push(input.limit, input.offset);
  const limitIndex = values.length - 1;
  const offsetIndex = values.length;

  const result = await db.query<AgentRunRow>(
    `
    SELECT *
    FROM public.ai_agent_runs
    ${where}
    ORDER BY created_at DESC
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
    `,
    values
  );

  const countResult = await db.query<{ total: string }>(
    `
    SELECT count(*)::text AS total
    FROM public.ai_agent_runs
    ${where}
    `,
    values.slice(0, values.length - 2)
  );

  return {
    runs: result.rows.map(sanitizeAgentRun),
    total: Number(countResult.rows[0]?.total ?? 0)
  };
}
