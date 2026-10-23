import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentRunById: vi.fn(),
  getProfilePolicy: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent-runs", () => ({ getAgentRunById: mocks.getAgentRunById }));
vi.mock("@/lib/profile-policy", () => ({ getProfilePolicy: mocks.getProfilePolicy }));

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const session = {
  sessionId: "session-1", userId: "user-a", name: "User A",
  email: "a@example.test", userProfile: "auditoria", organizationId: organizationA
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
  mocks.getAgentRunById.mockReset();
  mocks.getProfilePolicy.mockReset();
  mocks.getProfilePolicy.mockResolvedValue({
    can_view_all_runs: true, can_view_own_runs: false, can_view_sql: false
  });
});

describe("persisted tenant identity", () => {
  it("adds only the authenticated persisted organization to a Shadow principal", async () => {
    const { buildLangGraphShadowPrincipal } = await import("@/lib/langgraph-shadow-client");
    expect(buildLangGraphShadowPrincipal(session)).toEqual({
      id: "user-a", email: "a@example.test", profile: "auditoria",
      organization_id: organizationA
    });
  });

  it("fails closed for a tenant-enabled session without a resolved membership", async () => {
    const { buildLangGraphShadowPrincipal } = await import("@/lib/langgraph-shadow-client");
    const { authorizeAdminRunReadAccess } = await import("@/lib/admin-run-access");
    expect(buildLangGraphShadowPrincipal({ ...session, organizationId: undefined })).toBeNull();
    await expect(authorizeAdminRunReadAccess("run-a", { ...session, organizationId: undefined }))
      .resolves.toMatchObject({ allowed: false, status: 403, error: "tenant_identity_required" });
    expect(mocks.getAgentRunById).not.toHaveBeenCalled();
  });

  it("filters an all-runs audit policy by tenant before exposing a run", async () => {
    mocks.getAgentRunById.mockResolvedValue({
      id: "run-a", user_id: "other-user", user_email: "other@example.test",
      organization_id: organizationA
    });
    const { authorizeAdminRunReadAccess } = await import("@/lib/admin-run-access");
    const result = await authorizeAdminRunReadAccess("run-a", session);
    expect(result).toMatchObject({ allowed: true, scope: "all_runs" });
    expect(mocks.getAgentRunById).toHaveBeenCalledWith("run-a", organizationA);
  });

  it("does not reveal a run belonging to another organization", async () => {
    // The data access layer returns null because its SQL predicate uses A;
    // B's run must look absent even for a profile allowed to view all A runs.
    mocks.getAgentRunById.mockResolvedValue(null);
    const { authorizeAdminRunReadAccess } = await import("@/lib/admin-run-access");
    await expect(authorizeAdminRunReadAccess("run-in-b", session)).resolves.toMatchObject({
      allowed: false, status: 404, error: "run_not_found"
    });
    expect(mocks.getAgentRunById).toHaveBeenCalledWith("run-in-b", organizationA);
    expect(mocks.getAgentRunById).not.toHaveBeenCalledWith("run-in-b", organizationB);
  });
});

describe("official financial datasource tenant gate", () => {
  it("preserves the disabled legacy environment without needing new schema or bindings", async () => {
    const { getTenantOfficialExecutionScope } = await import("@/lib/tenant-identity");
    expect(getTenantOfficialExecutionScope(session, {
      AGENT_TENANT_IDENTITY_ENABLED: "false"
    })).toEqual({ status: "legacy" });
  });

  it("fails closed until an explicit official financial deployment scope is configured", async () => {
    const { getTenantOfficialExecutionScope } = await import("@/lib/tenant-identity");
    const enabled = { AGENT_TENANT_IDENTITY_ENABLED: "true" };
    expect(getTenantOfficialExecutionScope(session, enabled))
      .toEqual({ status: "official_scope_unconfigured" });
    expect(getTenantOfficialExecutionScope(session, {
      ...enabled, AGENT_TENANT_OFFICIAL_ORGANIZATION_ID: "not-a-uuid"
    })).toEqual({ status: "official_scope_unconfigured" });
    expect(getTenantOfficialExecutionScope({ ...session, organizationId: undefined }, {
      ...enabled, AGENT_TENANT_OFFICIAL_ORGANIZATION_ID: organizationA
    })).toEqual({ status: "tenant_identity_required" });
  });

  it("denies other organizations even when both memberships exist in the Product", async () => {
    const { getTenantOfficialExecutionScope } = await import("@/lib/tenant-identity");
    const scopedEnvironment = {
      AGENT_TENANT_IDENTITY_ENABLED: "true",
      AGENT_TENANT_OFFICIAL_ORGANIZATION_ID: organizationA
    };
    expect(getTenantOfficialExecutionScope(session, scopedEnvironment))
      .toEqual({ status: "ready", organizationId: organizationA });
    expect(getTenantOfficialExecutionScope({
      ...session, organizationId: organizationB
    }, scopedEnvironment)).toEqual({ status: "official_scope_mismatch" });
    // Diagnostic signals never disclose a UUID or membership.
    const { inspectTenantIdentityConfiguration } = await import("@/lib/tenant-identity");
    const report = inspectTenantIdentityConfiguration(scopedEnvironment);
    expect(report.official_execution_scope_configured).toBe(true);
    expect(JSON.stringify(report)).not.toContain(organizationA);
  });
});
