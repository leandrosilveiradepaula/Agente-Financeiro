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
  recordShadowDispatchReceipt: vi.fn(),
  findLatestComparableLlmRunForCacheSavings: vi.fn(),
  enforceCanGenerateSql: vi.fn(),
  enforceCanExecuteSql: vi.fn(),
  enforceIntentPolicy: vi.fn(),
  enforceSqlTablePolicy: vi.fn(),
  buildPolicyDeniedResponse: vi.fn(),
  isLangGraphShadowEnabled: vi.fn(),
  isLangGraphShadowCanaryEligible: vi.fn(),
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
  recordShadowDispatchReceipt: routeMocks.recordShadowDispatchReceipt,
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
  getN8nGenerateSqlWebhookEndpoint: () => "http://n8n.test/webhook",
  getN8nExecuteWatsonWebhookEndpoint: () => "http://n8n.test/webhook"
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
  isLangGraphShadowCanaryEligible: routeMocks.isLangGraphShadowCanaryEligible,
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
  vi.unstubAllEnvs();
  vi.stubEnv("N8N_INTERNAL_WEBHOOK_TOKEN", "test-token");
  routeMocks.afterCallbacks.length = 0;
  routeMocks.loggerWarn.mockReset();
  routeMocks.isLangGraphShadowCanaryEligible.mockReset();
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
  routeMocks.recordShadowDispatchReceipt.mockReset();
  routeMocks.recordShadowDispatchReceipt.mockResolvedValue(undefined);
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
    error: "policy_denied",
    message: "Ação bloqueada pela política do perfil."
  });
  routeMocks.isLangGraphShadowEnabled.mockReturnValue(false);
  routeMocks.isLangGraphShadowCanaryEligible.mockReturnValue({ status: "ready", allowed: true });
  routeMocks.buildLangGraphShadowPrincipal.mockReturnValue({
    id: "user-1",
    email: "user@example.com",
    profile: "admin"
  });
  routeMocks.dispatchLangGraphGenerateShadow.mockReset();
  routeMocks.dispatchLangGraphExecuteApprovedShadow.mockReset();
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
  it("keeps the official generate response and schedules no Shadow work for a denied canary", async () => {
    const baseline = await readGenerateResponse(false);
    resetRouteMocks();
    routeMocks.isLangGraphShadowEnabled.mockReturnValue(true);
    routeMocks.isLangGraphShadowCanaryEligible.mockReturnValue({ status: "ready", allowed: false });
    vi.stubGlobal("fetch", mockOfficialGenerateFetch());
    const { POST } = await import("@/app/api/generate-sql/route");
    const response = await POST(new Request("http://localhost/api/generate-sql", {
      method: "POST", body: JSON.stringify({ pergunta: "Pergunta de teste" })
    }));
    expect(await response.json()).toEqual(baseline.body);
    expect(routeMocks.afterCallbacks).toHaveLength(0);
    expect(routeMocks.dispatchLangGraphGenerateShadow).not.toHaveBeenCalled();
    expect(routeMocks.recordShadowDispatchReceipt).not.toHaveBeenCalled();
  });

  it("keeps approved execution official and schedules no Shadow work for a denied canary", async () => {
    const baseline = await readExecuteResponse(false);
    resetRouteMocks();
    routeMocks.isLangGraphShadowEnabled.mockReturnValue(true);
    routeMocks.isLangGraphShadowCanaryEligible.mockReturnValue({ status: "ready", allowed: false });
    vi.stubGlobal("fetch", mockOfficialExecuteFetch());
    const { POST } = await import("@/app/api/execute-watson/route");
    const response = await POST(new Request("http://localhost/api/execute-watson", {
      method: "POST", body: JSON.stringify({
        pergunta: "Pergunta de teste", agent_run_id: agentRunId,
        sql: "SELECT 1"
      })
    }));
    expect(await response.json()).toEqual(baseline.body);
    expect(routeMocks.afterCallbacks).toHaveLength(0);
    expect(routeMocks.dispatchLangGraphExecuteApprovedShadow).not.toHaveBeenCalled();
    expect(routeMocks.recordShadowDispatchReceipt).not.toHaveBeenCalled();
  });
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

  it("does not schedule direct shadow when LangGraph is already official via n8n", async () => {
    resetRouteMocks();
    routeMocks.isLangGraphShadowEnabled.mockReturnValue(true);
    vi.stubEnv("LANGGRAPH_OFFICIAL_VIA_N8N", "true");
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

    expect(response.status).toBe(200);
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

    expect(routeMocks.recordShadowDispatchReceipt).toHaveBeenCalledWith({
      id: agentRunId,
      event: "generate",
      requestId: expect.any(String),
      status: "sent",
      httpStatus: undefined,
      organizationId: undefined
    });
    expect(routeMocks.dispatchLangGraphGenerateShadow).toHaveBeenCalledWith({
      agentRunId,
      question: "Qual foi o resultado por marca?",
      principal: {
        id: "user-1",
        email: "user@example.com",
        profile: "admin"
      },
      requestId: expect.any(String),
      agentVersion: expect.any(String),
      llmSelection: {
        provider_key: "google_gemini",
        model_key: "gemini-2.5-flash",
        config_version: "gemini-demo-v1"
      },
      timeoutMs: 180000
    });
  });

  it("prevents an alternate configured provider from running in Phase 1", async () => {
    resetRouteMocks();
    routeMocks.isLangGraphShadowEnabled.mockReturnValue(true);
    const fetchImpl = mockOfficialGenerateFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const { POST } = await import("@/app/api/generate-sql/route");
    const response = await POST(new Request("http://localhost/api/generate-sql", {
      method: "POST",
      body: JSON.stringify({
        pergunta: "Qual foi o resultado por marca?",
        llm_selection: {
          provider_key: "infodive_ibm_cloud",
          model_key: "SQL-InfoDive",
          config_version: "sql-infodive-ibm-cloud-v1"
        }
      })
    }));
    const officialBody = JSON.parse(String(fetchImpl.mock.calls[0][1].body));

    expect(response.status).toBe(200);
    expect(officialBody).not.toHaveProperty("llm_selection");
    expect(officialBody).not.toHaveProperty("llm_registry_version");
    expect(routeMocks.afterCallbacks).toHaveLength(0);
    expect(routeMocks.dispatchLangGraphGenerateShadow).not.toHaveBeenCalled();
    expect(routeMocks.loggerWarn).toHaveBeenCalledWith(
      "generate_sql.shadow_phase_one_provider_mismatch",
      {
        requestId: expect.any(String),
        userId: "user-1",
        userProfile: "admin"
      }
    );
  });

  it("preserves explicit same-provider selection for Phase 1 Shadow", async () => {
    resetRouteMocks();
    routeMocks.isLangGraphShadowEnabled.mockReturnValue(true);
    vi.stubGlobal("fetch", mockOfficialGenerateFetch());
    const { POST } = await import("@/app/api/generate-sql/route");
    const response = await POST(new Request("http://localhost/api/generate-sql", {
      method: "POST",
      body: JSON.stringify({
        pergunta: "Qual foi o resultado por marca?",
        llm_selection: {
          provider_key: "google_gemini",
          model_key: "gemini-2.5-flash",
          config_version: "gemini-demo-v1"
        }
      })
    }));
    expect(response.status).toBe(200);
    expect(routeMocks.afterCallbacks).toHaveLength(1);
    await routeMocks.afterCallbacks[0]();
    expect(routeMocks.dispatchLangGraphGenerateShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        llmSelection: {
          provider_key: "google_gemini",
          model_key: "gemini-2.5-flash",
          config_version: "gemini-demo-v1"
        }
      })
    );
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
    expect(routeMocks.recordShadowDispatchReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ id: agentRunId, event: "generate", status: "unexpected_error" })
    );
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

  it("preserves the official response when a Shadow audit receipt cannot be written", async () => {
    const { body } = await readGenerateResponse(true);
    routeMocks.recordShadowDispatchReceipt.mockRejectedValueOnce(
      new Error("postgres://secret@internal / raw financial SQL")
    );
    await expect(routeMocks.afterCallbacks[0]()).resolves.toBeUndefined();
    expect(body).toMatchObject({ success: true, agent_run_id: agentRunId });
    expect(routeMocks.loggerWarn).toHaveBeenCalledWith(
      "generate_sql.shadow_receipt_persistence_failed",
      { requestId: expect.any(String), agentRunId }
    );
    expect(JSON.stringify(routeMocks.loggerWarn.mock.calls)).not.toContain("secret@internal");
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

  it("never duplicates execute-approved Shadow dispatch when LangGraph becomes official via n8n", async () => {
    resetRouteMocks();
    routeMocks.isLangGraphShadowEnabled.mockReturnValue(true);
    vi.stubEnv("LANGGRAPH_OFFICIAL_VIA_N8N", "true");
    vi.stubGlobal("fetch", mockOfficialExecuteFetch());

    const { POST } = await import("@/app/api/execute-watson/route");
    const response = await POST(new Request("http://localhost/api/execute-watson", {
      method: "POST",
      body: JSON.stringify({
        pergunta: "Execute a SQL aprovada",
        sql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10",
        agent_run_id: agentRunId
      })
    }));
    expect(response.status).toBe(200);
    expect(routeMocks.afterCallbacks).toHaveLength(0);
    expect(routeMocks.dispatchLangGraphExecuteApprovedShadow).not.toHaveBeenCalled();
    expect(routeMocks.recordShadowDispatchReceipt).not.toHaveBeenCalled();
  });

  it("schedules execute-approved shadow with approved SQL unchanged", async () => {
    const { approvedSql } = await readExecuteResponse(true);

    expect(routeMocks.afterCallbacks).toHaveLength(1);

    await routeMocks.afterCallbacks[0]();

    expect(routeMocks.recordShadowDispatchReceipt).toHaveBeenCalledWith({
      id: agentRunId,
      event: "execute_approved",
      requestId: expect.any(String),
      status: "sent",
      httpStatus: undefined,
      organizationId: undefined
    });
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
    expect(routeMocks.recordShadowDispatchReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ id: agentRunId, event: "execute_approved", status: "unexpected_error" })
    );
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

  it("blocks commercial profile analysis before calling the DEMO webhook", async () => {
    resetRouteMocks();
    vi.stubEnv("AGENT_INTERFACE_MODE", "  DeMo  ");
    routeMocks.requireAgentSession.mockResolvedValue({
      session: {
        ...session,
        userProfile: "comercial"
      },
      response: null
    });
    routeMocks.enforceCanGenerateSql.mockResolvedValue({
      allowed: false,
      policy: {
        ...policy,
        can_view_sql: false
      },
      reason: "profile_cannot_generate_sql"
    });
    routeMocks.buildPolicyDeniedResponse.mockReturnValue({
      success: false,
      error: "profile_cannot_generate_sql",
      message: "Seu perfil não possui permissão para gerar consultas SQL."
    });
    vi.stubGlobal("fetch", vi.fn());

    const { POST } = await import("@/app/api/generate-sql/route");
    const response = await POST(
      new Request("http://localhost/api/generate-sql", {
        method: "POST",
        body: JSON.stringify({
          pergunta: "Qual foi o resultado?"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(routeMocks.markAgentRunBlocked).toHaveBeenCalledWith(
      expect.objectContaining({
        executionError: "profile_cannot_generate_sql"
      })
    );
    expect(body).toMatchObject({
      success: false,
      error: "profile_cannot_generate_sql",
      message: "Seu perfil não possui permissão para gerar consultas SQL.",
      sql: "",
      raw: null,
      can_view_sql: false,
      sql_hidden: true
    });
    expect(JSON.stringify(body)).not.toContain("webhook");
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("returns and persists DEMO combined execution results without scheduling a second execution", async () => {
    resetRouteMocks();
    vi.stubEnv("AGENT_INTERFACE_MODE", "demo");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            sql: "SELECT campo FROM dev_lakehouse.main_gold.resultado LIMIT 10",
            agent_version: "demo-version",
            detected_intent: "consulta_demo",
            validation_status: "aprovado",
            relatorio_executivo: {
              title: "Resumo do backend",
              paragraphs: ["Resposta executiva produzida no backend."],
              highlights: [],
              warnings: []
            },
            columns: ["campo"],
            data: [],
            row_count: 0,
            execution_time_ms: 15,
            executor_mode: "demo",
            executor_version: "v1",
            runtime_data_source: "masked-demo",
            data_source_fingerprint: "fingerprint-demo",
            status_operacional: "ok",
            raw_result: {
              rows: 0
            }
          })
      })
    );

    const { POST } = await import("@/app/api/generate-sql/route");
    const response = await POST(
      new Request("http://localhost/api/generate-sql", {
        method: "POST",
        body: JSON.stringify({
          pergunta: "Qual foi o resultado?"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(routeMocks.enforceCanExecuteSql).toHaveBeenCalledWith("admin");
    expect(routeMocks.updateAgentRunExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        id: agentRunId,
        executionStatus: "executed",
        rowCount: 0,
        columns: ["campo"],
        data: [],
        executionTimeMs: 15,
        executorMode: "demo",
        executorVersion: "v1",
        metadata: expect.objectContaining({
          runtime_data_source: "masked-demo",
          data_source_fingerprint: "fingerprint-demo",
          status_operacional: "ok",
          raw_result: {
            rows: 0
          }
        })
      })
    );
    expect(body).toMatchObject({
      success: true,
      execution_result: {
        success: true,
        relatorio_executivo: {
          title: "Resumo do backend"
        },
        columns: ["campo"],
        data: [],
        row_count: 0,
        execution_time_ms: 15,
        agent_run_id: agentRunId,
        run_id: agentRunId
      }
    });
    expect(routeMocks.dispatchLangGraphExecuteApprovedShadow).not.toHaveBeenCalled();
  });
  it("never auto-executes SQL during Generate when an authenticated tenant is active", async () => {
    resetRouteMocks();
    const organization = "11111111-1111-4111-8111-111111111111";
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    vi.stubEnv("AGENT_TENANT_OFFICIAL_ORGANIZATION_ID", organization);
    vi.stubEnv("AGENT_INTERFACE_MODE", "demo");
    routeMocks.requireAgentSession.mockResolvedValue({
      session: { ...session, organizationId: organization }, response: null
    });
    const send = mockOfficialGenerateFetch();
    vi.stubGlobal("fetch", send);
    routeMocks.createAgentRun.mockClear();
    routeMocks.updateAgentRunExecution.mockClear();
    const { POST } = await import("@/app/api/generate-sql/route");
    const response = await POST(new Request("http://localhost/api/generate-sql", {
      method: "POST",
      body: JSON.stringify({ pergunta: "Qual foi o resultado financeiro?" })
    }));
    expect(response.status).toBe(409);
    expect(send).not.toHaveBeenCalled();
    expect(routeMocks.createAgentRun).not.toHaveBeenCalled();
    expect(routeMocks.updateAgentRunExecution).not.toHaveBeenCalled();
    expect(routeMocks.afterCallbacks).toHaveLength(0);
  });

  it("refuses tenant-mode official calls without an attested datasource organization", async () => {
    const org = "11111111-1111-4111-8111-111111111111";
    for (const endpoint of ["generate", "execute"] as const) {
      resetRouteMocks();
      // Existing tests reuse vi.fn references; isolate the negative-call
      // assertions from calls made by preceding test cases.
      routeMocks.createAgentRun.mockClear();
      routeMocks.getAgentRunById.mockClear();
      vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
      routeMocks.requireAgentSession.mockResolvedValue({
        session: { ...session, organizationId: org }, response: null
      });
      const sent = vi.fn();
      vi.stubGlobal("fetch", sent);
      const { POST } = endpoint === "generate"
        ? await import("@/app/api/generate-sql/route")
        : await import("@/app/api/execute-watson/route");
      const body = endpoint === "generate"
        ? { pergunta: "Financeiro por período" }
        : { pergunta: "Executar SQL", agent_run_id: agentRunId, sql: "SELECT 1" };
      const result = await POST(new Request(`http://localhost/api/${endpoint}`, {
        method: "POST", body: JSON.stringify(body)
      }));
      expect(result.status).toBe(503);
      expect(sent).not.toHaveBeenCalled();
      expect(routeMocks.createAgentRun).not.toHaveBeenCalled();
      expect(routeMocks.getAgentRunById).not.toHaveBeenCalled();
      expect(routeMocks.afterCallbacks).toHaveLength(0);
    }
  });

  it("prevents an organization B session from using organization A's official datasource", async () => {
    resetRouteMocks();
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    vi.stubEnv("AGENT_TENANT_OFFICIAL_ORGANIZATION_ID",
      "11111111-1111-4111-8111-111111111111");
    routeMocks.requireAgentSession.mockResolvedValue({
      session: {
        ...session,
        organizationId: "22222222-2222-4222-8222-222222222222"
      }, response: null
    });
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);
    const { POST } = await import("@/app/api/generate-sql/route");
    const response = await POST(new Request("http://localhost/api/generate-sql", {
      method: "POST", body: JSON.stringify({ pergunta: "Question for B" })
    }));
    expect(response.status).toBe(503);
    expect(sent).not.toHaveBeenCalled();
  });

  it("generates server-owned correlation and forces off shared n8n cache in scoped mode", async () => {
    resetRouteMocks();
    const org = "11111111-1111-4111-8111-111111111111";
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    vi.stubEnv("AGENT_TENANT_OFFICIAL_ORGANIZATION_ID", org);
    routeMocks.requireAgentSession.mockResolvedValue({
      session: { ...session, organizationId: org }, response: null
    });
    const send = mockOfficialGenerateFetch();
    vi.stubGlobal("fetch", send);
    const { POST } = await import("@/app/api/generate-sql/route");
    const response = await POST(new Request("http://localhost/api/generate-sql", {
      method: "POST",
      body: JSON.stringify({
        pergunta: "Unique financial question",
        run_id: "user-forged-run",
        options: { use_sql_cache: true }
      })
    }));
    expect(response.status).toBe(200);
    expect(routeMocks.createAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: undefined,
      session: expect.objectContaining({ organizationId: org })
    }));
    const body = JSON.parse(String(send.mock.calls[0][1].body));
    expect(body.run_id).toBe(agentRunId);
    expect(body.options.use_sql_cache).toBe(false);
  });

  it("rejects SQL returned from an unscoped n8n cache even when requesting no cache", async () => {
    resetRouteMocks();
    const org = "11111111-1111-4111-8111-111111111111";
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    vi.stubEnv("AGENT_TENANT_OFFICIAL_ORGANIZATION_ID", org);
    routeMocks.requireAgentSession.mockResolvedValue({
      session: { ...session, organizationId: org }, response: null
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify({
        success: true, sql: "SELECT hidden_tenant_data",
        cache: { enabled: true, hit: true, source: "sql_generation_cache" }
      })
    }));
    const { POST } = await import("@/app/api/generate-sql/route");
    const response = await POST(new Request("http://localhost/api/generate-sql", {
      method: "POST", body: JSON.stringify({ pergunta: "Scoped question" })
    }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("hidden_tenant_data");
    expect(routeMocks.updateAgentRunGeneratedSql).toHaveBeenCalledWith(expect.objectContaining({
      id: agentRunId, executionStatus: "failed",
      executionError: "tenant_sql_cache_not_isolated"
    }));
    expect(routeMocks.afterCallbacks).toHaveLength(0);
  });

  it("executes only tracked unchanged SQL when the tenant boundary is on", async () => {
    resetRouteMocks();
    const org = "11111111-1111-4111-8111-111111111111";
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    vi.stubEnv("AGENT_TENANT_OFFICIAL_ORGANIZATION_ID", org);
    routeMocks.requireAgentSession.mockResolvedValue({
      session: { ...session, organizationId: org }, response: null
    });
    const send = mockOfficialExecuteFetch();
    vi.stubGlobal("fetch", send);
    const { POST } = await import("@/app/api/execute-watson/route");
    const make = (payload: Record<string, unknown>) => POST(
      new Request("http://localhost/api/execute-watson", {
        method: "POST", body: JSON.stringify({ pergunta: "Execute approved", ...payload })
      })
    );
    expect((await make({ sql: "SELECT 1" })).status).toBe(403);
    expect((await make({
      agent_run_id: agentRunId,
      sql: "SELECT modified_against_original"
    })).status).toBe(409);
    expect(send).not.toHaveBeenCalled();
    expect(routeMocks.getAgentRunById).toHaveBeenCalledWith(agentRunId, org);
    const response = await make({
      agent_run_id: agentRunId,
      sql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10"
    });
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

});
