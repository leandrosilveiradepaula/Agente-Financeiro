import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  policy: vi.fn(),
  tenant: vi.fn(),
  enabled: vi.fn(),
  runs: vi.fn(),
  inspect: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200, json: async () => body
  }) }
}));
vi.mock("@/lib/server-auth", () => ({ requireAgentSession: mocks.session }));
vi.mock("@/lib/profile-policy", () => ({ getProfilePolicy: mocks.policy }));
vi.mock("@/lib/tenant-identity", () => ({ getSessionTenantIdentity: mocks.tenant }));
vi.mock("@/lib/agent-runs", () => ({ listAgentRuns: mocks.runs }));
vi.mock("@/lib/shadow-parity-batch", () => ({ inspectParityBatch: mocks.inspect }));
vi.mock("@/lib/langgraph-shadow-comparison-client", () => ({
  isShadowSqlComparisonEnabled: mocks.enabled
}));

const operator = { userId: "audit-user", userProfile: "auditoria" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ session: operator, response: null });
  mocks.policy.mockResolvedValue({ can_view_all_runs: true, can_view_sql: true });
  mocks.tenant.mockReturnValue({ status: "ready", organizationId: "tenant-a" });
  mocks.enabled.mockReturnValue(true);
  mocks.runs.mockResolvedValue({
    total: 2, runs: [{ id: "run-a", organization_id: "tenant-a" }]
  });
  mocks.inspect.mockResolvedValue({
    contract_version: "1",
    sample_count: 1, cases: [{ agent_run_id: "run-a" }],
    financial_parity_proven: false, real_sql_executed: false
  });
});
function request(query = "?limit=10&offset=0") {
  return new Request("http://localhost/api/admin/runs/parity-review" + query);
}
describe("J4 read-only parity batch admin route", () => {
  it("uses the authorized organization filter, never client-supplied principal or SQL", async () => {
    const { GET } = await import("@/app/api/admin/runs/parity-review/route");
    const res = await GET(request());
    const result = await res.json();
    expect(res.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.financial_parity_proven).toBe(false);
    expect(mocks.runs).toHaveBeenCalledWith({
      organizationId: "tenant-a", limit: 10, offset: 0
    });
    expect(mocks.inspect).toHaveBeenCalledWith([
      { id: "run-a", organization_id: "tenant-a" }
    ]);
  });

  it("fails before database access without SQL visibility and all-run permission", async () => {
    mocks.policy.mockResolvedValue({ can_view_all_runs: true, can_view_sql: false });
    const { GET } = await import("@/app/api/admin/runs/parity-review/route");
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(mocks.runs).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });

  it("blocks missing tenant, disabled comparison and injected query params", async () => {
    const { GET } = await import("@/app/api/admin/runs/parity-review/route");
    mocks.tenant.mockReturnValueOnce({ status: "required" });
    expect((await GET(request())).status).toBe(403);
    mocks.enabled.mockReturnValueOnce(false);
    expect((await GET(request())).status).toBe(503);
    for (const query of [
      "?limit=100", "?limit=-1", "?limit=1&limit=2",
      "?offset=99999999", "?officialSql=SELECT%201",
      "?organizationId=tenant-b"
    ]) expect((await GET(request(query))).status).toBe(400);
    expect(mocks.runs).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });

  it("discards any cross-tenant row before the comparison when tenant mode is active", async () => {
    mocks.runs.mockResolvedValueOnce({
      total: 2, runs: [
        { id: "run-a", organization_id: "tenant-a" },
        { id: "run-b", organization_id: "tenant-b" }
      ]
    });
    const { GET } = await import("@/app/api/admin/runs/parity-review/route");
    expect((await GET(request())).status).toBe(200);
    expect(mocks.inspect).toHaveBeenCalledWith([
      { id: "run-a", organization_id: "tenant-a" }
    ]);
  });

  it("does not expose internal errors", async () => {
    mocks.runs.mockRejectedValueOnce(new Error("private DSN string"));
    const { GET } = await import("@/app/api/admin/runs/parity-review/route");
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("private DSN");
  });
});
