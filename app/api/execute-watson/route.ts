import { NextResponse } from "next/server";
import { N8N_WATSON_ORCHESTRATE_ENDPOINT } from "@/lib/n8n-endpoint";
import { requireAgentSession } from "@/lib/server-auth";
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
  const sql = asString(record.sql).trim();

  if (!pergunta) {
    logger.warn("execute_watson.empty_question", { requestId });
    return errorResponse("Informe a pergunta original para executar no Watson.", 400);
  }

  if (!sql) {
    logger.warn("execute_watson.empty_sql", { requestId });
    return errorResponse("Gere uma SQL antes de executar no Watson.", 400);
  }

  const webhookUrl = N8N_WATSON_ORCHESTRATE_ENDPOINT;

  try {
    logger.info("execute_watson.request_started", {
      requestId,
      questionLength: pergunta.length,
      sqlLength: sql.length
    });

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        modo: "executar_sql",
        pergunta,
        limit: 100,
        sql,
        request_id: requestId,
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
      return NextResponse.json(
        {
          ...normalized,
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

    return NextResponse.json(normalized);
  } catch (error) {
    logger.error("execute_watson.request_failed", {
      requestId,
      error: error instanceof Error ? error.name : "UnknownError"
    });
    return errorResponse(
      "Erro ao executar no Watson via serviço de orquestração. Verifique conectividade e logs do servidor.",
      502
    );
  }
}
