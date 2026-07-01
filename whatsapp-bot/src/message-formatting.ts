import type { DuckLakeAgentResult, ResultRow, SavedWhatsAppReport } from "./types.js";

const DIMENSION_COLUMNS = new Set([
  "conta_contabil",
  "nk_conta_contabil",
  "grupo_dre",
  "subgrupo",
  "marca",
  "setor",
  "centro_custo",
  "tipo_impacto",
  "tipo_variacao",
  "status_rol",
  "status_orcamento"
]);

export function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function truncateText(text: string, limit = 700) {
  const normalized = normalizeText(text);
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatBRL(value: number) {
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(value));

  return value < 0 ? `-${formatted}` : formatted;
}

export function formatPercent(value: number) {
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;

  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(normalized)}%`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

export function formatValue(column: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const normalizedColumn = column.trim().toLowerCase();
  const text = truncateText(String(value), 80);

  if (DIMENSION_COLUMNS.has(normalizedColumn)) {
    return text;
  }

  const numericValue = parseNumber(value);

  if (normalizedColumn.startsWith("ranking_") || normalizedColumn.includes("ranking")) {
    return numericValue === null ? text : formatNumber(Math.round(numericValue));
  }

  if (normalizedColumn.endsWith("_rs")) {
    return numericValue === null ? text : formatBRL(numericValue);
  }

  if (normalizedColumn.includes("perc") || normalizedColumn.endsWith("_pct")) {
    return numericValue === null ? text : formatPercent(numericValue);
  }

  return numericValue !== null && typeof value === "number" ? formatNumber(numericValue) : text;
}

function configuredMessageLimit() {
  const parsed = Number(process.env.MAX_WHATSAPP_MESSAGE_LENGTH);
  return Number.isFinite(parsed) && parsed > 1000 ? parsed : 3500;
}

function formatPreviewTable(columns: string[], rows: ResultRow[], maxRows: number) {
  const tableColumns = columns.slice(0, 4);
  const tableRows = rows.slice(0, maxRows);

  if (!tableColumns.length || !tableRows.length) {
    return "Sem previa tabular.";
  }

  return tableRows
    .map((row, index) => {
      const values = tableColumns
        .map((column) => `${column}: ${formatValue(column, row[column])}`)
        .join(" | ");
      return `${index + 1}. ${values}`;
    })
    .join("\n");
}

export function buildMarkdownReport({
  question,
  summary,
  queryId,
  rowCount,
  executionTimeMs,
  columns,
  dataPreview
}: {
  question: string;
  summary: { paragraphs: string[]; highlights: string[]; warnings?: string[]; intent?: string };
  queryId?: string;
  rowCount?: number;
  executionTimeMs?: number | null;
  columns: string[];
  dataPreview: ResultRow[];
}) {
  const tableColumns = columns.slice(0, 5);
  const rows = dataPreview.slice(0, 5);
  const table =
    tableColumns.length && rows.length
      ? [
          tableColumns.join(" | "),
          tableColumns.map(() => "---").join(" | "),
          ...rows.map((row) =>
            tableColumns.map((column) => formatValue(column, row[column])).join(" | ")
          )
        ].join("\n")
      : "Sem previa tabular.";

  return `# Agente SQL Financeiro DuckLake - Relatorio Executivo

## Pergunta
${question}

## Metadados
- Query ID: ${queryId || "Nao informado"}
- Intencao: ${summary.intent || "Nao informada"}
- Linhas: ${rowCount ?? "Nao informado"}
- Tempo: ${
    executionTimeMs === null || executionTimeMs === undefined ? "Nao informado" : `${executionTimeMs} ms`
  }

## Resumo executivo
${summary.paragraphs.join("\n\n")}

## Destaques
${summary.highlights.map((highlight) => `- ${highlight}`).join("\n")}

${
  summary.warnings?.length
    ? `## Observacoes e alertas\n${summary.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
    : ""
}

## Tabela resumida
${table}
`;
}

export function formatWhatsAppMarkdown(markdown: string) {
  const limit = configuredMessageLimit();
  if (markdown.length <= limit) {
    return markdown;
  }

  return `${markdown.slice(0, Math.max(0, limit - 130)).trimEnd()}

Markdown truncado para o WhatsApp. O conteudo completo permanece disponivel no relatorio salvo ou na interface.`;
}

export function formatWhatsAppReport(result: DuckLakeAgentResult) {
  const { question, summary, queryId, rowCount, executionTimeMs, columns, data } = result;
  const highlights = summary.highlights.slice(0, 3).map((item, index) => `${index + 1}. ${truncateText(item, 260)}`);
  const warnings = summary.warnings?.slice(0, 3).map((item) => `- ${truncateText(item, 260)}`) ?? [];
  const metadata = [
    `- Intencao: ${result.intent || summary.intent || "nao_informada"}`,
    `- Query ID: ${queryId || "nao_informado"}`,
    `- Linhas: ${rowCount ?? "nao_informado"}`,
    `- Tempo: ${executionTimeMs === null || executionTimeMs === undefined ? "nao_informado" : `${executionTimeMs} ms`}`
  ].join("\n");

  const main = [
    "*Agente SQL Financeiro DuckLake*",
    "*Relatorio Executivo*",
    "",
    "*Pergunta*",
    truncateText(question, 300),
    "",
    "*Metadados*",
    metadata,
    "",
    "*Resumo*",
    truncateText(summary.paragraphs.join("\n\n"), 900),
    "",
    "*Destaques*",
    highlights.length ? highlights.join("\n") : "Sem destaques informados.",
    warnings.length ? `\n*Observacoes*\n${warnings.join("\n")}` : "",
    "",
    "*Tabela resumida*",
    formatPreviewTable(columns, data, 3),
    "",
    "Responda:",
    "salvar - salvar relatorio",
    "markdown - receber relatorio em Markdown",
    "meus relatorios - listar salvos",
    "ajuda - comandos"
  ]
    .filter(Boolean)
    .join("\n");

  const limit = configuredMessageLimit();
  if (main.length <= limit) {
    return main;
  }

  const compact = [
    "*Agente SQL Financeiro DuckLake*",
    "*Relatorio Executivo*",
    "",
    "*Pergunta*",
    truncateText(question, 240),
    "",
    "*Metadados*",
    metadata,
    "",
    "*Resumo*",
    truncateText(summary.paragraphs.join("\n\n"), 900),
    "",
    "*Destaques*",
    highlights.slice(0, 2).join("\n") || "Sem destaques informados.",
    warnings.length ? `\n*Observacoes*\n${warnings.slice(0, 2).join("\n")}` : "",
    "",
    "Tabela resumida omitida para respeitar o limite do WhatsApp.",
    "Responda: salvar, markdown, meus relatorios ou ajuda."
  ]
    .filter(Boolean)
    .join("\n");

  return compact.length <= limit ? compact : compact.slice(0, limit).trimEnd();
}

export function formatSavedReportsList(reports: SavedWhatsAppReport[]) {
  if (!reports.length) {
    return "Nao encontrei relatorios salvos para este numero.";
  }

  const items = reports.map((report, index) => {
    const createdAt = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo"
    }).format(new Date(report.createdAt));

    return `${index + 1}. ${createdAt}
Pergunta: ${truncateText(report.question, 90)}
Query ID: ${report.queryId || "nao informado"}
Intencao: ${report.summary.intent || "nao informada"}`;
  });

  return `*Meus relatorios salvos*

${items.join("\n\n")}

Para reenviar o ultimo markdown, envie:
markdown`;
}
