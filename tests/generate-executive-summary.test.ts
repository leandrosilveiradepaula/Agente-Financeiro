import { describe, expect, it } from "vitest";
import { generateExecutiveSummary } from "@/lib/generateExecutiveSummary";

describe("generateExecutiveSummary", () => {
  const varianceColumns = [
    "grupo_dre",
    "realizado_rs",
    "orcado_rs",
    "variancia_rs",
    "variancia_perc",
    "tipo_variacao"
  ];

  it("summarizes DRE budget variance tables", () => {
    const summary = generateExecutiveSummary({
      columns: [
        "grupo_dre",
        "realizado_rs",
        "orcado_rs",
        "variancia_rs",
        "variancia_perc",
        "tipo_variacao"
      ],
      data: [
        {
          grupo_dre: "01 - RECEITA DE VENDAS",
          realizado_rs: 34723028,
          orcado_rs: 40000000,
          variancia_rs: -5276972,
          variancia_perc: -13.21,
          tipo_variacao: "receita abaixo"
        },
        {
          grupo_dre: "02 - CUSTOS",
          realizado_rs: 100,
          orcado_rs: 200,
          variancia_rs: 100,
          variancia_perc: 50,
          tipo_variacao: "custo abaixo"
        }
      ]
    });

    expect(summary.paragraphs[0]).toContain("01 - RECEITA DE VENDAS");
    expect(summary.highlights.some((highlight) => highlight.includes("Maior variação negativa"))).toBe(
      true
    );
  });

  it("summarizes brand result tables", () => {
    const summary = generateExecutiveSummary({
      columns: [
        "marca",
        "rol_rs",
        "cmv_rs",
        "lucro_bruto_rs",
        "margem_contribuicao_rs",
        "opex_rs",
        "resultado_liquido_rs",
        "resultado_perc_rol",
        "ranking_por_valor",
        "ranking_por_perc_rol",
        "status_rol"
      ],
      data: [
        {
          marca: "A",
          rol_rs: 1000,
          cmv_rs: -300,
          lucro_bruto_rs: 700,
          margem_contribuicao_rs: 600,
          opex_rs: -200,
          resultado_liquido_rs: 400,
          resultado_perc_rol: 40,
          ranking_por_valor: 1,
          ranking_por_perc_rol: 2,
          status_rol: "ok"
        },
        {
          marca: "B",
          rol_rs: 100,
          cmv_rs: -20,
          lucro_bruto_rs: 80,
          margem_contribuicao_rs: 70,
          opex_rs: -10,
          resultado_liquido_rs: 60,
          resultado_perc_rol: 60,
          ranking_por_valor: 2,
          ranking_por_perc_rol: 1,
          status_rol: "ok"
        }
      ]
    });

    expect(summary.paragraphs.join(" ")).toContain("melhor desempenho");
    expect(summary.highlights.join(" ")).toContain("ranking por valor");
  });

  it("falls back to a generic summary", () => {
    const summary = generateExecutiveSummary({
      columns: ["nome", "valor"],
      data: [{ nome: "Item A", valor: 10 }]
    });

    expect(summary.paragraphs[0]).toContain("1 linhas");
    expect(summary.warnings?.length).toBeGreaterThan(0);
  });

  it("normalizes budget overrun values before summarizing", () => {
    const summary = generateExecutiveSummary({
      columns: [
        "grupo_dre",
        "subgrupo",
        "conta_contabil",
        "realizado_rs",
        "orcado_rs",
        "variancia_rs",
        "variancia_perc",
        "tipo_variacao"
      ],
      data: [
        {
          grupo_dre: "14 - IMPOSTO SOBRE O LUCRO",
          subgrupo: "Imposto sobre o lucro",
          conta_contabil: "4.03.01.01.01",
          realizado_rs: "-R$ 999.476,60",
          orcado_rs: "-R$ 437.283,28",
          variancia_rs: "",
          variancia_perc: "",
          tipo_variacao: ""
        }
      ],
    });

    expect(summary.paragraphs[0]).toContain("4.03.01.01.01");
    expect(summary.paragraphs[0]).toContain("-R$");
    expect(summary.paragraphs[0]).toContain("562.193,32");
    expect(summary.paragraphs[0]).toContain("-128,57%");
    expect(summary.highlights.join(" ")).toContain("4.03.01.01.01");
  });

  it("does not create a positive highlight when all variances are negative", () => {
    const summary = generateExecutiveSummary({
      columns: varianceColumns,
      data: [
        { grupo_dre: "A", variancia_rs: -562193.32 },
        { grupo_dre: "B", variancia_rs: -16759.68 }
      ]
    });
    const highlights = summary.highlights.join(" ");

    expect(highlights).toContain("Maior variação negativa");
    expect(highlights).not.toContain("Maior variação positiva");
    expect(highlights).toContain("A");
  });

  it("does not create a negative highlight when all variances are positive", () => {
    const summary = generateExecutiveSummary({
      columns: varianceColumns,
      data: [
        { grupo_dre: "A", variancia_rs: 100 },
        { grupo_dre: "B", variancia_rs: 250 }
      ]
    });
    const highlights = summary.highlights.join(" ");

    expect(highlights).toContain("Maior variação positiva");
    expect(highlights).not.toContain("Maior variação negativa");
    expect(highlights).toContain("B");
  });

  it("creates both variance highlights when both signs exist", () => {
    const summary = generateExecutiveSummary({
      columns: varianceColumns,
      data: [
        { grupo_dre: "A", variancia_rs: -100 },
        { grupo_dre: "B", variancia_rs: 250 }
      ]
    });
    const highlights = summary.highlights.join(" ");

    expect(highlights).toContain("Maior variação negativa");
    expect(highlights).toContain("Maior variação positiva");
  });

  it("never classifies a negative variance close to zero as positive", () => {
    const summary = generateExecutiveSummary({
      columns: varianceColumns,
      data: [{ grupo_dre: "A", variancia_rs: -0.01 }]
    });
    const summaryText = [...summary.paragraphs, ...summary.highlights].join(" ");

    expect(summaryText).toContain("variação negativa");
    expect(summaryText).toContain("Maior variação negativa");
    expect(summaryText).not.toContain("Maior variação positiva");
  });
});
