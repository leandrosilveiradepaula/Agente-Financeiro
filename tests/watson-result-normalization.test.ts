import { describe, expect, it } from "vitest";
import { normalizeWatsonResult } from "@/lib/watson-result-normalization";

describe("normalizeWatsonResult", () => {
  it("normalizes the primary Watson JSON shape", () => {
    const result = normalizeWatsonResult({
      columns: ["marca", "setor", "opex_rs"],
      data: [{ marca: "Rivatti", setor: "Produção/CD", opex_rs: -578094.06 }],
      execution_time_ms: 503.66,
      query_id: "89780e1e",
      row_count: 33,
      success: true
    });

    expect(result.columns).toEqual(["marca", "setor", "opex_rs"]);
    expect(result.data).toHaveLength(1);
    expect(result.execution_time_ms).toBe(503.66);
    expect(result.query_id).toBe("89780e1e");
    expect(result.row_count).toBe(33);
    expect(result.success).toBe(true);
    expect(result.inferred_columns).toBe(false);
  });

  it("accepts rows and queryId aliases", () => {
    const result = normalizeWatsonResult({
      rows: [{ marca: "A", valor: 10 }],
      queryId: "abc",
      executionTimeMs: "12.5",
      rowCount: "1"
    });

    expect(result.columns).toEqual(["marca", "valor"]);
    expect(result.query_id).toBe("abc");
    expect(result.execution_time_ms).toBe(12.5);
    expect(result.row_count).toBe(1);
    expect(result.inferred_columns).toBe(true);
  });

  it("accepts result.data and calculates row count", () => {
    const result = normalizeWatsonResult({
      result: {
        data: [{ marca: "A" }, { marca: "B" }]
      }
    });

    expect(result.columns).toEqual(["marca"]);
    expect(result.row_count).toBe(2);
  });

  it("returns empty data for unexpected shapes", () => {
    const result = normalizeWatsonResult({ result: "sem dados" });

    expect(result.columns).toEqual([]);
    expect(result.data).toEqual([]);
    expect(result.row_count).toBe(0);
  });

  it("normalizes report aliases and calculates empty variance fields", () => {
    const result = normalizeWatsonResult({
      columns: [
        "grupo_dre",
        "subgrupo",
        "conta_contabil",
        "realizado_rs",
        "orcado_rs",
        "variancia_rs",
        "variancia_perc"
      ],
      data: [
        {
          grupo_dre: "14 - IMPOSTO SOBRE O LUCRO",
          subgrupo: "Imposto sobre o lucro",
          conta_contabil: "4.03.01.01.01",
          realizado_rs: "-R$ 999.476,60",
          orcado_rs: "-R$ 437.283,28",
          variancia_rs: "",
          variancia_perc: ""
        }
      ]
    });

    expect(result.columns).toContain("tipo_variacao");
    expect(result.data[0]).toMatchObject({
      realizado_rs: -999476.6,
      orcado_rs: -437283.28,
      variancia_rs: -562193.32,
      variancia_perc: -128.57,
      tipo_variacao: "Impacto negativo versus orçamento"
    });
  });
});
