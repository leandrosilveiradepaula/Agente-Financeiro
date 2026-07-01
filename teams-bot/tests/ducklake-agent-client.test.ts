import { afterEach, describe, expect, it, vi } from "vitest";
import { askDuckLakeAgent } from "../src/ducklake-agent-client.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DUCKLAKE_AGENT_ENDPOINT;
});

describe("ducklake agent client", () => {
  it("generates SQL and executes it using fetch", async () => {
    process.env.DUCKLAKE_AGENT_ENDPOINT = "https://agent.example.com/webhook";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, sql: "SELECT 1" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            query_id: "abc",
            execution_time_ms: 100,
            row_count: 1,
            columns: ["conta_contabil"],
            data: [{ conta_contabil: "5.03.01.01.01" }],
            relatorio_executivo: {
              title: "Resumo executivo",
              paragraphs: ["Resumo"],
              highlights: ["Destaque"],
              intent: "estouro_orcamento"
            },
            relatorio_executivo_markdown: "# Relatório"
          }),
          { status: 200 }
        )
      );

    const result = await askDuckLakeAgent("Pergunta");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.queryId).toBe("abc");
    expect(result.intent).toBe("estouro_orcamento");
    expect(result.markdown).toBe("# Relatório");
  });
});
