import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ALLOWED_AGENT_PROFILES } from "@/lib/admin-users";

describe("DEMO commercial interface contract", () => {
  it("keeps the approved profile set explicit and complete", () => {
    expect(ALLOWED_AGENT_PROFILES).toEqual([
      "admin",
      "diretoria",
      "financeiro",
      "auditoria",
      "comercial"
    ]);
  });

  it("uses response content, not frontend environment flags, to select DEMO combined behavior", async () => {
    const source = await readFile("app/page.tsx", "utf8");

    expect(source).not.toContain("AGENT_INTERFACE_MODE");
    expect(source).toContain("generation.response?.execution_result");
    expect(source).toContain("allowLocalFallback={!isCombinedBackendExecution}");
    expect(source).toContain("!execution.response?.success");
  });

  it("prioritizes backend executive content for combined DEMO results and preserves official fallback", async () => {
    const source = await readFile("app/page.tsx", "utf8");

    expect(source).toContain("backendExecutiveSummary");
    expect(source).toContain("execution.response?.relatorio_executivo");
    expect(source).toContain("execution.response?.executive_summary");
    expect(source).toContain(
      "backendExecutiveSummary ?? (!isCombinedBackendExecution ? executiveSummary : null)"
    );
  });

  it("keeps ordinary commercial labels on the main interface", async () => {
    const pageSource = await readFile("app/page.tsx", "utf8");
    const summarySource = await readFile("components/ExecutiveSummary.tsx", "utf8");
    const actionsSource = await readFile("components/ExecutiveReportActions.tsx", "utf8");

    expect(pageSource).toContain("Agente Financeiro");
    expect(pageSource).toContain("Grupo Horizonte");
    expect(pageSource).toContain("Inteligência para conversar com seus dados.");
    expect(summarySource).toContain("Resposta executiva");
    expect(actionsSource).toContain("Resposta executiva");
    expect(pageSource).toContain("Resultados");
    expect(pageSource).toContain("Histórico");
  });
});
