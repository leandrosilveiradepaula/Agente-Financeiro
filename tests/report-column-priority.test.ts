import { describe, expect, it } from "vitest";
import { prioritizePresentationColumns } from "@/lib/report-column-priority";

describe("prioritizePresentationColumns", () => {
  it("keeps explanatory columns inside configured limit", () => {
    const columns = [
      "conta",
      "descricao",
      "valor_1",
      "valor_2",
      "valor_3",
      "valor_4",
      "valor_5",
      "valor_6",
      "tipo_ranking"
    ];

    expect(prioritizePresentationColumns(columns, 8)).toContain("tipo_ranking");
    expect(prioritizePresentationColumns(columns, 8)).toHaveLength(8);
  });

  it("keeps non-priority columns in original order after priority columns", () => {
    const columns = ["descricao", "valor_1", "tipo_impacto", "valor_2", "marca"];

    expect(prioritizePresentationColumns(columns, 4)).toEqual([
      "tipo_impacto",
      "marca",
      "descricao",
      "valor_1"
    ]);
  });

  it("matches priority columns case-insensitively while returning original names", () => {
    const columns = ["Descricao", "Tipo_Ranking", "Realizado_RS"];

    expect(prioritizePresentationColumns(columns, 2)).toEqual(["Tipo_Ranking", "Realizado_RS"]);
  });
});
