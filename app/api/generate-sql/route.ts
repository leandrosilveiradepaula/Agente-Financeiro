import { NextResponse } from "next/server";
import { normalizeGenerateSqlResponse } from "@/lib/generate-sql-normalization";
import { N8N_WATSON_ORCHESTRATE_ENDPOINT } from "@/lib/n8n-endpoint";
import { requireAgentSession } from "@/lib/server-auth";
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

function buildErrorResponse(
  error: string,
  status = 400,
  raw: unknown = null
) {
  return NextResponse.json(
    {
      success: false,
      agent_version: AGENT_VERSION,
      detected_intent: "nao_informado",
      validation_status: "erro",
      sql: "",
      raw,
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

      return buildErrorResponse(
        "O serviço de orquestração retornou uma resposta vazia ao gerar SQL. Verifique a execução da orquestração.",
        502
      );
    }

    let raw: unknown;

    try {
      raw = JSON.parse(text);
    } catch {
      raw = { resposta: text };
    }

    const normalized = normalizeGenerateSqlResponse(raw);

    const normalizedWithCache: GenerateSqlResponse = {
      ...normalized,
      cache:
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
            })
    };

    if (!webhookResponse.ok) {
      logger.warn("generate_sql.webhook_non_ok", {
        requestId,
        userId: session.userId,
        userProfile: session.userProfile,
        status: webhookResponse.status
      });

      return NextResponse.json(
        {
          ...normalizedWithCache,
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

    return NextResponse.json(normalizedWithCache);
  } catch (error) {
    logger.error("generate_sql.request_failed", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    return buildErrorResponse(
      "Erro ao acionar o serviço de orquestração. Verifique conectividade e logs do servidor.",
      502
    );
  }
}
