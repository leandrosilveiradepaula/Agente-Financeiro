import { describe, expect, it, vi } from "vitest";
import {
  buildLangGraphShadowPrincipal,
  dispatchLangGraphExecuteApprovedShadow,
  dispatchLangGraphGenerateShadow,
  isLangGraphShadowDispatchConfigured
} from "@/lib/langgraph-shadow-client";
import type { AgentSession } from "@/lib/auth/auth-types";

const enabledEnv = {
  LANGGRAPH_SHADOW_ENABLED: "true",
  LANGGRAPH_INTERNAL_BASE_URL: "http://127.0.0.1:8000",
  LANGGRAPH_SHADOW_TIMEOUT_MS: "1500",
  LANGGRAPH_S2S_TOKEN: "test-s2s-token"
};

const baseInput = {
  agentRunId: "11111111-1111-4111-8111-111111111111",
  question: "Qual foi o resultado por marca?",
  principal: {
    id: "user-1",
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
    for (const body of ["{}", "{\\\"relay_status\\\":\\\"accepted\\\",\\\"agent_run_id\\\":\\\"wrong\\\"}", ""]) {
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
      userId: "user-1",
      name: "User One",
      email: "user@example.com",
      userProfile: "admin"
    };

    expect(buildLangGraphShadowPrincipal(session)).toEqual({
      id: "user-1",
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
