import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { InterfaceSettings } from "@/lib/interface-settings";
import { formatBRL, formatNumber, formatPercent } from "@/lib/number-formatting";
import { AGENT_VERSION, type ExecutiveSummaryResult, type ResultRow } from "@/lib/types";

export type ExecutiveReportMetadata = {
  agent_version?: string;
  detected_intent?: string;
  validation_status?: string;
  query_id?: string;
  execution_time_ms?: number | null;
  row_count?: number;
  success?: boolean;
};

export type ExecutiveReportPayload = {
  question: string;
  sql: string;
  columns: string[];
  data: ResultRow[];
  metadata: ExecutiveReportMetadata;
  executiveSummary: ExecutiveSummaryResult;
  settings?: Pick<
    InterfaceSettings,
    "pdfMaxRows" | "pdfMaxColumns" | "pdfIncludeSql" | "pdfMaxSqlLines"
  >;
};

type PdfTheme = {
  margin: number;
  header: [number, number, number];
  accent: [number, number, number];
  ink: [number, number, number];
  muted: [number, number, number];
  border: [number, number, number];
  soft: [number, number, number];
  warning: [number, number, number];
  warningBorder: [number, number, number];
};

const theme: PdfTheme = {
  margin: 16,
  header: [15, 23, 42],
  accent: [13, 148, 136],
  ink: [30, 41, 59],
  muted: [100, 116, 139],
  border: [226, 232, 240],
  soft: [248, 250, 252],
  warning: [255, 251, 235],
  warningBorder: [245, 158, 11]
};

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

