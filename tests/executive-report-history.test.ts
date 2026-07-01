import { beforeEach, describe, expect, it } from "vitest";
import {
  clearExecutiveReportHistory,
  readExecutiveReportHistory,
  removeExecutiveReportHistory,
  upsertExecutiveReportHistory,
  writeExecutiveReportHistory
} from "@/lib/executive-report-history";
import type { ExecutiveReportHistoryItem } from "@/lib/types";

function makeReport(overrides: Partial<ExecutiveReportHistoryItem> = {}): ExecutiveReportHistoryItem {
  return {
    id: crypto.randomUUID(),
    question: "Quais as contas que tiveram maiores estouros de orçamento no mês?",
    sql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 100",
    markdown: "# Agente SQL Financeiro DuckLake — Relatório Executivo",
    summary: {
      title: "Resumo executivo",
      paragraphs: ["A análise identifica os maiores estouros de orçamento do mês."],
      highlights: ["Ranking utilizado: ranking_geral."],
      warnings: ["Receita de Vendas não deve entrar nesta leitura."]
    },
    query_id: "abc123",
    detected_intent: "estouro_orcamento",
    validation_status: "aprovado",
    row_count: 30,
    execution_time_ms: 100,
    generated_at: new Date().toISOString(),
    ...overrides
  };
}

describe("executive report history helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("writes and reads report history", () => {
    const report = makeReport();

    writeExecutiveReportHistory([report]);

    expect(readExecutiveReportHistory()).toEqual([report]);
  });

  it("deduplicates by query_id", () => {
    const first = makeReport({ id: "first", query_id: "same" });
    const second = makeReport({ id: "second", query_id: "same", row_count: 40 });

    expect(upsertExecutiveReportHistory([first], second)).toEqual([second]);
  });

  it("deduplicates by question and SQL when query_id is absent", () => {
    const first = makeReport({ id: "first", query_id: undefined });
    const second = makeReport({ id: "second", query_id: undefined, row_count: 40 });

    expect(upsertExecutiveReportHistory([first], second)).toEqual([second]);
  });

  it("keeps at most 30 items", () => {
    const items = Array.from({ length: 35 }, (_, index) =>
      makeReport({
        id: `item-${index}`,
        query_id: `query-${index}`,
        question: `Pergunta ${index}`,
        sql: `SELECT ${index}`,
        generated_at: new Date(2026, 0, index + 1).toISOString()
      })
    );

    writeExecutiveReportHistory(items);

    expect(readExecutiveReportHistory()).toHaveLength(30);
  });

  it("removes and clears reports", () => {
    const first = makeReport({ id: "first", query_id: "first" });
    const second = makeReport({ id: "second", query_id: "second" });

    writeExecutiveReportHistory([first, second]);

    expect(removeExecutiveReportHistory("first")).toEqual([second]);
    expect(clearExecutiveReportHistory()).toEqual([]);
    expect(readExecutiveReportHistory()).toEqual([]);
  });
});
