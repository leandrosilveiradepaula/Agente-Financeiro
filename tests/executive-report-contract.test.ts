import { describe, expect, it } from "vitest";
import { normalizeWatsonResult } from "@/lib/watson-result-normalization";
import type { ExecuteWatsonResponse } from "@/lib/types";

describe("ExecuteWatsonResponse executive report contract", () => {
  it("accepts backend executive report fields", () => {
    const response = {
      success: true,
      query_id: "abc123",
      execution_time_ms: 100,
      row_count: 30,
      columns: [],
      data: [],
      raw: null,
      relatorio_executivo: {
        title: "Resumo executivo",
        paragraphs: ["principal variação observada"],
        highlights: ["Receita de Vendas pode aparecer na variação geral."],
        warnings: [],
        intent: "orcado_vs_realizado",
        generated_by: "n8n"
      },
      executive_summary: {
        title: "Resumo executivo",
        paragraphs: ["melhor desempenho em valor", "percentual sobre ROL"],
        highlights: ["comparativo_marcas"],
        intent: "comparativo_marcas"
      },
      relatorio_executivo_markdown: "# Agente SQL Financeiro DuckLake — Relatório Executivo"
    } satisfies ExecuteWatsonResponse;

    expect(response.relatorio_executivo?.intent).toBe("orcado_vs_realizado");
    expect(response.executive_summary?.paragraphs.join(" ")).toContain("percentual sobre ROL");
  });

  it("normalizes backend report fields without falling back to local summary", () => {
    const result = normalizeWatsonResult({
      success: true,
      query_id: "impacto123",
      columns: ["marca", "setor", "opex_rs", "perc_representatividade"],
      data: [{ marca: "Rivatti", setor: "Produção/CD", opex_rs: -578094.06, perc_representatividade: 42.5 }],
      relatorio_executivo: {
        title: "Resumo executivo",
        paragraphs: ["peso de cada setor no OPEX"],
        highlights: ["representatividade"],
        intent: "impacto_setor_marca",
        generated_by: "n8n"
      },
      relatorio_executivo_markdown: "# Markdown do backend"
    });

    expect(result.relatorio_executivo?.paragraphs).toContain("peso de cada setor no OPEX");
    expect(result.relatorio_executivo?.intent).toBe("impacto_setor_marca");
    expect(result.relatorio_executivo_markdown).toBe("# Markdown do backend");
  });
});
