import { NextResponse } from "next/server";
import {
  createAgentRun,
  findLatestComparableLlmRunForCacheSavings,
  getAgentRunById,
  markAgentRunBlocked,
  updateAgentRunGeneratedSql
} from "@/lib/agent-runs";
import { normalizeGenerateSqlResponse } from "@/lib/generate-sql-normalization";
import {
  calculateEstimatedLlmCostUsd,
  calculateEstimatedSavingsUsd,
  extractLlmUsageFromResponse,
  normalizePositiveInteger
} from "@/lib/llm-usage";
import { N8N_WATSON_ORCHESTRATE_ENDPOINT } from "@/lib/n8n-endpoint";
import {
  buildPolicyDeniedResponse,
  enforceCanGenerateSql,
  enforceIntentPolicy,
  enforceSqlTablePolicy
} from "@/lib/profile-policy";
import { getRequestMetadata, requireAgentSession } from "@/lib/server-auth";
import { logger } from "@/lib/server-logger";
import { AGENT_VERSION, type GenerateSqlResponse } from "@/lib/types";

export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readIntentConfidence(raw: unknown): number | null {
  if (!isRecord(raw)) return null;

  const direct = asNumber(raw.intent_confidence);
  if (direct !== null) return direct;

  if (isRecord(raw.classificacao)) {
    const classified = asNumber(raw.classificacao.confidence);
    if (classified !== null) return classified;
  }

  if (isRecord(raw.metadata)) {
    return asNumber(raw.metadata.intent_confidence);
  }

  return null;
}

function readPath(root: unknown, path: string[]) {
  let current = root;

  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function firstStringPath(root: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = readPath(root, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function firstIntegerPath(root: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = normalizePositiveInteger(readPath(root, path));
    if (value !== null) return value;
  }

  return null;
}

function isUuid(value: string | null) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
  );
}

function detectSqlCacheHit(raw: unknown, normalizedCache: GenerateSqlResponse["cache"]) {
  const cacheStatus = firstStringPath(raw, [["cache", "status"]]);
  const cacheSource = firstStringPath(raw, [["cache", "source"], ["source"]]);
  const cacheHit = readPath(raw, ["cache", "hit"]);

  return (
    normalizedCache?.hit === true ||
    cacheHit === true ||
    cacheStatus === "hit" ||
    cacheSource === "cache"
  );
}

