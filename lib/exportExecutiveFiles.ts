import type { ExecutiveSummaryResult, ResultRow } from "@/lib/types";

export type ExecutiveExportPayload = {
  question: string;
  columns: string[];
  data: ResultRow[];
  rowCount: number;
  success: boolean;
  executionTimeMs?: number | null;
  detectedIntent?: string;
  executiveSummary?: ExecutiveSummaryResult | null;
  generatedAt?: Date;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatExecutiveExportTimestamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}`;
}

export function createExecutiveExportFilename(
  extension: "pdf" | "xlsx" | "csv",
  date = new Date()
) {
  return `grupo-horizonte-analise-financeira-${formatExecutiveExportTimestamp(date)}.${extension}`;
}

function cellToString(value: ResultRow[string]) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function escapeCsvValue(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function buildExecutiveCsv(columns: string[], data: ResultRow[]) {
  return [
    columns.map(escapeCsvValue).join(","),
    ...data.map((row) =>
      columns.map((column) => escapeCsvValue(cellToString(row[column]))).join(",")
    )
  ].join("\n");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportExecutiveCsv(columns: string[], data: ResultRow[], date = new Date()) {
  downloadBlob(
    new Blob([`\uFEFF${buildExecutiveCsv(columns, data)}`], {
      type: "text/csv;charset=utf-8"
    }),
    createExecutiveExportFilename("csv", date)
  );
}

function executiveSummaryText(summary?: ExecutiveSummaryResult | null) {
  if (!summary) {
    return "";
  }

  return [
    ...summary.paragraphs,
    ...summary.highlights,
    ...(summary.warnings ?? [])
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function exportExecutiveXlsx(payload: ExecutiveExportPayload) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const generatedAt = payload.generatedAt ?? new Date();
  const summarySheet = workbook.addWorksheet("Resumo");
  const dataSheet = workbook.addWorksheet("Dados");

  summarySheet.addRows([
    ["pergunta", payload.question],
    ["resposta_executiva", executiveSummaryText(payload.executiveSummary)],
    ["data_hora", generatedAt.toLocaleString("pt-BR")],
    ["quantidade_registros", payload.rowCount],
    ["status", payload.success ? "success" : "failed"],
    ["tipo_analise", payload.detectedIntent || ""]
  ]);

  dataSheet.addRow(payload.columns);
  payload.data.forEach((row) => {
    dataSheet.addRow(payload.columns.map((column) => row[column] ?? ""));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }),
    createExecutiveExportFilename("xlsx", generatedAt)
  );
}
