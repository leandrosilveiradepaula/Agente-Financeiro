import "server-only";
import { db } from "@/lib/db";
import type { AgentSession, RequestMetadata } from "@/lib/auth/auth-types";
import type { ResultRow } from "@/lib/types";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";

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

export class TenantIdentityRequiredError extends Error {
  constructor() {
    super("Tenant identity is required");
    this.name = "TenantIdentityRequiredError";
  }
}

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
  organization_id: string | null;
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
  llm_provider: string | null;
  llm_model: string | null;
  llm_prompt_tokens: number | null;
  llm_completion_tokens: number | null;
  llm_total_tokens: number | null;
  llm_usage_source: string | null;
  sql_cache_hit: boolean | null;
  sql_cache_source_run_id: string | null;
  sql_cache_saved_prompt_tokens: number | null;
  sql_cache_saved_completion_tokens: number | null;
  sql_cache_saved_total_tokens: number | null;
  estimated_cost_usd: number | string | null;
  estimated_savings_usd: number | string | null;
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

export type AgentRunViewerPolicy = {
  can_view_sql: boolean;
};

export type SanitizedAgentRunForViewer = SanitizedAgentRun & {
  can_view_sql: boolean;
  sql_hidden: boolean;
  sql_preview: string | null;
};

export function normalizeComparableQuestion(question: string) {
  return question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function asOptionalInteger(value: number | null | undefined) {
  return value === undefined ? null : asInteger(value);
}

function asOptionalDecimal(value: number | null | undefined) {
  return value === undefined || value === null || !Number.isFinite(value) ? null : value;
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

function buildSqlPreview(run: SanitizedAgentRun) {
  const sql = run.sql_executed || run.sql_generated || "";
  const compact = sql.replace(/\s+/g, " ").trim();

  if (!compact) return null;

  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

export function sanitizeAgentRunForViewer(
  run: SanitizedAgentRun,
  policy: AgentRunViewerPolicy,
  options?: { includeFullSql?: boolean }
): SanitizedAgentRunForViewer {
  const canViewSql = Boolean(policy.can_view_sql);
  const includeFullSql = Boolean(options?.includeFullSql);

  return {
    ...run,
    can_view_sql: canViewSql,
    sql_hidden: !canViewSql,
    sql_generated: canViewSql && includeFullSql ? run.sql_generated : "",
    sql_executed: canViewSql && includeFullSql ? run.sql_executed : "",
    sql_preview: canViewSql ? buildSqlPreview(run) : null
  };
}

async function getRunById(id: string, organizationId?: string) {
  const result = await db.query<AgentRunRow>(
    `
    SELECT *
    FROM public.ai_agent_runs
    WHERE id = $1
    ${organizationId ? "AND organization_id = $2::uuid" : ""}
    LIMIT 1
    `,
    organizationId ? [id, organizationId] : [id]
  );

  return result.rows[0] ?? null;
}

export async function getAgentRunById(id: string, organizationId?: string) {
  const run = await getRunById(id, organizationId);
  return run ? sanitizeAgentRun(run) : null;
}

export async function findLatestComparableLlmRunForCacheSavings(params: {
  perguntaNormalizada?: string | null;
  detectedIntent?: string | null;
  currentRunId?: string | null;
  currentCreatedAt?: string | null;
  sqlGenerated?: string | null;
  organizationId?: string;
}) {
  if (!params.perguntaNormalizada && !params.detectedIntent && !params.sqlGenerated) {
    return null;
  }

  const filters = [
    "COALESCE(sql_cache_hit, false) = false",
    "llm_total_tokens IS NOT NULL",
    "llm_total_tokens > 0",
    "execution_status IN ('generated', 'executed')"
  ];
  const values: string[] = [];

  if (params.currentRunId) {
    values.push(params.currentRunId);
    filters.push(`id <> $${values.length}::uuid`);
  }

  if (params.currentCreatedAt) {
    values.push(params.currentCreatedAt);
    filters.push(`created_at < $${values.length}::timestamptz`);
  }

  if (params.detectedIntent) {
    values.push(params.detectedIntent);
    filters.push(`detected_intent = $${values.length}`);
  }

  if (params.perguntaNormalizada) {
    values.push(params.perguntaNormalizada);
    filters.push(`pergunta_normalizada = $${values.length}`);
  }

  if (params.sqlGenerated && !params.perguntaNormalizada && !params.detectedIntent) {
    values.push(params.sqlGenerated);
    filters.push(`sql_generated = $${values.length}`);
  }

  if (params.organizationId) {
    values.push(params.organizationId);
    filters.push(`organization_id = $${values.length}::uuid`);
  }

  const result = await db.query<AgentRunRow>(
    `
    SELECT *
    FROM public.ai_agent_runs
    WHERE ${filters.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT 1
    `,
    values
  );

  const run = result.rows[0];
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
  const tenant = getSessionTenantIdentity(input.session);
  if (tenant.status === "required") {
    throw new TenantIdentityRequiredError();
  }
  const persistOrganization = tenant.status === "ready";
  const result = await db.query<AgentRunRow>(
    `
    INSERT INTO public.ai_agent_runs (
      request_id,
      run_id,
      user_id,
      user_email,
      user_name,
      user_profile,
      ${persistOrganization ? "organization_id," : ""}
      auth_source,
      pergunta,
      pergunta_normalizada,
      source,
      ip_address,
      user_agent,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, ${persistOrganization ? "$7, " : ""}$${persistOrganization ? 8 : 7}, $${persistOrganization ? 9 : 8}, $${persistOrganization ? 10 : 9}, $${persistOrganization ? 11 : 10}, $${persistOrganization ? 12 : 11}, $${persistOrganization ? 13 : 12}, $${persistOrganization ? 14 : 13}::jsonb)
    RETURNING *
    `,
    [
      input.requestId,
      runId,
      input.session.userId,
      input.session.email,
      input.session.name,
      input.session.userProfile,
      ...(persistOrganization ? [tenant.organizationId] : []),
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
  llmProvider?: string | null;
  llmModel?: string | null;
  llmPromptTokens?: number | null;
  llmCompletionTokens?: number | null;
  llmTotalTokens?: number | null;
  llmUsageSource?: string | null;
  sqlCacheHit?: boolean | null;
  sqlCacheSourceRunId?: string | null;
  sqlCacheSavedPromptTokens?: number | null;
  sqlCacheSavedCompletionTokens?: number | null;
  sqlCacheSavedTotalTokens?: number | null;
  estimatedCostUsd?: number | null;
  estimatedSavingsUsd?: number | null;
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
      llm_provider = COALESCE($11, llm_provider),
      llm_model = COALESCE($12, llm_model),
      llm_prompt_tokens = COALESCE($13, llm_prompt_tokens),
      llm_completion_tokens = COALESCE($14, llm_completion_tokens),
      llm_total_tokens = COALESCE($15, llm_total_tokens),
      llm_usage_source = COALESCE($16, llm_usage_source),
      sql_cache_hit = COALESCE($17, sql_cache_hit),
      sql_cache_source_run_id = COALESCE($18::uuid, sql_cache_source_run_id),
      sql_cache_saved_prompt_tokens = COALESCE($19, sql_cache_saved_prompt_tokens),
      sql_cache_saved_completion_tokens = COALESCE($20, sql_cache_saved_completion_tokens),
      sql_cache_saved_total_tokens = COALESCE($21, sql_cache_saved_total_tokens),
      estimated_cost_usd = COALESCE($22, estimated_cost_usd),
      estimated_savings_usd = COALESCE($23, estimated_savings_usd),
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
      JSON.stringify(sanitizeJsonRecord(input.metadata)),
      input.llmProvider ?? null,
      input.llmModel ?? null,
      asOptionalInteger(input.llmPromptTokens),
      asOptionalInteger(input.llmCompletionTokens),
      asOptionalInteger(input.llmTotalTokens),
      input.llmUsageSource ?? null,
      input.sqlCacheHit ?? null,
      input.sqlCacheSourceRunId ?? null,
      asOptionalInteger(input.sqlCacheSavedPromptTokens),
      asOptionalInteger(input.sqlCacheSavedCompletionTokens),
      asOptionalInteger(input.sqlCacheSavedTotalTokens),
      asOptionalDecimal(input.estimatedCostUsd),
      asOptionalDecimal(input.estimatedSavingsUsd)
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
  llmProvider?: string | null;
  llmModel?: string | null;
  llmPromptTokens?: number | null;
  llmCompletionTokens?: number | null;
  llmTotalTokens?: number | null;
  llmUsageSource?: string | null;
  sqlCacheHit?: boolean | null;
  sqlCacheSourceRunId?: string | null;
  sqlCacheSavedPromptTokens?: number | null;
  sqlCacheSavedCompletionTokens?: number | null;
  sqlCacheSavedTotalTokens?: number | null;
  estimatedCostUsd?: number | null;
  estimatedSavingsUsd?: number | null;
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
      llm_provider = COALESCE($15, llm_provider),
      llm_model = COALESCE($16, llm_model),
      llm_prompt_tokens = COALESCE($17, llm_prompt_tokens),
      llm_completion_tokens = COALESCE($18, llm_completion_tokens),
      llm_total_tokens = COALESCE($19, llm_total_tokens),
      llm_usage_source = COALESCE($20, llm_usage_source),
      sql_cache_hit = COALESCE($21, sql_cache_hit),
      sql_cache_source_run_id = COALESCE($22::uuid, sql_cache_source_run_id),
      sql_cache_saved_prompt_tokens = COALESCE($23, sql_cache_saved_prompt_tokens),
      sql_cache_saved_completion_tokens = COALESCE($24, sql_cache_saved_completion_tokens),
      sql_cache_saved_total_tokens = COALESCE($25, sql_cache_saved_total_tokens),
      estimated_cost_usd = COALESCE($26, estimated_cost_usd),
      estimated_savings_usd = COALESCE($27, estimated_savings_usd),
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
      JSON.stringify(sanitizeJsonRecord(input.metadata)),
      input.llmProvider ?? null,
      input.llmModel ?? null,
      asOptionalInteger(input.llmPromptTokens),
      asOptionalInteger(input.llmCompletionTokens),
      asOptionalInteger(input.llmTotalTokens),
      input.llmUsageSource ?? null,
      input.sqlCacheHit ?? null,
      input.sqlCacheSourceRunId ?? null,
      asOptionalInteger(input.sqlCacheSavedPromptTokens),
      asOptionalInteger(input.sqlCacheSavedCompletionTokens),
      asOptionalInteger(input.sqlCacheSavedTotalTokens),
      asOptionalDecimal(input.estimatedCostUsd),
      asOptionalDecimal(input.estimatedSavingsUsd)
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
  llmProvider?: string | null;
  llmModel?: string | null;
  llmPromptTokens?: number | null;
  llmCompletionTokens?: number | null;
  llmTotalTokens?: number | null;
  llmUsageSource?: string | null;
  sqlCacheHit?: boolean | null;
  sqlCacheSourceRunId?: string | null;
  sqlCacheSavedPromptTokens?: number | null;
  sqlCacheSavedCompletionTokens?: number | null;
  sqlCacheSavedTotalTokens?: number | null;
  estimatedCostUsd?: number | null;
  estimatedSavingsUsd?: number | null;
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
      llm_provider = COALESCE($9, llm_provider),
      llm_model = COALESCE($10, llm_model),
      llm_prompt_tokens = COALESCE($11, llm_prompt_tokens),
      llm_completion_tokens = COALESCE($12, llm_completion_tokens),
      llm_total_tokens = COALESCE($13, llm_total_tokens),
      llm_usage_source = COALESCE($14, llm_usage_source),
      sql_cache_hit = COALESCE($15, sql_cache_hit),
      sql_cache_source_run_id = COALESCE($16::uuid, sql_cache_source_run_id),
      sql_cache_saved_prompt_tokens = COALESCE($17, sql_cache_saved_prompt_tokens),
      sql_cache_saved_completion_tokens = COALESCE($18, sql_cache_saved_completion_tokens),
      sql_cache_saved_total_tokens = COALESCE($19, sql_cache_saved_total_tokens),
      estimated_cost_usd = COALESCE($20, estimated_cost_usd),
      estimated_savings_usd = COALESCE($21, estimated_savings_usd),
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
      JSON.stringify(sanitizeJsonRecord(input.metadata)),
      input.llmProvider ?? null,
      input.llmModel ?? null,
      asOptionalInteger(input.llmPromptTokens),
      asOptionalInteger(input.llmCompletionTokens),
      asOptionalInteger(input.llmTotalTokens),
      input.llmUsageSource ?? null,
      input.sqlCacheHit ?? null,
      input.sqlCacheSourceRunId ?? null,
      asOptionalInteger(input.sqlCacheSavedPromptTokens),
      asOptionalInteger(input.sqlCacheSavedCompletionTokens),
      asOptionalInteger(input.sqlCacheSavedTotalTokens),
      asOptionalDecimal(input.estimatedCostUsd),
      asOptionalDecimal(input.estimatedSavingsUsd)
    ]
  );

  return getAgentRunById(input.agentRunId);
}

export async function listAgentRuns(input: {
  status?: string;
  userEmail?: string;
  viewerUserId?: string;
  viewerEmail?: string;
  intent?: string;
  organizationId?: string;
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

  if (input.viewerUserId || input.viewerEmail) {
    const scopedFilters: string[] = [];

    if (input.viewerUserId) {
      values.push(input.viewerUserId);
      scopedFilters.push(`user_id = $${values.length}::uuid`);
    }

    if (input.viewerEmail) {
      values.push(input.viewerEmail.toLowerCase());
      scopedFilters.push(`lower(coalesce(user_email, '')) = $${values.length}`);
    }

    filters.push(`(${scopedFilters.join(" OR ")})`);
  }

  if (input.intent) {
    values.push(input.intent);
    filters.push(`detected_intent = $${values.length}`);
  }

  if (input.organizationId) {
    values.push(input.organizationId);
    filters.push(`organization_id = $${values.length}::uuid`);
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