async function buildLlmPersistence(
  raw: unknown,
  cacheHit: boolean,
  comparable: {
    currentRunId: string;
    currentCreatedAt: string | null;
    perguntaNormalizada: string | null;
    detectedIntent: string | null;
    sqlGenerated: string | null;
  }
) {
  const usage = extractLlmUsageFromResponse(raw);
  const inputCostPer1M = process.env.LLM_INPUT_COST_PER_1M_TOKENS_USD;
  const outputCostPer1M = process.env.LLM_OUTPUT_COST_PER_1M_TOKENS_USD;
  const cacheSourceRunId = firstStringPath(raw, [
    ["cache", "source_run_id"],
    ["cache", "sourceRunId"],
    ["cache", "cached_run_id"],
    ["cache", "cachedRunId"],
    ["source_run_id"],
    ["cached_run_id"]
  ]);
  let savedPromptTokens = firstIntegerPath(raw, [
    ["cache", "saved_prompt_tokens"],
    ["cache", "savedPromptTokens"],
    ["sql_cache_saved_prompt_tokens"]
  ]);
  let savedCompletionTokens = firstIntegerPath(raw, [
    ["cache", "saved_completion_tokens"],
    ["cache", "savedCompletionTokens"],
    ["sql_cache_saved_completion_tokens"]
  ]);
  let savedTotalTokens = firstIntegerPath(raw, [
    ["cache", "saved_total_tokens"],
    ["cache", "savedTotalTokens"],
    ["sql_cache_saved_total_tokens"]
  ]);

  let resolvedCacheSourceRunId = isUuid(cacheSourceRunId) ? cacheSourceRunId : null;

  if (
    cacheHit &&
    resolvedCacheSourceRunId &&
    (savedPromptTokens === null || savedCompletionTokens === null || savedTotalTokens === null)
  ) {
    const sourceRun = await getAgentRunById(resolvedCacheSourceRunId);
    savedPromptTokens = savedPromptTokens ?? sourceRun?.llm_prompt_tokens ?? null;
    savedCompletionTokens = savedCompletionTokens ?? sourceRun?.llm_completion_tokens ?? null;
    savedTotalTokens = savedTotalTokens ?? sourceRun?.llm_total_tokens ?? null;
  }

  if (
    cacheHit &&
    (savedPromptTokens === null || savedCompletionTokens === null || savedTotalTokens === null)
  ) {
    const comparableRun = await findLatestComparableLlmRunForCacheSavings({
      perguntaNormalizada: comparable.perguntaNormalizada,
      detectedIntent: comparable.detectedIntent,
      currentRunId: comparable.currentRunId,
      currentCreatedAt: comparable.currentCreatedAt,
      sqlGenerated: comparable.sqlGenerated
    });

    if (comparableRun) {
      resolvedCacheSourceRunId = comparableRun.id;
      savedPromptTokens = savedPromptTokens ?? comparableRun.llm_prompt_tokens ?? null;
      savedCompletionTokens = savedCompletionTokens ?? comparableRun.llm_completion_tokens ?? null;
      savedTotalTokens = savedTotalTokens ?? comparableRun.llm_total_tokens ?? null;
    }
  }

  if (savedTotalTokens === null && savedPromptTokens !== null && savedCompletionTokens !== null) {
    savedTotalTokens = savedPromptTokens + savedCompletionTokens;
  }

  if (cacheHit) {
    return {
      llmProvider: usage.provider,
      llmModel: usage.model,
      llmPromptTokens: 0,
      llmCompletionTokens: 0,
      llmTotalTokens: 0,
      llmUsageSource: "sql_cache",
      sqlCacheHit: true,
      sqlCacheSourceRunId: resolvedCacheSourceRunId,
      sqlCacheSavedPromptTokens: savedPromptTokens,
      sqlCacheSavedCompletionTokens: savedCompletionTokens,
      sqlCacheSavedTotalTokens: savedTotalTokens,
      estimatedCostUsd: null,
      estimatedSavingsUsd: calculateEstimatedSavingsUsd({
        savedPromptTokens,
        savedCompletionTokens,
        inputCostPer1M,
        outputCostPer1M
      })
    };
  }

  return {
    llmProvider: usage.provider,
    llmModel: usage.model,
    llmPromptTokens: usage.promptTokens,
    llmCompletionTokens: usage.completionTokens,
    llmTotalTokens: usage.totalTokens,
    llmUsageSource: usage.source,
    sqlCacheHit: false,
    sqlCacheSourceRunId: null,
    sqlCacheSavedPromptTokens: null,
    sqlCacheSavedCompletionTokens: null,
    sqlCacheSavedTotalTokens: null,
    estimatedCostUsd: calculateEstimatedLlmCostUsd({
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      inputCostPer1M,
      outputCostPer1M
    }),
    estimatedSavingsUsd: null
  };
}

