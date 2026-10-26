import { describe, expect, it, vi } from "vitest";
import {
  buildLangGraphShadowPrincipal,
  dispatchLangGraphExecuteApprovedShadow,
  dispatchLangGraphGenerateShadow,
  dispatchLangGraphP2GenerateOnly,
  isLangGraphShadowDispatchConfigured,
  inspectLangGraphShadowDispatchConfiguration
} from "@/lib/langgraph-shadow-client";
import type { AgentSession } from "@/lib/auth/auth-types";

const enabledEnv = {
  LANGGRAPH_SHADOW_ENABLED: "true",
  LANGGRAPH_INTERNAL_BASE_URL: "http://127.0.0.1:8000",
  LANGGRAPH_SHADOW_TIMEOUT_MS: "1500",
  LANGGRAPH_S2S_TOKEN: "test-s2s-token",
  LANGGRAPH_SHADOW_CANARY_SUBJECTS_JSON:
    '[{"user_id":"11111111-1111-4111-8111-111111111111"}]',
  LANGGRAPH_SHADOW_CANARY_EXPIRES_AT: "2099-01-01T00:00:00Z"
};

const baseInput = {
  agentRunId: "11111111-1111-4111-8111-111111111111",
  question: "Qual foi o resultado por marca?",
  principal: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    profile: "admin"
  },
  requestId: "request-1",
  agentVersion: "test-version"
};

function okResponse(body = "{}") {
  return {
    ok: true,
    status: 200,
    text: async () => body
  } as Response;
}

function statusResponse(status: number) {
  return {
    ok: false,
    status,
    text: async () => "{}"
  } as Response;
}

function readRequestBody(fetchImpl: ReturnType<typeof vi.fn>) {
  const init = fetchImpl.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

async function expectShadowTimeoutDelay(
  rawTimeout: string | undefined,
  expectedDelayMs: number,
  modelTimeoutMs?: number
) {
  vi.useFakeTimers();
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
  const env: Record<string, string | undefined> = { ...enabledEnv };

  if (rawTimeout === undefined) {
    delete env.LANGGRAPH_SHADOW_TIMEOUT_MS;
  } else {
    env.LANGGRAPH_SHADOW_TIMEOUT_MS = rawTimeout;
  }

  const fetchImpl = vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })
  );

  try {
    const resultPromise = dispatchLangGraphGenerateShadow(
      {
        ...baseInput,
        ...(modelTimeoutMs !== undefined ? { timeoutMs: modelTimeoutMs } : {})
      },
      {
        env,
        fetchImpl
      }
    );

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expectedDelayMs);

    await vi.advanceTimersByTimeAsync(expectedDelayMs);

    await expect(resultPromise).resolves.toMatchObject({
      status: "timeout"
    });
  } finally {
    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  }
}

