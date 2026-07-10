import { describe, expect, it } from "vitest";
import { normalizeGenerateSqlResponse } from "@/lib/generate-sql-normalization";

describe("normalizeGenerateSqlResponse", () => {
  it("extracts detected intent from nested classificacao.intent", () => {
    const response = normalizeGenerateSqlResponse({
      classificacao: { intent: "resultado_por_marca" },
      sql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10"
    });

    expect(response.detected_intent).toBe("resultado_por_marca");
  });

  it("extracts detected intent from plano.intencao", () => {
    const response = normalizeGenerateSqlResponse({
      plano: { intencao: "analise_opex" },
      query: "SELECT * FROM dev_lakehouse.main_gold.opex LIMIT 10"
    });

    expect(response.detected_intent).toBe("analise_opex");
  });

  it("extracts validation status from nested validation.status", () => {
    const response = normalizeGenerateSqlResponse({
      validation: { status: "aprovado_com_alerta" },
      resposta: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10"
    });

    expect(response.validation_status).toBe("aprovado_com_alerta");
  });

  it("maps boolean aprovado to aprovado", () => {
    const response = normalizeGenerateSqlResponse({
      aprovado: true,
      sql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10"
    });

    expect(response.validation_status).toBe("aprovado");
  });

  it("falls back to aprovado when success is true and SQL exists", () => {
    const response = normalizeGenerateSqlResponse({
      success: true,
      entrega_watson: {
        query_para_copiar: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10"
      }
    });

    expect(response.validation_status).toBe("aprovado");
  });

  it("falls back to erro when success is false", () => {
    const response = normalizeGenerateSqlResponse({
      success: false,
      sql: ""
    });

    expect(response.validation_status).toBe("erro");
  });

  it("normalizes SQL cache metadata from cache", () => {
    const response = normalizeGenerateSqlResponse({
      success: true,
      sql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10",
      cache: {
        enabled: true,
        hit: true,
        source: "sql_generation_cache",
        status: "hit_validated",
        cache_id: "abc",
        hit_count: 3
      }
    });

    expect(response.cache).toMatchObject({
      enabled: true,
      hit: true,
      source: "sql_generation_cache",
      status: "hit_validated",
      cache_id: "abc",
      hit_count: 3
    });
  });

  it("normalizes disabled SQL cache metadata from metadata.cache", () => {
    const response = normalizeGenerateSqlResponse({
      success: true,
      sql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10",
      metadata: {
        cache: {
          enabled: false,
          hit: false,
          source: "disabled_by_user"
        }
      }
    });

    expect(response.cache).toEqual({
      enabled: false,
      hit: false,
      source: "disabled_by_user",
      cache_key: undefined,
      cache_id: undefined,
      status: undefined,
      hit_count: undefined,
      created_at: undefined
    });
  });
});
