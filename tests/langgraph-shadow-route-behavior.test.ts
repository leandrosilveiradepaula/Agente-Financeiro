import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
  requireAgentSession: vi.fn(),
  getRequestMetadata: vi.fn(),
  createAgentRun: vi.fn(),
  getAgentRunById: vi.fn(),
  markAgentRunBlocked: vi.fn(),
  updateAgentRunGeneratedSql: vi.fn(),
  updateAgentRunExecution: vi.fn(),
  findLatestComparableLlmRunForCacheSavings: vi.fn(),
  enforceCanGenerateSql: vi.fn(),
  enforceCanExecuteSql: vi.fn(),
  enforceIntentPolicy: vi.fn(),
  enforceSqlTablePolicy: vi.fn(),
  buildPolicyDeniedResponse: vi.fn(),
  isLangGraphShadowEnabled: vi.fn(),
  buildLangGraphShadowPrincipal: vi.fn(),
  dispatchLangGraphGenerateShadow: vi.fn(),
  dispatchLangGraphExecuteApprovedShadow: vi.fn(),
  loggerWarn: vi.fn()
}));

vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    routeMocks.afterCallbacks.push(callback);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body
    })
  }
}));

vi.mock("@/lib/server-auth", () => ({
  requireAgentSession: routeMocks.requireAgentSession,
  getRequestMetadata: routeMocks.getRequestMetadata
}));

vi.mock("@/lib/agent-runs", () => ({
  createAgentRun: routeMocks.createAgentRun,
  getAgentRunById: routeMocks.getAgentRunById,
  markAgentRunBlocked: routeMocks.markAgentRunBlocked,
  updateAgentRunGeneratedSql: routeMocks.updateAgentRunGeneratedSql,
  updateAgentRunExecution: routeMocks.updateAgentRunExecution,
  findLatestComparableLlmRunForCacheSavings:
    routeMocks.findLatestComparableLlmRunForCacheSavings
}));

vi.mock("@/lib/profile-policy", () => ({
  enforceCanGenerateSql: routeMocks.enforceCanGenerateSql,
  enforceCanExecuteSql: routeMocks.enforceCanExecuteSql,
  enforceIntentPolicy: routeMocks.enforceIntentPolicy,
  enforceSqlTablePolicy: routeMocks.enforceSqlTablePolicy,
  buildPolicyDeniedResponse: routeMocks.buildPolicyDeniedResponse
}));

vi.mock("@/lib/n8n-endpoint", () => ({
  N8N_WATSON_ORCHESTRATE_ENDPOINT: "http://n8n.test/webhook"
}));

vi.mock("@/lib/server-logger", () => ({
  logger: {
    info: vi.fn(),
    warn: routeMocks.loggerWarn,
    error: vi.fn()
  }
}));

vi.mock("@/lib/langgraph-shadow-client", () => ({
  isLangGraphShadowEnabled: routeMocks.isLangGraphShadowEnabled,
  buildLangGraphShadowPrincipal: routeMocks.buildLangGraphShadowPrincipal,
  dispatchLangGraphGenerateShadow: routeMocks.dispatchLangGraphGenerateShadow,
  dispatchLangGraphExecuteApprovedShadow:
    routeMocks.dispatchLangGraphExecuteApprovedShadow
}));

const session = {
  sessionId: "session-1",
  userId: "user-1",
  name: "User One",
  email: "user@example.com",
  userProfile: "admin"
};

const policy = {
  can_view_sql: true,
  allowed_tables: [],
  denied_tables: []
};

const agentRunId = "11111111-1111-4111-8111-111111111111";