describe("LangGraph shadow client", () => {
  it("reports safe local pre-activation readiness for both generate and execute targets", () => {
    const env = {
      ...enabledEnv,
      LANGGRAPH_SHADOW_TRANSPORT: "n8n",
      LANGGRAPH_SHADOW_N8N_WEBHOOK_URL:
        "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1",
      N8N_SHADOW_WEBHOOK_TOKEN: "synthetic-webhook-secret",
      LANGGRAPH_SHADOW_ENABLED: "false"
    };
    const disabled = inspectLangGraphShadowDispatchConfiguration(env);
    expect(disabled).toMatchObject({
      enabled: false,
      transport: "n8n",
      generate_target_configured: true,
      execute_target_configured: true,
      dispatch_ready: false,
      blockers: ["feature_disabled"]
    });
    const enabled = inspectLangGraphShadowDispatchConfiguration({
      ...env, LANGGRAPH_SHADOW_ENABLED: "true"
    });
    expect(enabled.dispatch_ready).toBe(true);
    expect(enabled.blockers).toEqual([]);
    expect(JSON.stringify(enabled)).not.toContain("synthetic-webhook-secret");
  });

  it("fails readiness closed for a one-sided relay and unsupported transport", () => {
    const relay = {
      ...enabledEnv,
      LANGGRAPH_SHADOW_TRANSPORT: "n8n_relay",
      LANGGRAPH_SHADOW_RELAY_GENERATE_URL: "https://n8n.example.test/relay/generate",
      LANGGRAPH_SHADOW_RELAY_TOKEN: "test-relay-secret"
    };
    expect(inspectLangGraphShadowDispatchConfiguration(relay)).toMatchObject({
      generate_target_configured: true,
      execute_target_configured: false,
      dispatch_ready: false,
      blockers: ["execute_target_unconfigured"]
    });
    // Legacy relay can still dispatch a generate event, but cannot be
    // declared fully ready for BOTH event types until execute is configured.
    expect(isLangGraphShadowDispatchConfigured(relay)).toBe(true);
    const unknown = inspectLangGraphShadowDispatchConfiguration({
      ...enabledEnv, LANGGRAPH_SHADOW_TRANSPORT: "invalid-mode"
    });
    expect(unknown).toMatchObject({
      transport: "unsupported",
      dispatch_ready: false
    });
    expect(unknown.blockers).toContain("unsupported_transport");
    expect(inspectLangGraphShadowDispatchConfiguration({
      ...enabledEnv, LANGGRAPH_OFFICIAL_VIA_N8N: "true"
    }).blockers).toContain("already_official");
  });

  it("reports configured dispatch only when required values are present", () => {
    expect(isLangGraphShadowDispatchConfigured(enabledEnv)).toBe(true);
    expect(isLangGraphShadowDispatchConfigured({ ...enabledEnv, LANGGRAPH_SHADOW_ENABLED: "false" })).toBe(false);
    expect(isLangGraphShadowDispatchConfigured({ ...enabledEnv, LANGGRAPH_OFFICIAL_VIA_N8N: "true" })).toBe(false);
    expect(isLangGraphShadowDispatchConfigured({ ...enabledEnv, LANGGRAPH_S2S_TOKEN: "" })).toBe(false);
    expect(isLangGraphShadowDispatchConfigured({ ...enabledEnv, LANGGRAPH_INTERNAL_BASE_URL: "" })).toBe(false);
    expect(isLangGraphShadowDispatchConfigured({ ...enabledEnv, VERCEL: "1" })).toBe(false);
    expect(isLangGraphShadowDispatchConfigured({ ...enabledEnv, VERCEL: "1", LANGGRAPH_INTERNAL_BASE_URL: "https://shadow.example.test" })).toBe(true);
    expect(isLangGraphShadowDispatchConfigured({ ...enabledEnv, VERCEL: "1", LANGGRAPH_INTERNAL_BASE_URL: "http://shadow.example.test" })).toBe(false);
    expect(isLangGraphShadowDispatchConfigured({ ...enabledEnv, LANGGRAPH_INTERNAL_BASE_URL: "https://user:pass@shadow.example.test" })).toBe(false);
  });
  it("uses the separate parallel n8n Header Auth webhook with a correlated 202 acknowledgement", async () => {
    const env = {
      ...enabledEnv,
      VERCEL: "1",
      LANGGRAPH_SHADOW_TRANSPORT: "n8n",
      LANGGRAPH_SHADOW_N8N_WEBHOOK_URL:
        "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1",
      N8N_SHADOW_WEBHOOK_TOKEN: "synthetic-n8n-webhook-token",
      LANGGRAPH_S2S_TOKEN: ""
    };
    expect(isLangGraphShadowDispatchConfigured(env)).toBe(true);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => JSON.stringify({
        contract_version: "1",
        accepted: true,
        agent_run_id: baseInput.agentRunId,
        event: "generate"
      })
    } as Response);
    const selection = {
      provider_key: "provider-fixture",
      model_key: "model-fixture",
      config_version: "version-fixture"
    };
    const result = await dispatchLangGraphGenerateShadow(
      { ...baseInput, llmSelection: selection },
      { env, fetchImpl }
    );
    expect(result).toEqual({ status: "sent", httpStatus: 202 });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1"
    );
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({
      "X-Agent-Shadow-Token": "synthetic-n8n-webhook-token",
      "Content-Type": "application/json"
    });
    expect(init.redirect).toBe("error");
    const sent = readRequestBody(fetchImpl);
    expect(sent.llm_selection).toEqual(selection);
    expect(sent.agent_run_id).toBe(baseInput.agentRunId);
    expect((sent.correlation_metadata as Record<string, unknown>).event).toBe("generate");
    expect(JSON.stringify(sent)).not.toContain("synthetic-n8n-webhook-token");
  });

  it("uses the same parallel n8n webhook for approved-SQL evidence only", async () => {
    const env = {
      ...enabledEnv,
      LANGGRAPH_SHADOW_TRANSPORT: "n8n",
      LANGGRAPH_SHADOW_N8N_WEBHOOK_URL:
        "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1",
      N8N_SHADOW_WEBHOOK_TOKEN: "synthetic-n8n-webhook-token"
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => JSON.stringify({
        contract_version: "1",
        accepted: true,
        agent_run_id: baseInput.agentRunId,
        event: "execute_approved"
      })
    } as Response);
    const approvedSql = "SELECT opaque_value FROM authorized_relation";
    const result = await dispatchLangGraphExecuteApprovedShadow({
      agentRunId: baseInput.agentRunId,
      approvedSql,
      principal: baseInput.principal,
      requestId: baseInput.requestId
    }, { env, fetchImpl });
    expect(result.status).toBe("sent");
    const body = readRequestBody(fetchImpl);
    expect(body.approved_sql).toBe(approvedSql);
    expect((body.correlation_metadata as Record<string, unknown>).event).toBe("execute_approved");
    expect(body).not.toHaveProperty("llm_selection");
  });

  it("rejects false or incomplete parallel n8n acknowledgements", async () => {
    const env = {
      ...enabledEnv,
      LANGGRAPH_SHADOW_TRANSPORT: "n8n",
      LANGGRAPH_SHADOW_N8N_WEBHOOK_URL:
        "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1",
      N8N_SHADOW_WEBHOOK_TOKEN: "synthetic-n8n-webhook-token"
    };
    const valid = {
      contract_version: "1", accepted: true,
      agent_run_id: baseInput.agentRunId, event: "generate"
    };
    for (const [status, body] of [
      [200, valid],
      [202, { ...valid, agent_run_id: "other-run" }],
      [202, { ...valid, event: "execute_approved" }],
      [202, { ...valid, contract_version: "2" }],
      [202, { ...valid, accepted: "true" }],
      [202, { ...valid, accepted: false }],
      [202, { relay_status: "accepted", agent_run_id: baseInput.agentRunId }],
      [202, null]
    ] as const) {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status,
        text: async () => JSON.stringify(body)
      } as Response);
      expect((await dispatchLangGraphGenerateShadow(baseInput, { env, fetchImpl })).status)
        .toBe("invalid_response");
    }
  });

  it("fails closed for missing or unsafe parallel n8n endpoint configuration", async () => {
    const base = {
      ...enabledEnv,
      LANGGRAPH_SHADOW_TRANSPORT: "n8n",
      N8N_SHADOW_WEBHOOK_TOKEN: "synthetic-n8n-webhook-token"
    };
    const invalid = [
      "",
      "http://n8n.example.test/webhook/langgraph-shadow-parallel-v1",
      "https://127.0.0.1/webhook/langgraph-shadow-parallel-v1",
      "https://user:secret@n8n.example.test/webhook/langgraph-shadow-parallel-v1",
      "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1?token=bad",
      "https://n8n.example.test/webhook/other",
      "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1/extra"
    ];
    for (const url of invalid) {
      const env = { ...base, LANGGRAPH_SHADOW_N8N_WEBHOOK_URL: url };
      const fetchImpl = vi.fn();
      expect(isLangGraphShadowDispatchConfigured(env)).toBe(false);
      expect((await dispatchLangGraphGenerateShadow(baseInput, { env, fetchImpl })).status)
        .toBe("configuration_error");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    expect(isLangGraphShadowDispatchConfigured({
      ...base,
      LANGGRAPH_SHADOW_N8N_WEBHOOK_URL:
        "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1",
      N8N_SHADOW_WEBHOOK_TOKEN: ""
    })).toBe(false);
    expect(isLangGraphShadowDispatchConfigured({
      ...base,
      LANGGRAPH_SHADOW_N8N_WEBHOOK_URL:
        "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1",
      LANGGRAPH_OFFICIAL_VIA_N8N: "true"
    })).toBe(false);
  });

  it("uses a separate authenticated HTTPS relay for generate", async () => {
    const env = { ...enabledEnv, VERCEL: "1",
      LANGGRAPH_SHADOW_TRANSPORT: "n8n_relay",
      LANGGRAPH_SHADOW_RELAY_GENERATE_URL: "https://relay.example.test/webhook/shadow",
      LANGGRAPH_SHADOW_RELAY_TOKEN: "separate-relay-token",
      LANGGRAPH_S2S_TOKEN: ""
    };
    expect(isLangGraphShadowDispatchConfigured(env)).toBe(true);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(
      JSON.stringify({ relay_status: "accepted", agent_run_id: baseInput.agentRunId })
    ));
    const result = await dispatchLangGraphGenerateShadow({
      ...baseInput,
      llmSelection: {provider_key:"infodive_ibm_cloud",model_key:"SQL-InfoDive",config_version:"sql-infodive-ibm-cloud-v1"}
    },{env,fetchImpl});
    expect(result.status).toBe("sent");
    expect(fetchImpl.mock.calls[0][0]).toBe("https://relay.example.test/webhook/shadow");
    expect((fetchImpl.mock.calls[0][1].headers as Record<string,string>).Authorization).toBe("Bearer separate-relay-token");
    expect(readRequestBody(fetchImpl).llm_selection).toMatchObject({model_key:"SQL-InfoDive"});
    expect((fetchImpl.mock.calls[0][1] as RequestInit).redirect).toBe("error");
  });
  it("rejects relay success without a matching correlated acknowledgement", async () => {
    const env = {...enabledEnv, LANGGRAPH_SHADOW_TRANSPORT:"n8n_relay",
      LANGGRAPH_SHADOW_RELAY_GENERATE_URL:"https://relay.example.test/webhook/shadow",
      LANGGRAPH_SHADOW_RELAY_TOKEN:"relay-token"};
    for (const body of ["{}", JSON.stringify({relay_status:"accepted",agent_run_id:"wrong"}), ""]) {
      const fetchImpl=vi.fn().mockResolvedValue(okResponse(body));
      const result=await dispatchLangGraphGenerateShadow(baseInput,{env,fetchImpl});
      expect(result.status).toBe("invalid_response");
    }
  });
  it("fails closed with an insecure or incomplete relay", async () => {
    for (const endpoint of ["http://relay.example.test/webhook/abc","https://127.0.0.1/webhook/abc","https://relay.example.test/","https://relay.example.test/webhook/abc?token=bad"]) {
      const env={...enabledEnv,VERCEL:"1",LANGGRAPH_SHADOW_TRANSPORT:"n8n_relay",
        LANGGRAPH_SHADOW_RELAY_GENERATE_URL:endpoint,LANGGRAPH_SHADOW_RELAY_TOKEN:"separate-token"};
      expect(isLangGraphShadowDispatchConfigured(env)).toBe(false);
      const fetchImpl=vi.fn();
      expect((await dispatchLangGraphGenerateShadow(baseInput,{env,fetchImpl})).status).toBe("configuration_error");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
  it("does not send approved execution to the generate relay", async () => {
    const env={...enabledEnv,LANGGRAPH_SHADOW_TRANSPORT:"n8n_relay",
      LANGGRAPH_SHADOW_RELAY_GENERATE_URL:"https://relay.example.test/webhook/shadow",LANGGRAPH_SHADOW_RELAY_TOKEN:"separate-token"};
    const fetchImpl=vi.fn();
    const response=await dispatchLangGraphExecuteApprovedShadow({agentRunId:baseInput.agentRunId,approvedSql:"SELECT 1",principal:baseInput.principal,requestId:baseInput.requestId},{env,fetchImpl});
    expect(response.status).toBe("configuration_error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("does not call LangGraph when the feature flag is off", async () => {
    const fetchImpl = vi.fn();

    const result = await dispatchLangGraphGenerateShadow(baseInput, {
      env: {
        ...enabledEnv,
        LANGGRAPH_SHADOW_ENABLED: "false"
      },
      fetchImpl
    });

    expect(result.status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the correct generate request when enabled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const result = await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl,
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });

    const body = readRequestBody(fetchImpl);

    expect(result.status).toBe("sent");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/v1/internal/sql-agent/generate",
      expect.objectContaining({
        method: "POST",
        cache: "no-store"
      })
    );
    expect(body.question).toBe(baseInput.question);
    expect(JSON.stringify(body)).not.toContain("test-s2s-token");
    expect(body.correlation_metadata).toMatchObject({
      source: "nextjs_bff",
      event: "generate",
      route: "/api/generate-sql",
      timestamp: "2026-01-01T00:00:00.000Z",
      request_id: "request-1",
      agent_version: "test-version"
    });
  });

  it("sends the selected LLM only in the shadow payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await dispatchLangGraphGenerateShadow(
      {
        ...baseInput,
        llmSelection: {
          provider_key: "infodive_local",
          model_key: "sql-infodive",
          config_version: "sql-infodive-demo-v1"
        }
      },
      {
        env: enabledEnv,
        fetchImpl
      }
    );

    expect(readRequestBody(fetchImpl).llm_selection).toEqual({
      provider_key: "infodive_local",
      model_key: "sql-infodive",
      config_version: "sql-infodive-demo-v1"
    });
  });

  it("uses the generate endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8000/v1/internal/sql-agent/generate"
    );
  });

  it("uses the execute-approved shadow endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await dispatchLangGraphExecuteApprovedShadow(
      {
        agentRunId: baseInput.agentRunId,
        approvedSql: "SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10",
        principal: baseInput.principal,
        requestId: baseInput.requestId
      },
      {
        env: enabledEnv,
        fetchImpl
      }
    );

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8000/v1/internal/sql-agent/execute-approved-shadow"
    );
  });

  it("sends contract_version 1", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl
    });

    expect(readRequestBody(fetchImpl).contract_version).toBe("1");
  });

  it("preserves the product agent_run_id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl
    });

    expect(readRequestBody(fetchImpl).agent_run_id).toBe(baseInput.agentRunId);
  });

  it("normalizes the principal without session internals", () => {
    const session: AgentSession = {
      sessionId: "session-secret-like-id",
      userId: "11111111-1111-4111-8111-111111111111",
      name: "User One",
      email: "user@example.com",
      userProfile: "admin"
    };

    expect(buildLangGraphShadowPrincipal(session)).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      email: "user@example.com",
      profile: "admin"
    });
  });

  it("does not send cookie headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl
    });

    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("cookie");
  });

  it("sends only the service-to-service authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl
    });

    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-s2s-token");
    expect(headers).not.toHaveProperty("Cookie");
    expect(JSON.stringify(readRequestBody(fetchImpl))).not.toContain(
      "test-s2s-token"
    );
  });

  it("fails configuration safely when S2S token is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const result = await dispatchLangGraphGenerateShadow(baseInput, {
      env: {
        ...enabledEnv,
        LANGGRAPH_S2S_TOKEN: ""
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      status: "configuration_error",
      errorMessage: "LangGraph shadow dispatch failed"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("handles timeout without throwing", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );

    const resultPromise = dispatchLangGraphGenerateShadow(baseInput, {
      env: {
        ...enabledEnv,
        LANGGRAPH_SHADOW_TIMEOUT_MS: "100"
      },
      fetchImpl
    });

    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toMatchObject({
      status: "timeout",
      errorMessage: "LangGraph shadow dispatch failed"
    });

    vi.useRealTimers();
  });

  it.each([
    ["absent", undefined, 1500],
    ["invalid", "abc", 1500],
    ["zero", "0", 100],
    ["negative", "-1", 100],
    ["below minimum", "50", 100],
    ["above maximum", "600000", 300000],
    ["inside range", "2500", 2500]
  ])(
    "uses the expected real timer delay when LANGGRAPH_SHADOW_TIMEOUT_MS is %s",
    async (_label, rawTimeout, expectedDelayMs) => {
      await expectShadowTimeoutDelay(rawTimeout, expectedDelayMs);
    }
  );

  it("uses the selected model timeout when env override is absent", async () => {
    await expectShadowTimeoutDelay(undefined, 180000, 180000);
  });

  it("prefers explicit env timeout over selected model timeout", async () => {
    await expectShadowTimeoutDelay("2500", 2500, 180000);
  });

  it("handles HTTP 500 without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(statusResponse(500));

    const result = await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl
    });

    expect(result).toMatchObject({
      status: "http_error",
      httpStatus: 500,
      errorMessage: "LangGraph shadow dispatch failed"
    });
  });

  it("handles network errors without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connection refused"));

    const result = await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl
    });

    expect(result).toMatchObject({
      status: "network_error",
      errorName: "Error",
      errorMessage: "LangGraph shadow dispatch failed"
    });
  });

  it("handles invalid JSON responses without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("not-json"));

    const result = await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl
    });

    expect(result.status).toBe("invalid_response");
  });

  it("never leaks secret values in error messages", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("secret-token-value"));

    const result = await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl
    });

    expect(JSON.stringify(result)).not.toContain("secret-token-value");
    expect(result.errorMessage).toBe("LangGraph shadow dispatch failed");
  });

  it("sends approved_sql unchanged to execute-approved shadow", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const approvedSql = "  SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10  ";

    await dispatchLangGraphExecuteApprovedShadow(
      {
        agentRunId: baseInput.agentRunId,
        approvedSql,
        principal: baseInput.principal,
        requestId: baseInput.requestId
      },
      {
        env: enabledEnv,
        fetchImpl
      }
    );

    expect(readRequestBody(fetchImpl).approved_sql).toBe(approvedSql);
  });
});