function buildErrorResponse(
  error: string,
  status = 400,
  raw: unknown = null,
  runIds?: { agentRunId: string; runId: string | null }
) {
  return NextResponse.json(
    {
      success: false,
      agent_version: AGENT_VERSION,
      detected_intent: "nao_informado",
      validation_status: "erro",
      sql: "",
      raw,
      ...(runIds
        ? {
            agent_run_id: runIds.agentRunId,
            run_id: runIds.runId ?? runIds.agentRunId
          }
        : {}),
      error
    } satisfies GenerateSqlResponse,
    { status }
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const webhookUrl = N8N_WATSON_ORCHESTRATE_ENDPOINT;

  const { session, response: unauthorizedResponse } = await requireAgentSession();

  if (unauthorizedResponse || !session) {
    logger.warn("generate_sql.unauthorized", {
      requestId
    });

    return (
      unauthorizedResponse ??
      NextResponse.json(
        {
          success: false,
          error: "unauthorized"
        },
        { status: 401 }
      )
    );
  }

  const internalWebhookToken = process.env.N8N_INTERNAL_WEBHOOK_TOKEN || "";

  if (!internalWebhookToken) {
    logger.error("generate_sql.internal_token_missing", {
      requestId,
      userId: session.userId,
      userProfile: session.userProfile
    });

    return buildErrorResponse(
      "Token interno do serviço de orquestração não configurado.",
      500
    );
  }

  if (!webhookUrl) {
    logger.error("generate_sql.webhook_url_missing", {
      requestId,
      userId: session.userId,
      userProfile: session.userProfile
    });

    return buildErrorResponse(
      "URL do serviço de orquestração não configurada.",
      500
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    logger.warn("generate_sql.invalid_json", {
      requestId,
      userId: session.userId,
      userProfile: session.userProfile
    });

    return buildErrorResponse("JSON invalido na requisicao.", 400);
  }

  const pergunta = isRecord(body) ? asString(body.pergunta).trim() : "";
  const requestedRunId =
    isRecord(body) ? asString(body.run_id).trim() || asString(body.agent_run_id).trim() : "";
  const requestOptions = isRecord(body) && isRecord(body.options) ? body.options : {};
  const useSqlCache = asBoolean(requestOptions.use_sql_cache) ?? false;

  if (!pergunta) {
    logger.warn("generate_sql.empty_question", {
      requestId,
      userId: session.userId,
      userProfile: session.userProfile
    });

    return buildErrorResponse("Informe uma pergunta para gerar SQL.", 400);
  }

  const requestMetadata = await getRequestMetadata();
  const agentRun = await createAgentRun({
    requestId,
    runId: requestedRunId || undefined,
    session,
    pergunta,
    metadata: requestMetadata,
    extraMetadata: {
      operation: "generate_sql",
      options: {
        use_sql_cache: useSqlCache
      }
    }
  });
  const generatePolicy = await enforceCanGenerateSql(session.userProfile);

  if (!generatePolicy.allowed) {
    await markAgentRunBlocked({
      agentRunId: agentRun.id,
      executionError: generatePolicy.reason,
      metadata: {
        policy_reason: {
          profile: session.userProfile,
          reason: generatePolicy.reason
        }
      }
    });

    return NextResponse.json(
      {
        ...buildPolicyDeniedResponse(generatePolicy.reason),
        agent_version: AGENT_VERSION,
        detected_intent: "nao_informado",
        validation_status: "erro",
        sql: "",
        raw: null,
        can_view_sql: false,
        sql_hidden: true,
        agent_run_id: agentRun.id,
        run_id: agentRun.run_id ?? agentRun.id
      } satisfies GenerateSqlResponse,
      { status: 403 }
    );
  }

  const policy = generatePolicy.policy;

  try {
    logger.info("generate_sql.request_started", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userName: session.name,
      userProfile: session.userProfile,
      questionLength: pergunta.length,
      useSqlCache
    });

    const webhookPayload = {
      pergunta,
      request_id: requestId,
      run_id: agentRun.run_id ?? agentRun.id,
      agent_run_id: agentRun.id,
      user_id: session.userId,
      user_email: session.email,
      user_name: session.name,
      user_profile: session.userProfile,
      auth_source: "database_session",
      options: {
        use_sql_cache: useSqlCache
      }
    };

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Internal-Token": internalWebhookToken
      },
      body: JSON.stringify(webhookPayload),
      cache: "no-store"
    });

    const text = await webhookResponse.text();

    if (!text.trim()) {
      logger.warn("generate_sql.webhook_empty_response", {
        requestId,
        userId: session.userId,
        userProfile: session.userProfile,
        status: webhookResponse.status
      });

      await updateAgentRunGeneratedSql({
        id: agentRun.id,
        validationStatus: "erro",
        executionStatus: "failed",
        executionError:
          "O serviço de orquestração retornou uma resposta vazia ao gerar SQL.",
        metadata: {
          n8n_status_code: webhookResponse.status
        }
      });

      return buildErrorResponse(
        "O serviço de orquestração retornou uma resposta vazia ao gerar SQL. Verifique a execução da orquestração.",
        502,
        null,
        { agentRunId: agentRun.id, runId: agentRun.run_id }
      );
    }

    let raw: unknown;

    try {
      raw = JSON.parse(text);
    } catch {
      raw = { resposta: text };
    }

    const normalized = normalizeGenerateSqlResponse(raw);

    const baseCache =
      normalized.cache ??
      (useSqlCache
        ? {
            enabled: true,
            hit: false,
            source: "metadata_not_returned"
          }
        : {
            enabled: false,
            hit: false,
            source: "disabled_by_user"
          });
    const sqlCacheHit = detectSqlCacheHit(raw, baseCache);
    const normalizedWithCache: GenerateSqlResponse = {
      ...normalized,
      cache: {
        ...baseCache,
        hit: sqlCacheHit
      }
    };
    const llmPersistence = await buildLlmPersistence(raw, sqlCacheHit, {
      currentRunId: agentRun.id,
      currentCreatedAt: agentRun.created_at,
      perguntaNormalizada: agentRun.pergunta_normalizada,
      detectedIntent: normalizedWithCache.detected_intent,
      sqlGenerated: normalizedWithCache.sql
    });

    if (!webhookResponse.ok) {
      logger.warn("generate_sql.webhook_non_ok", {
        requestId,
        userId: session.userId,
        userProfile: session.userProfile,
        status: webhookResponse.status
      });

      await updateAgentRunGeneratedSql({
        id: agentRun.id,
        detectedIntent: normalizedWithCache.detected_intent,
        intentConfidence: readIntentConfidence(raw),
        sqlGenerated: normalizedWithCache.sql,
        validationStatus: normalizedWithCache.validation_status,
        executionStatus: "failed",
        executionError:
          normalizedWithCache.error ||
          `O serviço de orquestração retornou status ${webhookResponse.status}.`,
        ...llmPersistence,
        metadata: {
          n8n_status_code: webhookResponse.status
        }
      });

      return NextResponse.json(
        {
          ...normalizedWithCache,
          run_id: agentRun.run_id ?? agentRun.id,
          agent_run_id: agentRun.id,
          success: false,
          error:
            normalizedWithCache.error ||
            `O serviço de orquestração retornou status ${webhookResponse.status}.`
        },
        { status: webhookResponse.status }
      );
    }

    const intentPolicy = enforceIntentPolicy(
      policy,
      normalizedWithCache.detected_intent
    );

    if (!intentPolicy.allowed) {
      await markAgentRunBlocked({
        agentRunId: agentRun.id,
        executionError: intentPolicy.reason,
        validationStatus: normalizedWithCache.validation_status,
        sqlGenerated: normalizedWithCache.sql,
        ...llmPersistence,
        metadata: {
          policy_reason: {
            profile: session.userProfile,
            intent: normalizedWithCache.detected_intent,
            message:
              "Seu perfil não possui permissão para consultar esse tipo de informação."
          }
        }
      });

      return NextResponse.json(
        {
          ...buildPolicyDeniedResponse(intentPolicy.reason),
          agent_version: normalizedWithCache.agent_version,
          detected_intent: normalizedWithCache.detected_intent,
          validation_status: normalizedWithCache.validation_status,
          sql: "",
          raw: null,
          can_view_sql: policy.can_view_sql,
          sql_hidden: true,
          agent_run_id: agentRun.id,
          run_id: agentRun.run_id ?? agentRun.id,
          cache: normalizedWithCache.cache
        } satisfies GenerateSqlResponse,
        { status: 403 }
      );
    }

    const tablePolicy = enforceSqlTablePolicy(policy, normalizedWithCache.sql);
    const noTablesAllowed =
      tablePolicy.reason === "no_allowed_tables_detected" && session.userProfile === "admin";

    if (!tablePolicy.allowed && !noTablesAllowed) {
      await markAgentRunBlocked({
        agentRunId: agentRun.id,
        executionError: tablePolicy.reason,
        detectedIntent: normalizedWithCache.detected_intent,
        validationStatus: normalizedWithCache.validation_status,
        sqlGenerated: normalizedWithCache.sql,
        ...llmPersistence,
        metadata: {
          policy_reason: {
            profile: session.userProfile,
            blocked_table: tablePolicy.blockedTable,
            extracted_tables: tablePolicy.extractedTables,
            allowed_tables: policy.allowed_tables,
            denied_tables: policy.denied_tables
          }
        }
      });

      return NextResponse.json(
        {
          ...buildPolicyDeniedResponse(tablePolicy.reason),
          agent_version: normalizedWithCache.agent_version,
          detected_intent: normalizedWithCache.detected_intent,
          validation_status: normalizedWithCache.validation_status,
          sql: "",
          raw: null,
          can_view_sql: policy.can_view_sql,
          sql_hidden: true,
          agent_run_id: agentRun.id,
          run_id: agentRun.run_id ?? agentRun.id,
          cache: normalizedWithCache.cache
        } satisfies GenerateSqlResponse,
        { status: 403 }
      );
    }

    if (!webhookResponse.ok) {
      logger.warn("generate_sql.webhook_non_ok", {
        requestId,
        userId: session.userId,
        userProfile: session.userProfile,
        status: webhookResponse.status
      });

      await updateAgentRunGeneratedSql({
        id: agentRun.id,
        detectedIntent: normalizedWithCache.detected_intent,
        intentConfidence: readIntentConfidence(raw),
        sqlGenerated: normalizedWithCache.sql,
        validationStatus: normalizedWithCache.validation_status,
        executionStatus: "failed",
        executionError:
          normalizedWithCache.error ||
          `O serviço de orquestração retornou status ${webhookResponse.status}.`,
        ...llmPersistence,
        metadata: {
          n8n_status_code: webhookResponse.status
        }
      });

      return NextResponse.json(
        {
          ...normalizedWithCache,
          run_id: agentRun.run_id ?? agentRun.id,
          agent_run_id: agentRun.id,
          success: false,
          error:
            normalizedWithCache.error ||
            `O serviço de orquestração retornou status ${webhookResponse.status}.`
        },
        { status: webhookResponse.status }
      );
    }

    logger.info("generate_sql.request_completed", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userName: session.name,
      userProfile: session.userProfile,
      success: normalizedWithCache.success,
      hasSql: Boolean(normalizedWithCache.sql),
      validationStatus: normalizedWithCache.validation_status,
      cacheEnabled: normalizedWithCache.cache?.enabled,
      cacheHit: normalizedWithCache.cache?.hit
    });

    await updateAgentRunGeneratedSql({
      id: agentRun.id,
      detectedIntent: normalizedWithCache.detected_intent,
      intentConfidence: readIntentConfidence(raw),
      sqlGenerated: normalizedWithCache.sql,
      validationStatus: normalizedWithCache.validation_status,
      executionStatus: normalizedWithCache.success ? "generated" : "failed",
      executionError: normalizedWithCache.success ? null : normalizedWithCache.error ?? null,
      ...llmPersistence,
      metadata: {
        cache: normalizedWithCache.cache,
        n8n_status_code: webhookResponse.status
      }
    });

    const responsePayload: GenerateSqlResponse = {
      ...normalizedWithCache,
      sql: policy.can_view_sql ? normalizedWithCache.sql : "",
      raw: policy.can_view_sql ? normalizedWithCache.raw : null,
      can_view_sql: policy.can_view_sql,
      sql_hidden: !policy.can_view_sql,
      run_id: agentRun.run_id ?? agentRun.id,
      agent_run_id: agentRun.id,
      sql_cache_saved_prompt_tokens: llmPersistence.sqlCacheSavedPromptTokens,
      sql_cache_saved_completion_tokens: llmPersistence.sqlCacheSavedCompletionTokens,
      sql_cache_saved_total_tokens: llmPersistence.sqlCacheSavedTotalTokens,
      estimated_savings_usd: llmPersistence.estimatedSavingsUsd
    };

    return NextResponse.json(responsePayload);
  } catch (error) {
    logger.error("generate_sql.request_failed", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    await updateAgentRunGeneratedSql({
      id: agentRun.id,
      validationStatus: "erro",
      executionStatus: "failed",
      executionError: error instanceof Error ? error.message : String(error)
    });

    return buildErrorResponse(
      "Erro ao acionar o serviço de orquestração. Verifique conectividade e logs do servidor.",
      502,
      null,
      { agentRunId: agentRun.id, runId: agentRun.run_id }
    );
  }
}
