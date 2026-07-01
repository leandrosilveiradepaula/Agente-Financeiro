import { describe, expect, it } from "vitest";
import { generateExecutiveSummary } from "@/lib/generateExecutiveSummary";

describe("generateExecutiveSummary", () => {
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
});
