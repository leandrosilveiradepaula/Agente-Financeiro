import { beforeEach, describe, expect, it } from "vitest";
import {
  readQueryHistory,
  upsertQueryHistory,
  writeQueryHistory
} from "@/lib/history";
import type { QueryHistoryItem } from "@/lib/types";

function makeItem(overrides: Partial<QueryHistoryItem> = {}): QueryHistoryItem {
  return {
    id: crypto.randomUUID(),
    pergunta: "Pergunta de teste",
    sql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10",
    agent_version: "v2.0.6.2-benchmark-30-30-stable",
    detected_intent: "teste",
    validation_status: "aprovado",
    created_at: new Date().toISOString(),
    executed_watson: false,
    ...overrides
  };
}

describe("query history helpers", () => {
  const userId = "user-1";

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty list when storage is empty", () => {
    expect(readQueryHistory()).toEqual([]);
  });

  it("writes and reads valid history items", () => {
    const item = makeItem();

    writeQueryHistory([item], userId);

    expect(readQueryHistory(userId)).toEqual([item]);
  });

  it("deduplicates by question and SQL", () => {
    const first = makeItem({ id: "first" });
    const second = makeItem({ id: "second", executed_watson: true, query_id: "q1" });

    expect(upsertQueryHistory([first], second)).toEqual([second]);
  });

  it("keeps at most 10 items", () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      makeItem({
        id: `item-${index}`,
        pergunta: `Pergunta ${index}`,
        sql: `SELECT * FROM dev_lakehouse.main_gold.resultado_${index} LIMIT 10`
      })
    );

    expect(upsertQueryHistory(items, makeItem({ id: "new" }))).toHaveLength(10);
  });

  it("ignores malformed stored data", () => {
    window.localStorage.setItem("ducklake-sql-agent-history", JSON.stringify([{ id: 1 }]));

    expect(readQueryHistory()).toEqual([]);
  });

  it("ignores legacy global history even when it is valid", () => {
    const item = makeItem();
    window.localStorage.setItem("ducklake-sql-agent-history", JSON.stringify([item]));

    expect(readQueryHistory(userId)).toEqual([]);
  });
});
