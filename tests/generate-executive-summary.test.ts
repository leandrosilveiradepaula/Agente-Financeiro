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

    expect(summary.paragraphs.join(" ")).toContain("colunas de ranking válidas");
    expect(summary.highlights.join(" ")).toContain("ranking_por_valor");
    expect(summary.highlights.join(" ")).toContain("ranking_por_perc_rol");
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
          variancia_rs: -562193.32,
          variancia_perc: -128.57,
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

    expect(summary.paragraphs[0]).toContain("principal variação negativa");
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

    expect(summary.paragraphs[0]).toContain("principal variação positiva");
    expect(highlights).toContain("Maior variação positiva");
    expect(highlights).not.toContain("Maior variação negativa");
    expect(highlights).toContain("B");
  });

  it("uses the largest absolute variance as the main sentence", () => {
    const summary = generateExecutiveSummary({
      columns: varianceColumns,
      data: [
        {
          grupo_dre: "01 - RECEITA DE VENDAS",
          variancia_rs: 2022762.81,
          variancia_perc: 5.32
        },
        {
          grupo_dre: "14 - IMPOSTO SOBRE O LUCRO",
          variancia_rs: -800322.4,
          variancia_perc: -134.41
        }
      ]
    });
    const highlights = summary.highlights.join(" ");

    expect(summary.paragraphs[0]).toContain("principal variação positiva");
    expect(summary.paragraphs[0]).toContain("01 - RECEITA DE VENDAS");
    expect(summary.paragraphs[0]).toContain("R$");
    expect(summary.paragraphs[0]).toContain("2.022.762,81");
    expect(highlights).toContain("Maior variação positiva");
    expect(highlights).toContain("Maior variação negativa");
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

  it("summarizes generic tabular rankings with related metrics", () => {
    const summary = generateExecutiveSummary({
      columns: ["entidade", "ranking_receita", "receita_valor", "classificacao_margem", "margem_valor"],
      data: [
        {
          entidade: "A",
          ranking_receita: 2,
          receita_valor: 100,
          classificacao_margem: 1,
          margem_valor: 40
        },
        {
          entidade: "B",
          ranking_receita: 1,
          receita_valor: 250,
          classificacao_margem: 2,
          margem_valor: 30
        }
      ]
    });
    const text = [...summary.paragraphs, ...summary.highlights].join(" ");

    expect(text).toContain("colunas de ranking válidas");
    expect(text).toContain("ranking_receita");
    expect(text).toContain("B");
    expect(text).toContain("receita_valor");
    expect(text).toContain("classificacao_margem");
    expect(text).toContain("A");
    expect(text).toContain("margem_valor");
  });

  it("summarizes ranking without inventing unrelated metrics", () => {
    const summary = generateExecutiveSummary({
      columns: ["entidade", "ranking_global", "valor_total"],
      data: [
        { entidade: "A", ranking_global: 1, valor_total: 500 },
        { entidade: "B", ranking_global: 2, valor_total: 600 }
      ]
    });
    const highlight = summary.highlights.join(" ");

    expect(highlight).toContain("ranking_global");
    expect(highlight).toContain("A");
    expect(highlight).not.toContain("valor_total de");
  });

  it("handles ties at the best ranking position", () => {
    const summary = generateExecutiveSummary({
      columns: ["entidade", "ranking_geral"],
      data: [
        { entidade: "A", ranking_geral: 1 },
        { entidade: "B", ranking_geral: 1 },
        { entidade: "C", ranking_geral: 2 }
      ]
    });

    expect(summary.highlights.join(" ")).toContain("A, B");
  });

  it("ignores invalid ranking values", () => {
    const summary = generateExecutiveSummary({
      columns: ["entidade", "ranking_geral"],
      data: [
        { entidade: "A", ranking_geral: null },
        { entidade: "B", ranking_geral: "inválido" },
        { entidade: "C", ranking_geral: 1 }
      ]
    });
    const highlight = summary.highlights.join(" ");

    expect(highlight).toContain("C");
    expect(highlight).not.toContain("A");
    expect(highlight).not.toContain("B");
  });
});
