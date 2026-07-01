import { describe, expect, it } from "vitest";
import { formatValue, formatWhatsAppMarkdown, formatWhatsAppReport } from "../src/message-formatting.js";
import type { DuckLakeAgentResult } from "../src/types.js";

function makeResult(): DuckLakeAgentResult {
  return {
    question: "Quais as contas que tiveram maiores estouros de orcamento no mes?",
    sql: "SELECT 1",
    generateResponse: { success: true, sql: "SELECT 1" },
    executeResponse: { success: true },
    summary: {
      title: "Resumo executivo",
      paragraphs: [
        "A analise identifica os maiores estouros de orcamento do mes, excluindo Receita de Vendas."
      ],
      highlights: ["Contas com maior estouro aparecem no topo do ranking."],
      warnings: ["Receita de Vendas nao deve entrar nesta leitura de estouro de orcamento."],
      intent: "estouro_orcamento"
    },
    markdown: "# Relatorio",
    columns: ["conta_contabil", "variancia_rs", "ranking_geral"],
    data: [{ conta_contabil: "5.03.01.01.01", variancia_rs: -851264.6, ranking_geral: 1 }],
    queryId: "abc123",
    rowCount: 1,
    executionTimeMs: 646,
    intent: "estouro_orcamento"
  };
}

describe("message formatting", () => {
  it("formats values for WhatsApp tables", () => {
    expect(formatValue("variancia_rs", -851264.6)).toContain("851.264,60");
    expect(formatValue("variancia_perc", -14.47)).toBe("-14,47%");
    expect(formatValue("ranking_geral", 1)).toBe("1");
    expect(formatValue("conta_contabil", "5.03.01.01.01")).toBe("5.03.01.01.01");
  });

  it("builds a compact WhatsApp executive report", () => {
    const report = formatWhatsAppReport(makeResult());

    expect(report).toContain("Agente SQL Financeiro DuckLake");
    expect(report).toContain("Relatorio Executivo");
    expect(report).toContain("Intencao: estouro_orcamento");
    expect(report).toContain("Query ID: abc123");
    expect(report).toContain("Receita de Vendas nao deve entrar");
  });

  it("truncates markdown with an explicit notice", () => {
    process.env.MAX_WHATSAPP_MESSAGE_LENGTH = "1200";
    const markdown = formatWhatsAppMarkdown("x".repeat(1400));

    expect(markdown.length).toBeLessThanOrEqual(1200);
    expect(markdown).toContain("Markdown truncado para o WhatsApp");
    delete process.env.MAX_WHATSAPP_MESSAGE_LENGTH;
  });
});