describe("P2 generation-only transport gate", () => {
  const p2 = {
    ...enabledEnv,
    VERCEL: "1",
    LANGGRAPH_SHADOW_ENABLED: "false",
    LANGGRAPH_P2_GENERATE_ONLY_ENABLED: "true",
    LANGGRAPH_SHADOW_TRANSPORT: "n8n",
    LANGGRAPH_SHADOW_N8N_WEBHOOK_URL:
      "https://n8n.example.test/webhook/langgraph-shadow-parallel-v1",
    N8N_SHADOW_WEBHOOK_TOKEN: "synthetic-token-p2"
  };

  it("stays off without the separate opt-in, regardless of the global flag", async () => {
    const fetchImpl = vi.fn();
    const result = await dispatchLangGraphP2GenerateOnly(baseInput, {
      env: { ...p2, LANGGRAPH_P2_GENERATE_ONLY_ENABLED: "false" },
      fetchImpl
    });
    expect(result.status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects direct or official LangGraph transports without a network call", async () => {
    const fetchImpl = vi.fn();
    for (const env of [
      { ...p2, LANGGRAPH_SHADOW_TRANSPORT: "direct" },
      { ...p2, LANGGRAPH_OFFICIAL_VIA_N8N: "true" }
    ]) {
      expect((await dispatchLangGraphP2GenerateOnly(baseInput, { env, fetchImpl })).status)
        .toBe("configuration_error");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the same generate-only relay envelope while global Shadow remains disabled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 202, text: async () => JSON.stringify({
        contract_version: "1",
        accepted: true,
        agent_run_id: baseInput.agentRunId,
        event: "generate"
      })
    } as Response);
    const sent = await dispatchLangGraphP2GenerateOnly(baseInput, { env: p2, fetchImpl });
    expect(sent).toEqual({ status: "sent", httpStatus: 202 });
    const payload = readRequestBody(fetchImpl);
    expect(payload.question).toBe(baseInput.question);
    expect(payload).not.toHaveProperty("approved_sql");
    expect((payload.correlation_metadata as Record<string, unknown>).route).toBe("/api/generate-sql");
    expect(p2.LANGGRAPH_SHADOW_ENABLED).toBe("false");
  });

  it("preserves strict user/organization expiry canary checks", async () => {
    const fetchImpl = vi.fn();
    const result = await dispatchLangGraphP2GenerateOnly(baseInput, {
      env: { ...p2, LANGGRAPH_SHADOW_CANARY_EXPIRES_AT: "2001-01-01T00:00:00Z" },
      fetchImpl
    });
    expect(result.status).toBe("configuration_error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
