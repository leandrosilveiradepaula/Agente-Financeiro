import type { Attachment } from "botbuilder";
import { CardFactory } from "botbuilder";
import type { DuckLakeAgentResult, SavedTeamsReport } from "./types.js";
import { formatTeamsTableValue } from "./text-formatting.js";

type AdaptiveCard = Record<string, unknown>;

function adaptiveCard(card: AdaptiveCard): Attachment {
  return CardFactory.adaptiveCard(card);
}

function textBlock(text: string, options: Record<string, unknown> = {}) {
  return {
    type: "TextBlock",
    text,
    wrap: true,
    ...options
  };
}

function facts(items: Array<{ title: string; value: string }>) {
  return {
    type: "FactSet",
    facts: items.map((item) => ({ title: item.title, value: item.value }))
  };
}

function previewFacts(result: DuckLakeAgentResult) {
  const columns = result.columns.slice(0, 5);
  return result.data.slice(0, 5).map((row, index) => ({
    title: `Linha ${index + 1}`,
    value: columns.map((column) => `${column}: ${formatTeamsTableValue(column, row[column])}`).join(" | ")
  }));
}

export function buildExecutiveReportCard({
  result,
  reportId,
  webAppUrl
}: {
  result: DuckLakeAgentResult;
  reportId: string;
  webAppUrl?: string;
}) {
  const warnings = result.summary.warnings ?? [];
  const actions: unknown[] = [
    { type: "Action.Submit", title: "Salvar relatório", data: { action: "saveReport", reportId } },
    { type: "Action.Submit", title: "Enviar Markdown", data: { action: "sendMarkdown", reportId } }
  ];

  if (webAppUrl) {
    actions.push({
      type: "Action.OpenUrl",
      title: "Abrir interface",
      url: result.queryId ? `${webAppUrl}?query_id=${encodeURIComponent(result.queryId)}` : webAppUrl
    });
  }

  return adaptiveCard({
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      textBlock("Agente SQL Financeiro DuckLake", { size: "Small", color: "Accent", weight: "Bolder" }),
      textBlock("Relatório Executivo", { size: "Large", weight: "Bolder" }),
      facts([
        { title: "Query ID", value: result.queryId || "Não informado" },
        { title: "Intenção", value: result.intent || "Não informada" },
        { title: "Linhas", value: String(result.rowCount ?? "Não informado") },
        {
          title: "Tempo",
          value:
            result.executionTimeMs === null || result.executionTimeMs === undefined
              ? "Não informado"
              : `${result.executionTimeMs} ms`
        },
        { title: "Status", value: result.executeResponse.success ? "success" : "erro" }
      ]),
      textBlock("Pergunta", { weight: "Bolder", spacing: "Medium" }),
      textBlock(result.question),
      textBlock("Resumo executivo", { weight: "Bolder", spacing: "Medium" }),
      ...result.summary.paragraphs.map((paragraph) => textBlock(paragraph)),
      textBlock("Destaques", { weight: "Bolder", spacing: "Medium" }),
      ...result.summary.highlights.map((highlight) => textBlock(`• ${highlight}`)),
      ...(warnings.length
        ? [
            textBlock("Observações e alertas", { weight: "Bolder", spacing: "Medium", color: "Warning" }),
            ...warnings.map((warning) => textBlock(`• ${warning}`))
          ]
        : []),
      textBlock("Tabela resumida", { weight: "Bolder", spacing: "Medium" }),
      facts(previewFacts(result))
    ],
    actions
  });
}

export function buildSavedReportCard(report: SavedTeamsReport) {
  return adaptiveCard({
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      textBlock("Relatório salvo", { size: "Medium", weight: "Bolder" }),
      facts([
        { title: "Data", value: new Date(report.createdAt).toLocaleString("pt-BR") },
        { title: "Query ID", value: report.queryId || "Não informado" },
        { title: "Intenção", value: report.summary.intent || "Não informada" }
      ]),
      textBlock(report.question)
    ],
    actions: [
      { type: "Action.Submit", title: "Ver resumo", data: { action: "viewSavedSummary", reportId: report.id } },
      { type: "Action.Submit", title: "Enviar Markdown", data: { action: "sendMarkdown", reportId: report.id } }
    ]
  });
}

export function buildHelpCard() {
  return adaptiveCard({
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      textBlock("Como usar o Agente SQL Financeiro DuckLake", { size: "Medium", weight: "Bolder" }),
      textBlock("Digite uma pergunta financeira, por exemplo:"),
      textBlock("• Quais as contas que tiveram maiores estouros de orçamento no mês?"),
      textBlock("• Qual foi a principal variação entre orçado e realizado?"),
      textBlock("• Monte uma tabela com resultados por marca.")
    ]
  });
}