function resetRouteMocks() {
  vi.resetModules();
  vi.stubEnv("N8N_INTERNAL_WEBHOOK_TOKEN", "test-token");
  routeMocks.afterCallbacks.length = 0;
  routeMocks.loggerWarn.mockReset();
  routeMocks.requireAgentSession.mockResolvedValue({ session, response: null });
  routeMocks.getRequestMetadata.mockResolvedValue({
    ipAddress: "127.0.0.1",
    userAgent: "vitest"
  });
  routeMocks.createAgentRun.mockResolvedValue({
    id: agentRunId,
    run_id: agentRunId
  });
  routeMocks.getAgentRunById.mockResolvedValue({
    id: agentRunId,
    sql_generated: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10"
  });
  routeMocks.markAgentRunBlocked.mockResolvedValue(undefined);
  routeMocks.updateAgentRunGeneratedSql.mockResolvedValue(undefined);
  routeMocks.updateAgentRunExecution.mockResolvedValue(undefined);
  routeMocks.findLatestComparableLlmRunForCacheSavings.mockResolvedValue(null);
  routeMocks.enforceCanGenerateSql.mockResolvedValue({
    allowed: true,
    policy,
    reason: null
  });
  routeMocks.enforceCanExecuteSql.mockResolvedValue({
    allowed: true,
    policy,
    reason: null
  });
  routeMocks.enforceIntentPolicy.mockReturnValue({ allowed: true, reason: null });
  routeMocks.enforceSqlTablePolicy.mockReturnValue({
    allowed: true,
    reason: null,
    blockedTable: null,
    extractedTables: []
  });
  routeMocks.buildPolicyDeniedResponse.mockReturnValue({
    success: false,
    error: "policy_denied"
  });
  routeMocks.isLangGraphShadowEnabled.mockReturnValue(false);
  routeMocks.buildLangGraphShadowPrincipal.mockReturnValue({
    id: "user-1",
    email: "user@example.com",
    profile: "admin"
  });
  routeMocks.dispatchLangGraphGenerateShadow.mockResolvedValue({ status: "sent" });
  routeMocks.dispatchLangGraphExecuteApprovedShadow.mockResolvedValue({
    status: "sent"
  });
}

function mockOfficialGenerateFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        success: true,
        sql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10",
        agent_version: "official-n8n-version",
        detected_intent: "resultado_por_marca",
        validation_status: "aprovado",
        raw: {
          source: "n8n"
        }
      })
  });
}

function mockOfficialExecuteFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        success: true,
        query_id: "query-1",
        execution_time_ms: 12,
        row_count: 1,
        columns: ["marca"],
        data: [{ marca: "A" }],
        raw: {
          source: "n8n"
        },
        truncated: false
      })
  });
}

async function readGenerateResponse(enabled: boolean) {
  resetRouteMocks();
  routeMocks.isLangGraphShadowEnabled.mockReturnValue(enabled);
  vi.stubGlobal("fetch", mockOfficialGenerateFetch());

  const { POST } = await import("@/app/api/generate-sql/route");
  const response = await POST(
    new Request("http://localhost/api/generate-sql", {
      method: "POST",
      body: JSON.stringify({
        pergunta: "Qual foi o resultado por marca?"
      })
    })
  );

  return {
    response,
    body: await response.json()
  };
}

async function readExecuteResponse(enabled: boolean) {
  resetRouteMocks();
  routeMocks.isLangGraphShadowEnabled.mockReturnValue(enabled);
  vi.stubGlobal("fetch", mockOfficialExecuteFetch());

  const { POST } = await import("@/app/api/execute-watson/route");
  const approvedSql = "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10";
  const response = await POST(
    new Request("http://localhost/api/execute-watson", {
      method: "POST",
      body: JSON.stringify({
        pergunta: "Execute a SQL aprovada",
        sql: approvedSql,
        agent_run_id: agentRunId
      })
    })
  );

  return {
    response,
    body: await response.json(),
    approvedSql
  };
}

