import type { ExecuteWatsonResponse, ExecutiveSummaryResult, ResultRow } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isResultRow(value: unknown): value is ResultRow {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(
    (item) =>
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
  );
}

function normalizeRows(value: unknown): ResultRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isResultRow);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeExecutiveSummary(value: unknown): ExecutiveSummaryResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const paragraphs = normalizeStringArray(value.paragraphs);
  const highlights = normalizeStringArray(value.highlights);

  if (!paragraphs.length && !highlights.length) {
    return undefined;
  }

  return {
    title: asString(value.title).trim() || "Resumo executivo",
    paragraphs,
    highlights,
    warnings: normalizeStringArray(value.warnings),
    intent: asString(value.intent).trim() || undefined,
    generated_by: asString(value.generated_by).trim() || undefined,
    version: asString(value.version).trim() || undefined
  };
}

function inferColumns(rows: ResultRow[]): string[] {
  if (!rows.length) {
    return [];
  }

  return Object.keys(rows[0]);
}

export type NormalizedWatsonResult = ExecuteWatsonResponse & {
  inferred_columns: boolean;
};

export function normalizeWatsonResult(raw: unknown): NormalizedWatsonResult {
  const payload = Array.isArray(raw) ? raw[0] : raw;
  const record = isRecord(payload) ? payload : {};
  const result = isRecord(record.result) ? record.result : {};
  const data = normalizeRows(record.data ?? record.rows ?? result.data ?? result.rows);
  const columnsFromPayload = Array.isArray(record.columns)
    ? record.columns.filter((column): column is string => typeof column === "string")
    : [];
  const inferredColumns = columnsFromPayload.length ? [] : inferColumns(data);
  const columns = columnsFromPayload.length ? columnsFromPayload : inferredColumns;
  const rowCount = asNumber(record.row_count ?? record.rowCount) ?? data.length;
  const errorMessage =
    asString(record.error_message).trim() ||
    asString(record.errorMessage).trim() ||
    asString(record.message).trim() ||
    asString(record.error).trim() ||
    asString(result.error_message).trim() ||
    asString(result.errorMessage).trim();
  const relatorioExecutivo =
    normalizeExecutiveSummary(record.relatorio_executivo) ??
    normalizeExecutiveSummary(result.relatorio_executivo);
  const executiveSummary =
    normalizeExecutiveSummary(record.executive_summary) ??
    normalizeExecutiveSummary(result.executive_summary);
  const relatorioExecutivoMarkdown =
    asString(record.relatorio_executivo_markdown).trim() ||
    asString(result.relatorio_executivo_markdown).trim();

  return {
    success: Boolean(record.success ?? true),
    query_id:
      asString(record.query_id).trim() ||
      asString(record.queryId).trim() ||
      asString(result.query_id).trim() ||
      asString(result.queryId).trim(),
    execution_time_ms:
      asNumber(record.execution_time_ms ?? record.executionTimeMs) ??
      asNumber(result.execution_time_ms ?? result.executionTimeMs),
    row_count: rowCount,
    columns,
    data,
    raw,
    truncated: Boolean(record.truncated ?? result.truncated ?? false),
    error_message: errorMessage,
    relatorio_executivo: relatorioExecutivo,
    executive_summary: executiveSummary,
    relatorio_executivo_markdown: relatorioExecutivoMarkdown || undefined,
    error: errorMessage || undefined,
    inferred_columns: Boolean(!columnsFromPayload.length && inferredColumns.length)
  };
}
