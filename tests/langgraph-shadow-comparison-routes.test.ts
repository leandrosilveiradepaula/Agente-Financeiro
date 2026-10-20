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
    expect(route).toContain("officialSql: run.sql_generated");
    expect(route).toContain("question: run.pergunta");
    expect(route).toContain("originalUserId: run.user_id");
    expect(route).toContain("agentRunId: id");
    expect(route).not.toContain("request.json()");
    expect(route).not.toContain("run.sql_executed");
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
