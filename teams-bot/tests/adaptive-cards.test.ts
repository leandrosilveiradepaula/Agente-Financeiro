import { describe, expect, it } from "vitest";
import { buildExecutiveReportCard } from "../src/adaptive-cards.js";
import type { DuckLakeAgentResult } from "../src/types.js";

describe("adaptive cards", () => {
  it("builds report card without warnings", () => {
    const attachment = buildExecutiveReportCard({
      reportId: "report-1",
      webAppUrl: "https://app.example.com",
      result: {
        question: "Pergunta",
        sql: "SELECT 1",
        generateResponse: { success: true, sql: "SELECT 1" },
        executeResponse: { success: true },
        summary: {
          title: "Resumo executivo",
          paragraphs: ["Resumo"],
          highlights: ["Destaque"],
          intent: "estouro_orcamento"
        },
        markdown: "# Relatório",
        columns: ["conta_contabil"],
        data: [{ conta_contabil: "5.03.01.01.01" }],
        queryId: "abc",
        rowCount: 1,
        executionTimeMs: 100,
        intent: "estouro_orcamento"
      } satisfies DuckLakeAgentResult
    });

    expect(attachment.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(JSON.stringify(attachment.content)).toContain("Relatório Executivo");
  });
});
