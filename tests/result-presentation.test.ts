import { describe, expect, it } from "vitest";
import {
  formatResultCellValue,
  getResultColumnAlignment,
  getResultColumnKind,
  getResultColumnLabel
} from "@/lib/result-presentation";

describe("result-presentation", () => {
  it("uses approved financial aliases", () => {
    expect(getResultColumnLabel("centro_custo")).toBe("Centro de Custo");
    expect(getResultColumnLabel("conta_contabil")).toBe("Conta Contábil");
    expect(getResultColumnLabel("grupo_dre")).toBe("Grupo DRE");
    expect(getResultColumnLabel("marca")).toBe("Marca");
    expect(getResultColumnLabel("receita")).toBe("Receita");
    expect(getResultColumnLabel("receita_rs")).toBe("Receita");
    expect(getResultColumnLabel("opex")).toBe("OPEX");
    expect(getResultColumnLabel("opex_rs")).toBe("OPEX");
    expect(getResultColumnLabel("opex_realizado_rs")).toBe("OPEX Realizado");
    expect(getResultColumnLabel("opex_orcado_rs")).toBe("OPEX Orçado");
    expect(getResultColumnLabel("realizado_rs")).toBe("Realizado");
    expect(getResultColumnLabel("orcado_rs")).toBe("Orçado");
    expect(getResultColumnLabel("variancia_rs")).toBe("Variação");
    expect(getResultColumnLabel("variancia_perc")).toBe("Variação %");
    expect(getResultColumnLabel("variancia_percentual")).toBe("Variação %");
    expect(getResultColumnLabel("perc_orcado_consumido")).toBe("Orçamento Consumido");
    expect(getResultColumnLabel("resultado_liquido_rs")).toBe("Resultado Líquido");
    expect(getResultColumnLabel("resultado_perc_rol")).toBe("Resultado / ROL");
    expect(getResultColumnLabel("ranking_desempenho")).toBe("Posição");
    expect(getResultColumnLabel("ranking")).toBe("Posição");
    expect(getResultColumnLabel("posicao")).toBe("Posição");
  });

  it("builds readable fallback labels while preserving known acronyms", () => {
    expect(getResultColumnLabel("alguma_nova_metrica")).toBe("Alguma Nova Métrica");
    expect(getResultColumnLabel("nome_centro_custo")).toBe("Nome Centro Custo");
    expect(getResultColumnLabel("margem_ebitda")).toBe("Margem EBITDA");
    expect(getResultColumnLabel("cliente_cnpj")).toBe("Cliente CNPJ");
  });

  it("formats currency strings and numbers while preserving negative signs", () => {
    expect(formatResultCellValue("receita_rs", "899875.39")).toBe("R$ 899.875,39");
    expect(formatResultCellValue("receita", "1014335.91")).toBe("R$ 1.014.335,91");
    expect(formatResultCellValue("opex", "-3063405.00")).toBe("-R$ 3.063.405,00");
    expect(formatResultCellValue("resultado_liquido_rs", -125000.5)).toBe("-R$ 125.000,50");
    expect(formatResultCellValue("variancia_rs", "-0.001")).toBe("R$ 0,00");
  });

  it("formats percentages without dividing by 100", () => {
    expect(formatResultCellValue("perc_orcado_consumido", "111.3905195186381000")).toBe(
      "111,4%"
    );
    expect(formatResultCellValue("variancia_percentual", 10)).toBe("10,0%");
    expect(formatResultCellValue("resultado_perc_rol", "-4.812345")).toBe("-4,8%");
  });

  it("formats ranking values as ordinals when integer", () => {
    expect(formatResultCellValue("ranking_desempenho", "1")).toBe("1º");
    expect(formatResultCellValue("ranking", 2)).toBe("2º");
    expect(formatResultCellValue("posicao", 3)).toBe("3º");
    expect(formatResultCellValue("ranking", "1.5")).toBe("1,5");
  });

  it("formats generic numbers without currency", () => {
    expect(formatResultCellValue("quantidade", "1234567.89")).toBe("1.234.567,89");
    expect(formatResultCellValue("total_linhas", 1000)).toBe("1.000");
  });

  it("renders nullish and boolean values for presentation", () => {
    expect(formatResultCellValue("campo", null)).toBe("—");
    expect(formatResultCellValue("campo", "")).toBe("—");
    expect(formatResultCellValue("ativo", true)).toBe("Sim");
    expect(formatResultCellValue("ativo", false)).toBe("Não");
  });

  it("preserves identifiers and leading zeros", () => {
    expect(formatResultCellValue("id", "00123")).toBe("00123");
    expect(formatResultCellValue("cliente_id", "0009")).toBe("0009");
    expect(formatResultCellValue("codigo_cliente", "00045")).toBe("00045");
    expect(formatResultCellValue("nk_conta", "010203")).toBe("010203");
    expect(formatResultCellValue("conta_contabil", "5.03.01.01.01")).toBe("5.03.01.01.01");
  });

  it("formats conservative ISO dates", () => {
    expect(formatResultCellValue("data_movimento", "2026-08-01")).toBe("01/08/2026");
    expect(formatResultCellValue("campo", "2026-08-01")).toBe("01/08/2026");
    expect(formatResultCellValue("campo", "01/08/2026")).toBe("01/08/2026");
  });

  it("returns alignments by detected presentation kind", () => {
    expect(getResultColumnKind("receita_rs", "10")).toBe("currency");
    expect(getResultColumnAlignment(getResultColumnKind("receita_rs", "10"))).toBe("right");
    expect(getResultColumnAlignment(getResultColumnKind("perc_orcado_consumido", "10"))).toBe(
      "right"
    );
    expect(getResultColumnAlignment(getResultColumnKind("data", "2026-08-01"))).toBe("center");
    expect(getResultColumnAlignment(getResultColumnKind("marca", "Horizonte"))).toBe("left");
  });
});
