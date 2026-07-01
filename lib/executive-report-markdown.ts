import type { ExecutiveReportMetadata } from "@/lib/exportExecutivePdf";
import type { ExecutiveSummaryResult } from "@/lib/types";

export type ExecutiveMarkdownPayload = {
  question: string;
  sql: string;
  metadata: ExecutiveReportMetadata;
  executiveSummary: ExecutiveSummaryResult;
  includeSql?: boolean;
};

export function buildExecutiveReportMarkdown({
  question,
  sql,
  metadata,
  executiveSummary,
  includeSql = true
}: ExecutiveMarkdownPayload) {
  const sqlSection = includeSql
    ? `## SQL
\`\`\`sql
${sql || "-- SQL não informada"}
\`\`\`

`
    : "";

  return `# Agente SQL Financeiro DuckLake — Relatório Executivo

## Pergunta
${question || "Pergunta não informada."}

## Metadados
- Versão: ${metadata.agent_version || "Não informada"}
- Intenção: ${metadata.detected_intent || "Não informada"}
- Validação: ${metadata.validation_status || "Não informada"}
- Query ID: ${metadata.query_id || "Não informado"}
- Tempo: ${
    metadata.execution_time_ms === null || metadata.execution_time_ms === undefined
      ? "Não informado"
      : `${metadata.execution_time_ms} ms`
  }
- Linhas: ${metadata.row_count ?? "Não informado"}

## Resumo executivo
${executiveSummary.paragraphs.join("\n\n")}

## Destaques
${executiveSummary.highlights.map((highlight) => `- ${highlight}`).join("\n")}

${
  executiveSummary.warnings?.length
    ? `## Observações e alertas\n${executiveSummary.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
    : ""
}

${sqlSection}## Observação
Resultado completo disponível na tabela da interface.
`;
}

export function formatDateForReportFilename(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}-${pad(date.getMinutes())}`;
}

export function sanitizeReportFilenamePart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "sem-query-id";
}

export function createExecutiveReportMarkdownFilename(queryId?: string, date = new Date()) {
  return `agente-sql-ducklake-relatorio-${formatDateForReportFilename(
    date
  )}-${sanitizeReportFilenamePart(queryId || "sem-query-id")}.md`;
}

export function downloadMarkdownFile(markdown: string, filename: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
