import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAgentSession: vi.fn(),
  getProfilePolicy: vi.fn()
}));

vi.mock("@/lib/server-auth", () => ({
  requireAgentSession: mocks.requireAgentSession
}));

vi.mock("@/lib/profile-policy", () => ({
  getProfilePolicy: mocks.getProfilePolicy
}));

describe("orchestration diagnostics route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();

    mocks.requireAgentSession.mockResolvedValue({
      session: {
        userId: "admin-1",
        userProfile: "admin"
      },
      response: null
    });

    mocks.getProfilePolicy.mockResolvedValue({
      can_manage_users: true,
      can_view_all_runs: true
    });
  });

  it("returns only a sanitized webhook path and fingerprint", async () => {
    vi.stubEnv(
      "N8N_GENERATE_SQL_WEBHOOK_URL",
      "https://n8n.example.test/webhook/abc-123"
    );
    vi.stubEnv("LANGGRAPH_SHADOW_ENABLED", "true");

    const { GET } = await import("@/app/api/admin/orchestration-diagnostics/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      n8n_generate_sql: {
        configured: true,
        path_suffix: "abc-123"
      },
      langgraph_shadow_enabled: true
    });
    expect(body.n8n_generate_sql.fingerprint).toMatch(/^[a-f0-9]{12}$/);
    expect(JSON.stringify(body)).not.toContain("n8n.example.test");
    expect(JSON.stringify(body)).not.toContain(
      "https://n8n.example.test/webhook/abc-123"
    );
  });

  it("fails closed for profiles without operational audit access", async () => {
    mocks.getProfilePolicy.mockResolvedValue({
      can_manage_users: false,
      can_view_all_runs: false
    });

    const { GET } = await import("@/app/api/admin/orchestration-diagnostics/route");
    const response = await GET();

    expect(response.status).toBe(403);
  });
});