function formatDateForFilename(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}-${pad(date.getMinutes())}`;
}

function truncatePdfText(text: string) {
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function formatPdfTableValue(column: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const normalizedColumn = column.trim().toLowerCase();
  const text = String(value).replace(/\s+/g, " ").trim();

  if (DIMENSION_COLUMNS.has(normalizedColumn)) {
    return truncatePdfText(text);
  }

  const numericValue = parseNumericValue(value);

  if (normalizedColumn.startsWith("ranking_") || normalizedColumn.includes("ranking")) {
    return numericValue === null ? truncatePdfText(text) : formatNumber(Math.round(numericValue));
  }

  if (normalizedColumn.endsWith("_rs")) {
    return numericValue === null ? truncatePdfText(text) : formatBRL(numericValue);
  }

  if (normalizedColumn.includes("_perc") || normalizedColumn.startsWith("perc_")) {
    return numericValue === null ? truncatePdfText(text) : formatPercent(numericValue);
  }

  if (numericValue !== null && typeof value === "number") {
    return formatNumber(numericValue);
  }

  return truncatePdfText(text);
}

function pageSize(doc: jsPDF) {
  return {
    width: doc.internal.pageSize.getWidth(),
    height: doc.internal.pageSize.getHeight()
  };
}

function contentWidth(doc: jsPDF) {
  return pageSize(doc).width - theme.margin * 2;
}

function ensureSpace(doc: jsPDF, y: number, needed = 28) {
  const { height } = pageSize(doc);

  if (y + needed <= height - 20) {
    return y;
  }

  doc.addPage();
  return 22;
}

function drawSectionTitle(doc: jsPDF, title: string, y: number) {
  const x = theme.margin;
  y = ensureSpace(doc, y, 18);
  doc.setDrawColor(...theme.accent);
  doc.setLineWidth(0.8);
  doc.line(x, y - 2.5, x + 8, y - 2.5);
  doc.setTextColor(...theme.header);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, x + 11, y);
  return y + 8;
}

function drawWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight = 5.2
) {
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

function drawParagraphs(doc: jsPDF, paragraphs: string[], y: number) {
  doc.setTextColor(...theme.ink);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);

  for (const paragraph of paragraphs) {
    y = ensureSpace(doc, y, 22);
    y = drawWrappedText(doc, paragraph, theme.margin, y, contentWidth(doc), 5.6) + 3;
  }

  return y;
}

function drawCard(doc: jsPDF, text: string, y: number, variant: "highlight" | "warning") {
  const x = theme.margin;
  const width = contentWidth(doc);
  const innerWidth = width - 10;
  const lines = doc.splitTextToSize(text, innerWidth);
  const cardHeight = Math.max(16, lines.length * 5 + 9);

  y = ensureSpace(doc, y, cardHeight + 4);
  doc.setFillColor(...(variant === "warning" ? theme.warning : theme.soft));
  doc.setDrawColor(...(variant === "warning" ? theme.warningBorder : theme.border));
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, width, cardHeight, 2, 2, "FD");
  doc.setTextColor(...theme.ink);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(lines, x + 5, y + 7);

  return y + cardHeight + 4;
}

function drawHeader(doc: jsPDF, now: Date, metadata: ExecutiveReportMetadata, rowCount: number) {
  const x = theme.margin;
  let y = 18;
  const width = contentWidth(doc);

  doc.setFillColor(...theme.header);
  doc.rect(0, 0, pageSize(doc).width, 36, "F");
  doc.setFillColor(...theme.accent);
  doc.rect(0, 34.5, pageSize(doc).width, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Agente SQL Financeiro DuckLake", x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Relatório Executivo", x, y + 8);

  y = 48;
  autoTable(doc, {
    startY: y,
    body: [
      ["Data/hora", now.toLocaleString("pt-BR")],
      ["Query ID", metadata.query_id || "Não informado"],
      ["Intenção", metadata.detected_intent || "Não informada"],
      ["Validação", metadata.validation_status || "Não informada"],
      ["Linhas", String(rowCount)],
      [
        "Tempo",
        metadata.execution_time_ms === null || metadata.execution_time_ms === undefined
          ? "Não informado"
          : `${metadata.execution_time_ms} ms`
      ]
    ],
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: { top: 2, right: 3, bottom: 2, left: 3 },
      lineColor: theme.border,
      lineWidth: 0.15
    },
    columnStyles: {
      0: { fontStyle: "bold", textColor: theme.muted, cellWidth: 28, fillColor: theme.soft },
      1: { textColor: theme.ink, cellWidth: width / 2 - 28 },
      2: { fontStyle: "bold", textColor: theme.muted, cellWidth: 28, fillColor: theme.soft },
      3: { textColor: theme.ink }
    },
    margin: { left: x, right: x },
    didParseCell: (data) => {
      if (data.row.index % 2 === 0) {
        data.cell.styles.fillColor = data.column.index % 2 === 0 ? theme.soft : [255, 255, 255];
      }
    }
  });

  return ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 11;
}

function drawTable(
  doc: jsPDF,
  y: number,
  columns: string[],
  data: ResultRow[],
  maxRows: number,
  maxColumns: number
) {
  const tableColumns = columns.slice(0, maxColumns);
  const tableRows = data.slice(0, maxRows);

  y = drawSectionTitle(doc, "Tabela resumida", y);

  if (!tableColumns.length || !tableRows.length) {
    doc.setTextColor(...theme.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    return drawWrappedText(
      doc,
      "Nenhum dado disponível para exibição.",
      theme.margin,
      y,
      contentWidth(doc)
    ) + 6;
  }

  autoTable(doc, {
    startY: y,
    head: [tableColumns],
    body: tableRows.map((row) => tableColumns.map((column) => formatPdfTableValue(column, row[column]))),
    styles: {
      font: "helvetica",
      fontSize: tableColumns.length > 6 ? 7.2 : 8,
      cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
      overflow: "linebreak",
      lineColor: theme.border,
      lineWidth: 0.12,
      minCellHeight: 7
    },
    headStyles: {
      fillColor: theme.header,
      textColor: [255, 255, 255],
      fontStyle: "bold"
    },
    alternateRowStyles: { fillColor: theme.soft },
    bodyStyles: { textColor: theme.ink },
    margin: { left: theme.margin, right: theme.margin },
    tableWidth: "auto"
  });

  y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 5;

  if (data.length > maxRows || columns.length > maxColumns) {
    doc.setTextColor(...theme.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    y = drawWrappedText(
      doc,
      `Tabela limitada às primeiras ${Math.min(maxRows, data.length)} linhas e ${Math.min(
        maxColumns,
        columns.length
      )} colunas no PDF. O resultado completo permanece disponível na interface e no CSV.`,
      theme.margin,
      y,
      contentWidth(doc),
      4.5
    );
  }

  return y + 6;
}

function drawSql(doc: jsPDF, y: number, sql: string, maxSqlLines: number) {
  y = drawSectionTitle(doc, "SQL utilizada", y);
  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...theme.ink);

  const sqlLines = (sql || "-- SQL não informada").split(/\r?\n/);
  const truncated = sqlLines.length > maxSqlLines;
  const sqlPreview = truncated
    ? `${sqlLines.slice(0, maxSqlLines).join("\n")}\n...`
    : sqlLines.join("\n");
  const lines = doc.splitTextToSize(sqlPreview, contentWidth(doc));

  for (const line of lines) {
    y = ensureSpace(doc, y, 10);
    doc.text(line, theme.margin, y);
    y += 4.1;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  if (truncated) {
    y = ensureSpace(doc, y, 14);
    doc.setTextColor(...theme.muted);
    y = drawWrappedText(
      doc,
      "SQL truncada para visualização. SQL completa disponível na interface.",
      theme.margin,
      y + 3,
      contentWidth(doc),
      4.8
    );
  }

  return y;
}

function addFooters(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    const { width, height } = pageSize(doc);
    doc.setDrawColor(...theme.border);
    doc.setLineWidth(0.2);
    doc.line(theme.margin, height - 14, width - theme.margin, height - 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...theme.muted);
    doc.text("Agente SQL Financeiro DuckLake · Gerado pela interface", theme.margin, height - 8);
    doc.text(`Página ${page} de ${pageCount}`, width - theme.margin - 25, height - 8);
  }
}

export function exportExecutivePdf({
  question,
  sql,
  columns,
  data,
  metadata,
  executiveSummary,
  settings
}: ExecutiveReportPayload) {
  const now = new Date();
  const pdfMaxRows = settings?.pdfMaxRows ?? 10;
  const pdfMaxColumns = settings?.pdfMaxColumns ?? 8;
  const pdfIncludeSql = settings?.pdfIncludeSql ?? true;
  const pdfMaxSqlLines = settings?.pdfMaxSqlLines ?? 120;
  const doc = new jsPDF({
    orientation: Math.min(columns.length, pdfMaxColumns) > 6 ? "landscape" : "portrait",
    unit: "mm",
    format: "a4"
  });
  const rowCount = metadata.row_count ?? data.length;
  let y = drawHeader(doc, now, metadata, rowCount);

  y = drawSectionTitle(doc, "Pergunta", y);
  doc.setTextColor(...theme.ink);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  y = drawWrappedText(
    doc,
    question || "Pergunta não informada.",
    theme.margin,
    y,
    contentWidth(doc),
    5.4
  );
  y += 7;

  y = drawSectionTitle(doc, executiveSummary.title || "Resumo executivo", y);
  y = drawParagraphs(doc, executiveSummary.paragraphs, y);

  if (executiveSummary.highlights.length) {
    y = drawSectionTitle(doc, "Destaques", y + 2);
    executiveSummary.highlights.forEach((highlight, index) => {
      y = drawCard(doc, `${index + 1}. ${highlight}`, y, "highlight");
    });
  }

  if (executiveSummary.warnings?.length) {
    y = drawSectionTitle(doc, "Observações e alertas", y + 2);
    executiveSummary.warnings.forEach((warning) => {
      y = drawCard(doc, warning, y, "warning");
    });
  }

  y = drawTable(doc, y + 2, columns, data, pdfMaxRows, pdfMaxColumns);
  if (pdfIncludeSql) {
    drawSql(doc, y, sql, pdfMaxSqlLines);
  }
  addFooters(doc);

  doc.save(`agente-sql-ducklake-relatorio-${formatDateForFilename(now)}.pdf`);
}
