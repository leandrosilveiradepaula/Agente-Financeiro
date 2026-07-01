import { describe, expect, it } from "vitest";
import { BENCHMARK_CASES } from "@/lib/benchmark-cases";
import {
  buildBenchmarkMarkdown,
  normalizeBenchmarkText,
  summarizeBenchmarkResults,
  validateBenchmarkResponse
} from "@/lib/benchmark-utils";

describe("benchmark utilities", () => {
  it("normalizes accents and casing for contains checks", () => {
    expect(normalizeBenchmarkText("Variação ORÇADO  x   Realizado")).toBe(
      "variacao orcado x realizado"
    );
  });

  it("approves a valid backend response for the budget overrun case", () => {
    const benchmarkCase = BENCHMARK_CASES[0];
    const result = validateBenchmarkResponse({
      benchmarkCase,
      generateResponse: {
        success: true,
        agent_version: "v",
        detected_intent: "estouro_orcamento",
        validation_status: "aprovado",
        sql: "SELECT 1",
        raw: null
      },
      executeResponse: {
        success: true,
        query_id: "abc123",
        execution_time_ms: 100,
        row_count: 30,
        columns: ["conta_contabil"],
        data: [{ conta_contabil: "5.03.01.01.01" }],
        raw: null,
        relatorio_executivo: {
          title: "Resumo executivo",
          paragraphs: [
            "A análise identifica os maiores estouros de orçamento do mês, excluindo Receita de Vendas"
          ],
          highlights: ["Ranking utilizado: ranking_geral."],
          warnings: [
            "Receita de Vendas não deve entrar nesta leitura de estouro de orçamento"
          ],
          intent: "estouro_orcamento"
        },
        relatorio_executivo_markdown: "# Relatório"
      },
      generationTimeMs: 10,
      executionTimeMs: 20,
      totalTimeMs: 30
    });

    expect(result.status).toBe("aprovado");
    expect(result.queryId).toBe("abc123");
  });

  it("flags attention when expected text or markdown is missing", () => {
    const benchmarkCase = BENCHMARK_CASES[2];
    const result = validateBenchmarkResponse({
      benchmarkCase,
      generateResponse: {
        success: true,
        agent_version: "v",
        detected_intent: "comparativo_marcas",
        validation_status: "aprovado",
        sql: "SELECT 1",
        raw: null
      },
      executeResponse: {
        success: true,
        query_id: "abc123",
        execution_time_ms: 100,
        row_count: 1,
        columns: ["marca"],
        data: [{ marca: "Rivatti" }],
        raw: null,
        relatorio_executivo: {
          title: "Resumo executivo",
          paragraphs: ["Texto genérico"],
          highlights: [],
          intent: "comparativo_marcas"
        }
      },
      generationTimeMs: 10,
      executionTimeMs: 20,
      totalTimeMs: 30
    });

    expect(result.status).toBe("atencao");
    expect(result.validationMessages.join(" ")).toContain("Markdown executivo ausente");
    expect(result.validationMessages.join(" ")).toContain("Texto esperado ausente");
  });

  it("summarizes and builds markdown results", () => {
    const results = [
      {
        caseId: "a",
        status: "aprovado" as const,
        question: "Pergunta A",
        expectedIntent: "a",
        actualIntent: "a",
        totalTimeMs: 100,
        generationTimeMs: 40,
        executionTimeMs: 60,
        validationMessages: ["ok"]
      },
      {
        caseId: "b",
        status: "erro" as const,
        question: "Pergunta B",
        expectedIntent: "b",
        validationMessages: ["erro"]
      }
    ];

    expect(summarizeBenchmarkResults(results)).toMatchObject({
      total: 2,
      approved: 1,
      errors: 1,
      averageTotalMs: 100
    });
    expect(buildBenchmarkMarkdown({ baseline: "baseline", results })).toContain(
      "# Benchmark e Homologação"
    );
  });
});
