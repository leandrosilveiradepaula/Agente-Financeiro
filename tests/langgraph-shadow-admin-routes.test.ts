import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireAgentSession: vi.fn(),
  getProfilePolicy: vi.fn(),
  getAgentRunById: vi.fn(),
  listLangGraphShadowRuns: vi.fn(),
  getLangGraphShadowRun: vi.fn(),
  getLangGraphShadowRunVisualization: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body
    })
  }
}));

vi.mock("@/lib/server-auth", () => ({
  requireAgentSession: routeMocks.requireAgentSession
}));

vi.mock("@/lib/profile-policy", () => ({
  getProfilePolicy: routeMocks.getProfilePolicy
}));

vi.mock("@/lib/agent-runs", () => ({
  getAgentRunById: routeMocks.getAgentRunById
}));

vi.mock("@/lib/langgraph-shadow-read-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/langgraph-shadow-read-client")>();

  return {
    listLangGraphShadowRuns: routeMocks.listLangGraphShadowRuns,
    getLangGraphShadowRun: routeMocks.getLangGraphShadowRun,
    getLangGraphShadowRunVisualization: routeMocks.getLangGraphShadowRunVisualization,
    sanitizeShadowRunVisualizationForBrowser:
      actual.sanitizeShadowRunVisualizationForBrowser
  };
});

vi.mock("@/lib/server-logger", () => ({
  logger: {
    info: routeMocks.loggerInfo,
    warn: routeMocks.loggerWarn,
    error: routeMocks.loggerError
  }
}));

const agentRunId = "11111111-1111-4111-8111-111111111111";
const otherAgentRunId = "22222222-2222-4222-8222-222222222222";
const shadowRecordId = "shadow-record-1";

const session = {
  sessionId: "session-1",
  userId: "user-1",
  name: "User One",
  email: "user@example.com",
  userProfile: "auditoria"
};

const commercialSession = {
  ...session,
  userProfile: "comercial"
};

const allRunsPolicy = {
  can_view_all_runs: true,
  can_view_own_runs: false,
  can_view_sql: false
};

const ownRunsPolicy = {
  can_view_all_runs: false,
  can_view_own_runs: true,
  can_view_sql: false
};

const noRunsPolicy = {
  can_view_all_runs: false,
  can_view_own_runs: false,
  can_view_sql: false
};

const officialRun = {
  id: agentRunId,
  user_id: "user-1",
  user_email: "user@example.com"
};

const otherRun = {
  id: otherAgentRunId,
  user_id: "user-2",
  user_email: "other@example.com"
};

const shadowRun = {
  shadow_record_id: shadowRecordId,
  agent_run_id: agentRunId,
  event_type: "generate",
  status: "completed",
  created_at: "2026-01-01T00:00:00.000Z",
  completed_at: "2026-01-01T00:00:01.000Z",
  requires_reapproval: false
};

const visualization = {
  contract_version: "1",
  run: shadowRun,
  steps: [
    {
      id: "step-1",
      order: 1,
      label: "generate_sql",
      status: "success"
    }
  ],
  edges: [],
  flags: {}
};

function routeContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

function resetMocks() {
  vi.resetModules();
  vi.stubEnv("LANGGRAPH_SHADOW_ENABLED", "false");
  routeMocks.requireAgentSession.mockReset();
  routeMocks.getProfilePolicy.mockReset();
  routeMocks.getAgentRunById.mockReset();
  routeMocks.listLangGraphShadowRuns.mockReset();
  routeMocks.getLangGraphShadowRun.mockReset();
  routeMocks.getLangGraphShadowRunVisualization.mockReset();
  routeMocks.loggerInfo.mockReset();
  routeMocks.loggerWarn.mockReset();
  routeMocks.loggerError.mockReset();
  routeMocks.requireAgentSession.mockResolvedValue({ session, response: null });
  routeMocks.getProfilePolicy.mockResolvedValue(allRunsPolicy);
  routeMocks.getAgentRunById.mockResolvedValue(officialRun);
  routeMocks.listLangGraphShadowRuns.mockResolvedValue({
    status: "ok",
    httpStatus: 200,
    data: [shadowRun]
  });
  routeMocks.getLangGraphShadowRun.mockResolvedValue({
    status: "ok",
    httpStatus: 200,
    data: shadowRun
  });
  routeMocks.getLangGraphShadowRunVisualization.mockResolvedValue({
    status: "ok",
    httpStatus: 200,
    data: visualization
  });
}

