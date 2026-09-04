import { describe, expect, it } from "vitest";
import { normalizeReportRow, parseReportNumber } from "@/lib/report-row-normalization";

describe("report row normalization", () => {
  it("parses Brazilian currency and negative values", () => {
    expect(parseReportNumber("-R$ 999.476,60")).toBe(-999476.6);
    expect(parseReportNumber("R$ 1.234,56")).toBe(1234.56);
    expect(parseReportNumber("-999476.60")).toBe(-999476.6);
    expect(parseReportNumber("")).toBeNull();
    expect(parseReportNumber(null)).toBeNull();
  });

  it("calculates variance fields and impact type when Watson returns empty values", () => {
    const row = normalizeReportRow({
      grupo_dre: "14 - IMPOSTO SOBRE O LUCRO",
      subgrupo: "Imposto sobre o lucro",
      conta_contabil: "4.03.01.01.01",
      realizado_rs: "-R$ 999.476,60",
      orcado_rs: "-R$ 437.283,28",
      variancia_rs: "",
      variancia_perc: ""
    });

    expect(row.realizado_rs).toBe(-999476.6);
    expect(row.orcado_rs).toBe(-437283.28);
    expect(row.variancia_rs).toBe(-562193.32);
    expect(row.variancia_perc).toBeCloseTo(-128.57, 2);
    expect(row.tipo_variacao).toBe("Impacto negativo versus orçamento");
  });
});
