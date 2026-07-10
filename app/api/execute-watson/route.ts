import { NextResponse } from "next/server";
import {
  createAgentRun,
  getAgentRunById,
  markAgentRunBlocked,
  updateAgentRunExecution
} from "@/lib/agent-runs";
import { N8N_WATSON_ORCHESTRATE_ENDPOINT } from "@/lib/n8n-endpoint";
import {
  buildPolicyDeniedResponse,
  enforceCanExecuteSql,
  enforceSqlTablePolicy
} from "@/lib/profile-policy";
import { getRequestMetadata, requireAgentSession } from "@/lib/server-auth";
import { logger } from "@/lib/server-logger";
import type { ExecuteWatsonResponse } from "@/lib/types";
import { normalizeWatsonResult } from "@/lib/watson-result-normalization";

export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function errorResponse(message: string, status: number): NextResponse<ExecuteWatsonResponse> {
  return NextResponse.json(
    {
      success: false,
      query_id: "",
      execution_time_ms: null,
      row_count: 0,
      columns: [],
      data: [],
      raw: null,
      truncated: false,
      error_message: message,
      error: message
    },
    { status }
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const { session, response: unauthorizedResponse } = await requireAgentSession();

  if (unauthorizedResponse || !session) {
    logger.warn("execute_watson.unauthorized", { requestId });
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    logger.warn("execute_watson.invalid_json", { requestId });
    return errorResponse("JSON invalido na requisicao.", 400);
  }

  const record = isRecord(body) ? body : {};
  const pergunta = asString(record.pergunta).trim();
  const receivedSql = asString(record.sql).trim();
  const requestedRunId =
    asString(record.agent_run_id).trim() || asString(record.run_id).trim();
  const agentRunId = isUuid(requestedRunId) ? requestedRunId : null;

  if (!pergunta) {
    logger.warn("execute_watson.empty_question", { requestId });
    return errorResponse("Informe a pergunta original para executar no Watson.", 400);
  }

  const existingRun = agentRunId ? await getAgentRunById(agentRunId) : null;

  if (agentRunId && !existingRun) {
    return errorResponse("Histórico de execução não encontrado.", 404);
  }

  if (
    existingRun &&
    session.userProfile !== "admin" &&
    existingRun.user_id !== session.userId
  ) {
    return errorResponse("Histórico de execução não pertence ao usuário logado.", 403);
  }

  const sql = receivedSql || existingRun?.sql_generated?.trim() || "";

  if (!sql) {
    logger.warn("execute_watson.empty_sql", { requestId });
    return errorResponse("Gere uma SQL antes de executar no Watson.", 400);
  }

  const webhookUrl = N8N_WATSON_ORCHESTRATE_ENDPOINT;
  const executePolicy = await enforceCanExecuteSql(session.userProfile);
  const activeSession = session;

  async function ensureBlockedRun(reason: string, metadata: Record<string, unknown>) {
    if (agentRunId) {
      await markAgentRunBlocked({
        agentRunId,
        executionError: reason,
        sqlExecuted: sql || null,
        metadata
      });
      return agentRunId;
    }

    const requestMetadata = await getRequestMetadata();
    const blockedRun = await createAgentRun({
      requestId,
      session: activeSession,
      pergunta,
      metadata: requestMetadata,
      extraMetadata: {
        operation: "execute_watson_blocked_without_run_id"
      }
    });

    await markAgentRunBlocked({
      agentRunId: blockedRun.id,
      executionError: reason,
      sqlExecuted: sql || null,
      metadata
    });

    return blockedRun.id;
  }

  if (!executePolicy.allowed) {
    const blockedRunId = await ensureBlockedRun(executePolicy.reason, {
      policy_reason: {
        profile: session.userProfile,
        reason: executePolicy.reason
      }
    });

    return NextResponse.json(
      {
        ...buildPolicyDeniedResponse(executePolicy.reason),
        query_id: "",
        execution_time_ms: null,
        row_count: 0,
        columns: [],
        data: [],
        raw: null,
        truncated: false,
        error_message: executePolicy.reason,
        agent_run_id: blockedRunId,
        run_id: blockedRunId
      } satisfies ExecuteWatsonResponse,
      { status: 403 }
    );
  }

  const tablePolicy = enforceSqlTablePolicy(executePolicy.policy, sql);
  const noTablesAllowed =
    tablePolicy.reason === "no_allowed_tables_detected" && session.userProfile === "admin";

  if (!tablePolicy.allowed && !noTablesAllowed) {
    const blockedRunId = await ensureBlockedRun(tablePolicy.reason, {
      policy_reason: {
        profile: session.userProfile,
        blocked_table: tablePolicy.blockedTable,
        extracted_tables: tablePolicy.extractedTables,
        allowed_tables: executePolicy.policy.allowed_tables,
        denied_tables: executePolicy.policy.denied_tables
      }
    });

    return NextResponse.json(
      {
        ...buildPolicyDeniedResponse(tablePolicy.reason),
        query_id: "",
        execution_time_ms: null,
        row_count: 0,
        columns: [],
        data: [],
        raw: null,
        truncated: false,
        error_message: tablePolicy.reason,
        agent_run_id: blockedRunId,
        run_id: blockedRunId
      } satisfies ExecuteWatsonResponse,
      { status: 403 }
    );
  }

  const internalWebhookToken = process.env.N8N_INTERNAL_WEBHOOK_TOKEN || "";

  if (!internalWebhookToken) {
    logger.error("execute_watson.internal_token_missing", {
      requestId,
      userId: session.userId,
      userProfile: session.userProfile
    });

    return errorResponse("Token interno do serviço de orquestração não configurado.", 500);
  }

  try {
    logger.info("execute_watson.request_started", {
      requestId,
      questionLength: pergunta.length,
      sqlLength: sql.length
    });

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Internal-Token": internalWebhookToken
      },
      body: JSON.stringify({
        modo: "executar_sql",
        pergunta,
        limit: 100,
        sql,
        request_id: requestId,
        ...(agentRunId
          ? {
              run_id: agentRunId,
              agent_run_id: agentRunId
            }
          : {}),
        user_id: session.userId,
        user_email: session.email,
        user_name: session.name,
        user_profile: session.userProfile,
        auth_source: "database_session"
      }),
      cache: "no-store"
    });

    const text = await webhookResponse.text();
    let raw: unknown = text;

    if (text) {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = { result: text };
      }
    }

    const normalized = normalizeWatsonResult(raw);

    if (!webhookResponse.ok) {
      logger.warn("execute_watson.webhook_non_ok", {
        requestId,
        status: webhookResponse.status
      });
      if (agentRunId) {
        await updateAgentRunExecution({
          id: agentRunId,
          sqlExecuted: sql,
          executionStatus: "failed",
          executionError: `O serviço de orquestração retornou status ${webhookResponse.status}.`,
          rowCount: normalized.row_count,
          columns: normalized.columns,
          data: normalized.data,
          executionTimeMs: normalized.execution_time_ms,
          totalTimeMs: Date.now() - startedAt,
          executorMode: "watson_orchestration",
          n8nStatusCode: webhookResponse.status,
          metadata: {
            truncated: normalized.truncated,
            query_id: normalized.query_id
          }
        });
      }
      return NextResponse.json(
        {
          ...normalized,
          ...(agentRunId
            ? {
                run_id: agentRunId,
                agent_run_id: agentRunId
              }
            : {}),
          success: false,
          error: `O serviço de orquestração retornou status ${webhookResponse.status}.`
        },
        { status: webhookResponse.status }
      );
    }

    logger.info("execute_watson.request_completed", {
      requestId,
      success: normalized.success,
      rowCount: normalized.row_count,
      hasQueryId: Boolean(normalized.query_id)
    });

    if (agentRunId) {
      await updateAgentRunExecution({
        id: agentRunId,
        sqlExecuted: sql,
        executionStatus: normalized.success ? "executed" : "failed",
        executionError: normalized.success
          ? null
          : normalized.error_message ?? normalized.error ?? "execution_failed",
        rowCount: normalized.row_count,
        columns: normalized.columns,
        data: normalized.data,
        executionTimeMs: normalized.execution_time_ms,
        totalTimeMs: Date.now() - startedAt,
        executorMode: "watson_orchestration",
        n8nStatusCode: webhookResponse.status,
        metadata: {
          truncated: normalized.truncated,
          query_id: normalized.query_id
        }
      });
    }

    return NextResponse.json({
      ...normalized,
      ...(agentRunId
        ? {
            run_id: agentRunId,
            agent_run_id: agentRunId
          }
        : {})
    });
  } catch (error) {
    logger.error("execute_watson.request_failed", {
      requestId,
      error: error instanceof Error ? error.name : "UnknownError"
    });
    if (agentRunId) {
      await updateAgentRunExecution({
        id: agentRunId,
        sqlExecuted: sql,
        executionStatus: "failed",
        executionError: error instanceof Error ? error.message : String(error),
        totalTimeMs: Date.now() - startedAt,
        executorMode: "watson_orchestration"
      });
    }
    return errorResponse(
      "Erro ao executar no Watson via serviço de orquestração. Verifique conectividade e logs do servidor.",
      502
    );
  }
}