beforeEach(() => {
  resetMocks();
});

describe("admin Shadow BFF routes", () => {
  it("lists shadow runs for a user authorized to view the official run", async () => {
    const { GET } = await import("@/app/api/admin/runs/[id]/shadow-runs/route");
    const response = await GET(
      new Request(`http://localhost/api/admin/runs/${agentRunId}/shadow-runs?limit=25`),
      routeContext({ id: agentRunId })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      shadow_runs: [shadowRun],
      comparison_enabled: false,
      shadow_enabled: false
    });
    expect(routeMocks.listLangGraphShadowRuns).toHaveBeenCalledWith(agentRunId, {
      limit: 25
    });
  });

  it("allows own-run users to list Shadow only for their own official run", async () => {
    routeMocks.requireAgentSession.mockResolvedValue({
      session: commercialSession,
      response: null
    });
    routeMocks.getProfilePolicy.mockResolvedValue(ownRunsPolicy);

    const { GET } = await import("@/app/api/admin/runs/[id]/shadow-runs/route");
    const ownResponse = await GET(
      new Request(`http://localhost/api/admin/runs/${agentRunId}/shadow-runs`),
      routeContext({ id: agentRunId })
    );

    expect(ownResponse.status).toBe(200);
    expect(routeMocks.listLangGraphShadowRuns).toHaveBeenCalledWith(agentRunId, {
      limit: 10
    });

    routeMocks.listLangGraphShadowRuns.mockClear();
    routeMocks.getAgentRunById.mockResolvedValue(otherRun);

    const otherResponse = await GET(
      new Request(`http://localhost/api/admin/runs/${otherAgentRunId}/shadow-runs`),
      routeContext({ id: otherAgentRunId })
    );
    const otherBody = await otherResponse.json();

    expect(otherResponse.status).toBe(403);
    expect(otherBody).toEqual({ success: false, error: "forbidden" });
    expect(routeMocks.listLangGraphShadowRuns).not.toHaveBeenCalled();
  });

  it("returns 403 before reading Shadow when the user cannot view runs", async () => {
    routeMocks.requireAgentSession.mockResolvedValue({
      session: commercialSession,
      response: null
    });
    routeMocks.getProfilePolicy.mockResolvedValue(noRunsPolicy);

    const { GET } = await import("@/app/api/admin/runs/[id]/shadow-runs/route");
    const response = await GET(
      new Request(`http://localhost/api/admin/runs/${agentRunId}/shadow-runs`),
      routeContext({ id: agentRunId })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ success: false, error: "forbidden" });
    expect(routeMocks.listLangGraphShadowRuns).not.toHaveBeenCalled();
  });

  it("returns 404 when the official run does not exist", async () => {
    routeMocks.getAgentRunById.mockResolvedValue(null);

    const { GET } = await import("@/app/api/admin/runs/[id]/shadow-runs/route");
    const response = await GET(
      new Request(`http://localhost/api/admin/runs/${agentRunId}/shadow-runs`),
      routeContext({ id: agentRunId })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ success: false, error: "run_not_found" });
    expect(routeMocks.listLangGraphShadowRuns).not.toHaveBeenCalled();
  });

  it("maps LangGraph 503 to a safe unavailable response", async () => {
    routeMocks.listLangGraphShadowRuns.mockResolvedValue({
      status: "unavailable",
      httpStatus: 503,
      errorMessage: "LangGraph shadow read failed"
    });

    const { GET } = await import("@/app/api/admin/runs/[id]/shadow-runs/route");
    const response = await GET(
      new Request(`http://localhost/api/admin/runs/${agentRunId}/shadow-runs`),
      routeContext({ id: agentRunId })
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      error: "shadow_unavailable",
      shadow_status: "unavailable",
      shadow_http_status: 503
    });
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("internal raw body");
  });

  it("maps timeouts to a safe unavailable response", async () => {
    routeMocks.listLangGraphShadowRuns.mockResolvedValue({
      status: "timeout",
      errorName: "AbortError",
      errorMessage: "LangGraph shadow read failed"
    });

    const { GET } = await import("@/app/api/admin/runs/[id]/shadow-runs/route");
    const response = await GET(
      new Request(`http://localhost/api/admin/runs/${agentRunId}/shadow-runs`),
      routeContext({ id: agentRunId })
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      error: "shadow_unavailable",
      shadow_status: "timeout"
    });
  });

  it("maps LangGraph S2S 401 to safe Shadow service unavailable", async () => {
    routeMocks.listLangGraphShadowRuns.mockResolvedValue({
      status: "unavailable",
      httpStatus: 401,
      errorMessage: "LangGraph shadow read failed"
    });

    const { GET } = await import("@/app/api/admin/runs/[id]/shadow-runs/route");
    const response = await GET(
      new Request(`http://localhost/api/admin/runs/${agentRunId}/shadow-runs`),
      routeContext({ id: agentRunId })
    );
    const body = await response.json();
    const serialized = JSON.stringify(body).toLowerCase();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      error: "shadow_unavailable",
      shadow_status: "unavailable",
      shadow_http_status: 401
    });
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("unauthorized");
  });

  it("does not let LANGGRAPH_SHADOW_ENABLED block administrative reads", async () => {
    vi.stubEnv("LANGGRAPH_SHADOW_ENABLED", "false");

    const { GET } = await import("@/app/api/admin/runs/[id]/shadow-runs/route");
    const response = await GET(
      new Request(`http://localhost/api/admin/runs/${agentRunId}/shadow-runs`),
      routeContext({ id: agentRunId })
    );

    expect(response.status).toBe(200);
    expect(routeMocks.listLangGraphShadowRuns).toHaveBeenCalled();
  });

  it("returns success with an empty list when no shadow evidence exists", async () => {
    routeMocks.listLangGraphShadowRuns.mockResolvedValue({
      status: "ok",
      httpStatus: 200,
      data: []
    });

    const { GET } = await import("@/app/api/admin/runs/[id]/shadow-runs/route");
    const response = await GET(
      new Request(`http://localhost/api/admin/runs/${agentRunId}/shadow-runs`),
      routeContext({ id: agentRunId })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      shadow_runs: [],
      comparison_enabled: false,
      shadow_enabled: false
    });
  });

  it("returns visualization after resolving and authorizing the correlated official run", async () => {
    const { GET } = await import(
      "@/app/api/admin/shadow-runs/[shadow_record_id]/visualization/route"
    );
    const response = await GET(
      new Request(`http://localhost/api/admin/shadow-runs/${shadowRecordId}/visualization`),
      routeContext({ shadow_record_id: shadowRecordId })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(routeMocks.getLangGraphShadowRun).toHaveBeenCalledWith(shadowRecordId);
    expect(routeMocks.getAgentRunById).toHaveBeenCalledWith(agentRunId);
    expect(routeMocks.getLangGraphShadowRunVisualization).toHaveBeenCalledWith(shadowRecordId);
    expect(body).toEqual({
      success: true,
      visualization
    });
  });

  it("sanitizes malicious metadata before returning visualization to the browser", async () => {
    routeMocks.getLangGraphShadowRunVisualization.mockResolvedValue({
      status: "ok",
      httpStatus: 200,
      data: {
        ...visualization,
        steps: [
          {
            id: "step-1",
            order: 1,
            label: "repair_sql",
            status: "success",
            metadata: {
              attempt: 1,
              cycle: 2,
              duration_ms: 15,
              failure_category: "repairable",
              requires_reapproval: true,
              approved_sql: "SENSITIVE",
              question: "SENSITIVE",
              token: "SENSITIVE",
              authorization: "SENSITIVE",
              cookie: "SENSITIVE",
              raw_response: "SENSITIVE",
              dsn: "SENSITIVE",
              unexpected_nested: {
                secret: "SENSITIVE"
              }
            }
          }
        ]
      }
    });

    const { GET } = await import(
      "@/app/api/admin/shadow-runs/[shadow_record_id]/visualization/route"
    );
    const response = await GET(
      new Request(`http://localhost/api/admin/shadow-runs/${shadowRecordId}/visualization`),
      routeContext({ shadow_record_id: shadowRecordId })
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.visualization.steps[0].metadata).toEqual({
      attempt: 1,
      cycle: 2,
      duration_ms: 15,
      failure_category: "repairable",
      requires_reapproval: true
    });
    expect(serialized).not.toContain("approved_sql");
    expect(serialized).not.toContain("question");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("raw_response");
    expect(serialized).not.toContain("dsn");
    expect(serialized).not.toContain("unexpected_nested");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("SENSITIVE");
  });

  it("rejects visualization when metadata agent_run_id and visualization agent_run_id differ", async () => {
    routeMocks.getLangGraphShadowRunVisualization.mockResolvedValue({
      status: "ok",
      httpStatus: 200,
      data: {
        ...visualization,
        run: {
          ...shadowRun,
          agent_run_id: otherAgentRunId
        }
      }
    });

    const { GET } = await import(
      "@/app/api/admin/shadow-runs/[shadow_record_id]/visualization/route"
    );
    const response = await GET(
      new Request(`http://localhost/api/admin/shadow-runs/${shadowRecordId}/visualization`),
      routeContext({ shadow_record_id: shadowRecordId })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ success: false, error: "forbidden" });
  });

  it("rejects visualization when metadata shadow_record_id and visualization shadow_record_id differ", async () => {
    routeMocks.getLangGraphShadowRunVisualization.mockResolvedValue({
      status: "ok",
      httpStatus: 200,
      data: {
        ...visualization,
        run: {
          ...shadowRun,
          shadow_record_id: "shadow-record-2"
        }
      }
    });

    const { GET } = await import(
      "@/app/api/admin/shadow-runs/[shadow_record_id]/visualization/route"
    );
    const response = await GET(
      new Request(`http://localhost/api/admin/shadow-runs/${shadowRecordId}/visualization`),
      routeContext({ shadow_record_id: shadowRecordId })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ success: false, error: "forbidden" });
  });

  it("blocks visualization when the correlated official run is outside own-run scope", async () => {
    routeMocks.requireAgentSession.mockResolvedValue({
      session: commercialSession,
      response: null
    });
    routeMocks.getProfilePolicy.mockResolvedValue(ownRunsPolicy);
    routeMocks.getAgentRunById.mockResolvedValue(otherRun);
    routeMocks.getLangGraphShadowRun.mockResolvedValue({
      status: "ok",
      httpStatus: 200,
      data: {
        ...shadowRun,
        agent_run_id: otherAgentRunId
      }
    });

    const { GET } = await import(
      "@/app/api/admin/shadow-runs/[shadow_record_id]/visualization/route"
    );
    const response = await GET(
      new Request(`http://localhost/api/admin/shadow-runs/${shadowRecordId}/visualization`),
      routeContext({ shadow_record_id: shadowRecordId })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ success: false, error: "forbidden" });
    expect(routeMocks.getLangGraphShadowRunVisualization).not.toHaveBeenCalled();
  });

  it("does not allow a known shadow_record_id to bypass run authorization", async () => {
    routeMocks.requireAgentSession.mockResolvedValue({
      session: commercialSession,
      response: null
    });
    routeMocks.getProfilePolicy.mockResolvedValue(ownRunsPolicy);
    routeMocks.getAgentRunById.mockResolvedValue(otherRun);
    routeMocks.getLangGraphShadowRun.mockResolvedValue({
      status: "ok",
      httpStatus: 200,
      data: {
        ...shadowRun,
        agent_run_id: otherAgentRunId
      }
    });

    const { GET } = await import(
      "@/app/api/admin/shadow-runs/[shadow_record_id]/visualization/route"
    );
    const response = await GET(
      new Request(`http://localhost/api/admin/shadow-runs/${shadowRecordId}/visualization`),
      routeContext({ shadow_record_id: shadowRecordId })
    );

    expect(response.status).toBe(403);
    expect(routeMocks.getLangGraphShadowRunVisualization).not.toHaveBeenCalled();
  });
});
