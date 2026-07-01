import { AGENT_VERSION, type GenerateSqlResponse } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

const SQL_FIELDS = [
  "query_para_copiar",
  "sql",
  "query",
  "resposta"
] as const;

const DETECTED_INTENT_PATHS = [
  ["detected_intent"],
  ["intencao"],
  ["intent"],
  ["classificacao", "intent"],
  ["plano", "detected_intent"],
  ["plano", "intencao"],
  ["metadata", "detected_intent"]
];

const VALIDATION_STATUS_PATHS = [
  ["validation_status"],
  ["status_validacao"],
  ["validacao", "status"],
  ["sql_validation", "status"],
  ["validation", "status"],
  ["aprovado"],
  ["sql_aprovada"]
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getPath(payload: unknown, path: string[]): unknown {
  let current = payload;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function toStatusValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "aprovado" : "erro";
  }

  return asString(value).trim();
}

function firstStringByPath(payload: unknown, paths: string[][]): string {
  for (const path of paths) {
    const value = asString(getPath(payload, path)).trim();

    if (value) {
      return value;
    }
  }

  return "";
}

function firstValidationStatusByPath(payload: unknown): string {
  for (const path of VALIDATION_STATUS_PATHS) {
    const value = toStatusValue(getPath(payload, path));

    if (value) {
      return value;
    }
  }

  return "";
}

function findSql(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  for (const field of SQL_FIELDS) {
    const value = asString(payload[field]).trim();

    if (value) {
      return value;
    }
  }

  if (isRecord(payload.entrega_watson)) {
    return asString(payload.entrega_watson.query_para_copiar).trim();
  }

  return "";
}

export function normalizeGenerateSqlResponse(raw: unknown): GenerateSqlResponse {
  const payload = Array.isArray(raw) ? raw[0] : raw;
  const record = isRecord(payload) ? payload : {};
  const sql = findSql(payload);
  const success = Boolean(record.success ?? sql);
  const explicitValidationStatus = firstValidationStatusByPath(payload);

  return {
    success,
    agent_version: asString(record.agent_version).trim() || AGENT_VERSION,
    detected_intent: firstStringByPath(payload, DETECTED_INTENT_PATHS) || "nao_informado",
    validation_status:
      explicitValidationStatus ||
      (success && sql ? "aprovado" : success ? "nao_informado" : "erro"),
    sql,
    raw
  };
}
