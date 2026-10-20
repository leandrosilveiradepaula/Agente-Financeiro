import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  join(process.cwd(), "app/api/admin/runs/[id]/shadow-comparison/route.ts"),
  "utf8"
);

describe("Admin SQL comparison read boundary", () => {
  it("authorizes original run and SQL viewing policy before comparison", () => {
    expect(route).toContain("requireAgentSession()");
    expect(route).toContain("authorizeAdminRunReadAccess(id, session)");
    expect(route).toContain("!access.policy.can_view_sql");
    expect(route).toContain("isShadowSqlComparisonEnabled()");
    expect(route.indexOf("authorizeAdminRunReadAccess(id, session)"))
      .toBeLessThan(route.indexOf("compareLangGraphShadowSql({"));
  });

  it("only sends database-owned SQL and principal after authorization", () => {
    expect(route).toContain("compareStage(run.sql_generated)");
    expect(route).toContain("compareStage(run.sql_executed)");
    expect(route).toContain("question: run.pergunta");
    expect(route).toContain("officialIntent: run.detected_intent");
    expect(route).toContain("assessRecordedProviderIdentity({");
    expect(route).toContain("provider: run.llm_provider");
    expect(route).toContain("model: run.llm_model");
    expect(route).toContain("originalUserId: run.user_id");
    expect(route).toContain("agentRunId: id");
    expect(route).not.toContain("request.json()");
    // Product's later execution SQL is intentionally compared.
    expect(route).toContain("compareStage(run.sql_executed)");
    expect(route).not.toContain("officialSql: request");
  });

  it("compares generated and executed SQL independently, without executing either", () => {
    expect(route).toContain("const [generated, executed] = await Promise.all(");
    expect(route).toContain("official_sql_text_changed: officialSqlTextChanged");
    expect(route).toContain("generated,");
    expect(route).toContain("executed,");
    expect(route).not.toContain("request.json()");
  });


  it("does not show an actionable SQL comparison button when the backend feature is disabled", () => {
    const listRoute = readFileSync(
      join(process.cwd(), "app/api/admin/runs/[id]/shadow-runs/route.ts"),
      "utf8"
    );
    const panel = readFileSync(
      join(process.cwd(), "components/ShadowRunPanel.tsx"),
      "utf8"
    );
    expect(listRoute).toContain("comparison_enabled: isShadowSqlComparisonEnabled()");
    expect(panel).toContain("setComparisonEnabled(data.comparison_enabled === true)");
    expect(panel).toContain('selectedRun?.event_type === "generate" && comparisonEnabled');
    expect(panel).toContain("A comparação de SQL está desativada neste ambiente.");
  });

  it("labels persisted SQL without claiming access to the pre-cleaner Gemini draft", () => {
    const panel = readFileSync(
      join(process.cwd(), "components/ShadowRunPanel.tsx"),
      "utf8"
    );
    expect(panel).toContain("SQL devolvida pelo n8n (após o cleaner)");
    expect(panel).toContain("SQL registrada em execução posterior do Produto");
    expect(panel).toContain("A SQL original do Gemini, antes do cleaner");
    expect(panel).toContain("Provedor/modelo não coincidem literalmente");
    expect(panel).toContain("Provedor/modelo de ambos os caminhos ainda não estão comprovados.");
    expect(panel).not.toContain("Verifique o cleaner e os filtros");
  });

  it("polls only read-only Shadow evidence when post-response generation is pending", () => {
    const listRoute = readFileSync(
      join(process.cwd(), "app/api/admin/runs/[id]/shadow-runs/route.ts"),
      "utf8"
    );
    const panel = readFileSync(
      join(process.cwd(), "components/ShadowRunPanel.tsx"),
      "utf8"
    );
    expect(listRoute).toContain("shadow_enabled: isLangGraphShadowDispatchConfigured()");
    expect(panel).toContain("data.shadow_enabled === true && attempt < 12");
    expect(panel).toContain("loadShadowRuns(attempt + 1)");
    expect(panel).toContain("if (retryTimer) clearTimeout(retryTimer)");
    expect(panel).toContain("Aguardando evidencias do Shadow");
    expect(panel).not.toContain("dispatchLangGraphGenerateShadow(");
  });

  it("does not execute SQL, update records, or return raw SQL", () => {
    expect(route).not.toContain("executeSql");
    expect(route).not.toContain("updateAgentRun");
    expect(route).not.toContain("N8N_EXECUTE");
    expect(route).toContain("comparison: {");
    expect(route).toContain("generated,");
    expect(route).toContain("executed,");
    expect(route).not.toContain("official_sql: ");
    expect(route).toContain('export const runtime = "nodejs"');
  });
});
