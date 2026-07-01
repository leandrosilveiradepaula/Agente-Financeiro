import { NextResponse } from "next/server";
import { normalizeGenerateSqlResponse } from "@/lib/generate-sql-normalization";
import { N8N_WATSON_ORCHESTRATE_ENDPOINT } from "@/lib/n8n-endpoint";
import { logger } from "@/lib/server-logger";
import { AGENT_VERSION, type GenerateSqlResponse } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const webhookUrl = N8N_WATSON_ORCHESTRATE_ENDPOINT;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    logger.warn("generate_sql.invalid_json", { requestId });
    return NextResponse.json(
      {
        success: false,
        agent_version: AGENT_VERSION,
        detected_intent: "nao_informado",
        validation_status: "erro",
        sql: "",
        raw: null,
        error: "JSON invalido na requisicao."
      } satisfies GenerateSqlResponse,
      { status: 400 }
    );
  }

  const pergunta = isRecord(body) ? asString(body.pergunta).trim() : "";

  if (!pergunta) {
    logger.warn("generate_sql.empty_question", { requestId });
    return NextResponse.json(
      {
        success: false,
        agent_version: AGENT_VERSION,
        detected_intent: "nao_informado",
        validation_status: "erro",
        sql: "",
        raw: null,
        error: "Informe uma pergunta para gerar SQL."
      } satisfies GenerateSqlResponse,
      { status: 400 }
    );
  }

  try {
    logger.info("generate_sql.request_started", {
      requestId,
      questionLength: pergunta.length
    });

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ pergunta }),
      cache: "no-store"
    });

    const text = await webhookResponse.text();
    let raw: unknown = text;

    if (!text.trim()) {
      logger.warn("generate_sql.webhook_empty_response", {
        requestId,
        status: webhookResponse.status
      });
      return NextResponse.json(
        {
          success: false,
          agent_version: AGENT_VERSION,
          detected_intent: "nao_informado",
          validation_status: "erro",
          sql: "",
          raw: null,
          error:
            "Webhook n8n retornou resposta vazia ao gerar SQL. Verifique o fluxo de geração no n8n."
        } satisfies GenerateSqlResponse,
        { status: 502 }
      );
    }

    if (text) {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = { resposta: text };
      }
    }

    const normalized = normalizeGenerateSqlResponse(raw);

    if (!webhookResponse.ok) {
      logger.warn("generate_sql.webhook_non_ok", {
        requestId,
        status: webhookResponse.status
      });
      return NextResponse.json(
        {
          ...normalized,
          success: false,
          error: `Webhook n8n retornou status ${webhookResponse.status}.`
        },
        { status: webhookResponse.status }
      );
    }

    logger.info("generate_sql.request_completed", {
      requestId,
      success: normalized.success,
      hasSql: Boolean(normalized.sql),
      validationStatus: normalized.validation_status
    });

    return NextResponse.json(normalized);
  } catch (error) {
    logger.error("generate_sql.request_failed", {
      requestId,
      error: error instanceof Error ? error.name : "UnknownError"
    });
    return NextResponse.json(
      {
        success: false,
        agent_version: AGENT_VERSION,
        detected_intent: "nao_informado",
        validation_status: "erro",
        sql: "",
        raw: null,
        error: "Erro ao chamar webhook n8n. Verifique conectividade e logs do servidor."
      } satisfies GenerateSqlResponse,
      { status: 502 }
    );
  }
}
