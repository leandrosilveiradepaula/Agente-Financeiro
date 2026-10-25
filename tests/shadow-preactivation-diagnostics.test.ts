import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAgentSession: vi.fn(),
  getProfilePolicy: vi.fn()
}));
vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
    status: init?.status ?? 200, headers: init?.headers,
    json: async () => body
  }) }
}));
vi.mock("@/lib/server-auth", () => ({
  requireAgentSession: mocks.requireAgentSession
}));
vi.mock("@/lib/profile-policy", () => ({
  getProfilePolicy: mocks.getProfilePolicy
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  mocks.requireAgentSession.mockReset();
  mocks.getProfilePolicy.mockReset();
  mocks.requireAgentSession.mockResolvedValue({
    session: { userId: "operator", userProfile: "auditoria" },
    response: null
  });
  mocks.getProfilePolicy.mockResolvedValue({
    can_manage_users: false, can_view_all_runs: true
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("Shadow pre-activation diagnostics", () => {
  it("shows missing server-only configuration without secrets, URLs or calls", async () => {
    vi.stubEnv("LANGGRAPH_SHADOW_ENABLED", "false");
    vi.stubEnv("LANGGRAPH_SHADOW_TRANSPORT", "n8n");
    vi.stubEnv("LANGGRAPH_SHADOW_N8N_WEBHOOK_URL",
      "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1");
    vi.stubEnv("N8N_SHADOW_WEBHOOK_TOKEN", "synthetic-shadow-secret");
    vi.stubEnv("LANGGRAPH_S2S_TOKEN", "synthetic-s2s-secret");
    vi.stubEnv("LANGGRAPH_INTERNAL_BASE_URL", "");
    vi.stubEnv("VERCEL", "1");
    const { GET } = await import("@/app/api/admin/orchestration-diagnostics/route");
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers).toEqual({ "Cache-Control": "no-store" });
    expect(body.langgraph_shadow).toMatchObject({
      enabled: false,
      transport: "n8n",
      generate_target_configured: true,
      execute_target_configured: true,
      dispatch_ready: false,
      evidence_read_configured: false,
      blockers: ["feature_disabled"]
    });
    const text = JSON.stringify(body);
    for(const secret of ["synthetic-shadow-secret", "synthetic-s2s-secret",
      "n8n.example.test", "127.0.0.1"]) expect(text).not.toContain(secret);
  });

  it("reports an invalid canary structurally without exposing its allowlist", async () => {
    vi.stubEnv("LANGGRAPH_SHADOW_ENABLED", "true");
    vi.stubEnv("LANGGRAPH_SHADOW_TRANSPORT", "n8n");
    vi.stubEnv("LANGGRAPH_SHADOW_N8N_WEBHOOK_URL",
      "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1");
    vi.stubEnv("N8N_SHADOW_WEBHOOK_TOKEN", "synthetic-shadow-secret");
    vi.stubEnv("LANGGRAPH_S2S_TOKEN", "synthetic-s2s-secret");
    vi.stubEnv("LANGGRAPH_SHADOW_CANARY_SUBJECTS_JSON", "not-json");
    vi.stubEnv("LANGGRAPH_SHADOW_CANARY_EXPIRES_AT", "2099-01-01T00:00:00Z");
    const { GET } = await import("@/app/api/admin/orchestration-diagnostics/route");
    const response = await GET();
    const body = await response.json();
    expect(body.langgraph_shadow).toMatchObject({
      enabled: true,
      canary_status: "invalid",
      canary_ready: false,
      dispatch_ready: false
    });
    expect(body.langgraph_shadow.blockers).toContain("canary_invalid");
    const text = JSON.stringify(body);
    for(const sensitive of ["not-json", "synthetic-shadow-secret", "n8n.example.test"])
      expect(text).not.toContain(sensitive);
  });

  it("refuses Shadow metadata to profiles without audit capability", async () => {
    mocks.getProfilePolicy.mockResolvedValue({
      can_manage_users: false, can_view_all_runs: false
    });
    const { GET } = await import("@/app/api/admin/orchestration-diagnostics/route");
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: "forbidden" });
  });

  it("rejects unauthenticated request before reading policy or environment", async () => {
    const unauthorized = {
      status: 401, json: async () => ({ success: false, error: "unauthorized" })
    };
    mocks.requireAgentSession.mockResolvedValue({ session: null, response: unauthorized });
    const { GET } = await import("@/app/api/admin/orchestration-diagnostics/route");
    expect(await GET()).toBe(unauthorized);
    expect(mocks.getProfilePolicy).not.toHaveBeenCalled();
  });
});