describe("LangGraph shadow route behavior", () => {
  beforeEach(() => {
    resetRouteMocks();
  });

  it("keeps generate n8n call and official response unchanged when shadow is disabled", async () => {
    const { response, body } = await readGenerateResponse(false);

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "http://n8n.test/webhook",
      expect.objectContaining({ method: "POST" })
    );
    expect(body).toMatchObject({
      success: true,
      sql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10",
      agent_run_id: agentRunId,
      run_id: agentRunId
    });
    expect(routeMocks.afterCallbacks).toHaveLength(0);
    expect(routeMocks.dispatchLangGraphGenerateShadow).not.toHaveBeenCalled();
  });

  it("schedules generate shadow with agent_run_id, question, and sanitized principal", async () => {
    const { body } = await readGenerateResponse(true);

    expect(body).toMatchObject({
      success: true,
      agent_run_id: agentRunId
    });
    expect(routeMocks.afterCallbacks).toHaveLength(1);

    await routeMocks.afterCallbacks[0]();

    expect(routeMocks.dispatchLangGraphGenerateShadow).toHaveBeenCalledWith({
      agentRunId,
      question: "Qual foi o resultado por marca?",
      principal: {
        id: "user-1",
        email: "user@example.com",
        profile: "admin"
      },
      requestId: expect.any(String),
      agentVersion: expect.any(String)
    });
  });

  it("does not alter generate response when shadow reports failure or timeout", async () => {
    const disabled = await readGenerateResponse(false);
    const failed = await readGenerateResponse(true);
    const timedOut = await readGenerateResponse(true);

    expect(failed.body).toEqual(disabled.body);
    expect(timedOut.body).toEqual(disabled.body);
  });

  it("handles unexpected generate shadow exceptions with sanitized logging", async () => {
    const disabled = await readGenerateResponse(false);
    const enabled = await readGenerateResponse(true);
    routeMocks.dispatchLangGraphGenerateShadow.mockRejectedValueOnce(
      new Error("secret sql question and token")
    );

    await expect(routeMocks.afterCallbacks[0]()).resolves.toBeUndefined();

    expect(enabled.body).toEqual(disabled.body);
    expect(routeMocks.loggerWarn).toHaveBeenCalledWith(
      "generate_sql.langgraph_shadow_unexpected_error",
      {
        requestId: expect.any(String),
        agentRunId,
        errorName: "UnexpectedShadowError"
      }
    );
    expect(JSON.stringify(routeMocks.loggerWarn.mock.calls)).not.toContain(
      "secret sql question and token"
    );
  });

  it("does not propagate generate shadow logger exceptions", async () => {
    const { body } = await readGenerateResponse(true);
    routeMocks.dispatchLangGraphGenerateShadow.mockResolvedValueOnce({
      status: "network_error"
    });
    routeMocks.loggerWarn.mockImplementationOnce(() => {
      throw new Error("logger failed with secret token");
    });

    await expect(routeMocks.afterCallbacks[0]()).resolves.toBeUndefined();

    expect(body).toMatchObject({
      success: true,
      agent_run_id: agentRunId
    });
  });

  it("keeps execute n8n/Watson flow and official response unchanged when shadow is disabled", async () => {
    const { response, body } = await readExecuteResponse(false);

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "http://n8n.test/webhook",
      expect.objectContaining({ method: "POST" })
    );
    expect(body).toMatchObject({
      success: true,
      agent_run_id: agentRunId,
      run_id: agentRunId,
      row_count: 1
    });
    expect(routeMocks.afterCallbacks).toHaveLength(0);
    expect(routeMocks.dispatchLangGraphExecuteApprovedShadow).not.toHaveBeenCalled();
  });

  it("schedules execute-approved shadow with approved SQL unchanged", async () => {
    const { approvedSql } = await readExecuteResponse(true);

    expect(routeMocks.afterCallbacks).toHaveLength(1);

    await routeMocks.afterCallbacks[0]();

    expect(routeMocks.dispatchLangGraphExecuteApprovedShadow).toHaveBeenCalledWith({
      agentRunId,
      approvedSql,
      principal: {
        id: "user-1",
        email: "user@example.com",
        profile: "admin"
      },
      requestId: expect.any(String)
    });
  });

  it("does not alter execute response when shadow reports failure or timeout", async () => {
    const disabled = await readExecuteResponse(false);
    const failed = await readExecuteResponse(true);
    const timedOut = await readExecuteResponse(true);

    expect(failed.body).toEqual(disabled.body);
    expect(timedOut.body).toEqual(disabled.body);
  });

  it("handles unexpected execute shadow exceptions with sanitized logging", async () => {
    const disabled = await readExecuteResponse(false);
    const enabled = await readExecuteResponse(true);
    routeMocks.dispatchLangGraphExecuteApprovedShadow.mockRejectedValueOnce(
      new Error("secret approved SQL and token")
    );

    await expect(routeMocks.afterCallbacks[0]()).resolves.toBeUndefined();

    expect(enabled.body).toEqual(disabled.body);
    expect(routeMocks.loggerWarn).toHaveBeenCalledWith(
      "execute_watson.langgraph_shadow_unexpected_error",
      {
        requestId: expect.any(String),
        agentRunId,
        errorName: "UnexpectedShadowError"
      }
    );
    expect(JSON.stringify(routeMocks.loggerWarn.mock.calls)).not.toContain(
      "secret approved SQL and token"
    );
  });

  it("does not propagate execute shadow logger exceptions", async () => {
    const { body } = await readExecuteResponse(true);
    routeMocks.dispatchLangGraphExecuteApprovedShadow.mockResolvedValueOnce({
      status: "http_error",
      httpStatus: 500
    });
    routeMocks.loggerWarn.mockImplementationOnce(() => {
      throw new Error("logger failed with secret token");
    });

    await expect(routeMocks.afterCallbacks[0]()).resolves.toBeUndefined();

    expect(body).toMatchObject({
      success: true,
      agent_run_id: agentRunId
    });
  });
});
