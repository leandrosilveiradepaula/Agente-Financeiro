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
    expect(route).toContain("originalUserId: run.user_id");
    expect(route).toContain("agentRunId: id");
    expect(route).not.toContain("request.json()");
    expect(route).not.toContain("run.sql_executed");
  });

  it("compares generated and executed SQL independently, without executing either", () => {
    expect(route).toContain("const [generated, executed] = await Promise.all(");
    expect(route).toContain("official_sql_text_changed: officialSqlTextChanged");
    expect(route).toContain("generated,");
    expect(route).toContain("executed,");
    expect(route).not.toContain("request.json()");
  });

  it("does not execute SQL, update records, or return raw SQL", () => {
    expect(route).not.toContain("executeSql");
    expect(route).not.toContain("updateAgentRun");
    expect(route).not.toContain("N8N_EXECUTE");
    expect(route).toContain("comparison: result.data");
    expect(route).not.toContain("official_sql: ");
    expect(route).toContain('export const runtime = "nodejs"');
  });
});
