import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { query } }));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  query.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("session tenant resolution", () => {
  it("preserves the legacy session query while the opt-in source is disabled", async () => {
    query.mockResolvedValueOnce({ rows: [{
      session_id: "s", user_id: "u", name: "User", email: "u@example.test", user_profile: "audit"
    }] });
    const { getSessionByToken } = await import("@/lib/auth/session-service");
    await expect(getSessionByToken("token")).resolves.toMatchObject({ userId: "u" });
    expect(String(query.mock.calls[0][0])).not.toContain("ai_agent_user_organizations");
  });

  it("loads organization only through active persisted membership when enabled", async () => {
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    query.mockResolvedValueOnce({ rows: [{
      session_id: "s", user_id: "u", name: "User", email: "u@example.test", user_profile: "audit",
      organization_id: "11111111-1111-4111-8111-111111111111"
    }] });
    const { getSessionByToken } = await import("@/lib/auth/session-service");
    await expect(getSessionByToken("token")).resolves.toMatchObject({
      organizationId: "11111111-1111-4111-8111-111111111111"
    });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("ai_agent_user_organizations");
    expect(sql).toContain("m.is_active = true");
    expect(sql).toContain("o.is_active = true");
  });

  it("accepts an explicit session selection only after membership validation", async () => {
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    query.mockResolvedValueOnce({ rows: [{ id: "session-1" }] });
    const { selectSessionOrganizationByToken } = await import("@/lib/auth/session-service");
    await expect(selectSessionOrganizationByToken(
      "token", "11111111-1111-4111-8111-111111111111"
    )).resolves.toBe(true);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("membership.user_id = s.user_id");
    expect(sql).toContain("membership.organization_id = $2::uuid");
  });
});
