import { describe, expect, it, vi } from "vitest";
import {
  buildLangGraphShadowPrincipal,
  dispatchLangGraphExecuteApprovedShadow,
  dispatchLangGraphGenerateShadow
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
  expectedDelayMs: number
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
    const resultPromise = dispatchLangGraphGenerateShadow(baseInput, {
      env,
      fetchImpl
    });

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
    ["above maximum", "30000", 10000],
    ["inside range", "2500", 2500]
  ])(
    "uses the expected real timer delay when LANGGRAPH_SHADOW_TIMEOUT_MS is %s",
    async (_label, rawTimeout, expectedDelayMs) => {
      await expectShadowTimeoutDelay(rawTimeout, expectedDelayMs);
    }
  );

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

describe("optional n8n-orchestrated Shadow transport", () => {
  const n8nEnv = {
    ...enabledEnv,
    LANGGRAPH_SHADOW_TRANSPORT: "n8n",
    LANGGRAPH_SHADOW_N8N_WEBHOOK_URL:
      "https://n8n.example.invalid/webhook/langgraph-shadow-parallel-v1",
    N8N_SHADOW_WEBHOOK_TOKEN: "isolated-test-shadow-token"
  };

  it("posts identical generate envelope to private n8n without leaking S2S credential", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 202,
      text: async () => JSON.stringify({
        contract_version: "1", accepted: true,
        agent_run_id: baseInput.agentRunId,
        event: "generate"
      })
    });
    const result = await dispatchLangGraphGenerateShadow(baseInput,{
      env: n8nEnv, fetchImpl
    });
    expect(result).toMatchObject({status:"sent",httpStatus:202});
    const [url,init] = fetchImpl.mock.calls[0];
    expect(url).toBe(n8nEnv.LANGGRAPH_SHADOW_N8N_WEBHOOK_URL);
    expect(init.headers).toEqual({
      "X-Agent-Shadow-Token":"isolated-test-shadow-token",
      "Content-Type":"application/json"
    });
    expect(readRequestBody(fetchImpl)).toMatchObject({
      agent_run_id:baseInput.agentRunId,
      question:baseInput.question,
      correlation_metadata:{event:"generate",request_id:baseInput.requestId}
    });
    expect(JSON.stringify(readRequestBody(fetchImpl))).not.toContain("isolated-test-shadow-token");
  });

  it("keeps SQL byte-for-byte in n8n execute-approved shadow envelope", async () => {
    const fetchImpl=vi.fn().mockResolvedValue({
      ok:true,status:202,
      text:async()=>JSON.stringify({
        contract_version:"1",accepted:true,
        agent_run_id:baseInput.agentRunId,event:"execute_approved"
      })
    });
    const approvedSql="  SELECT 1 AS measure  ";
    const result=await dispatchLangGraphExecuteApprovedShadow({
      agentRunId:baseInput.agentRunId, approvedSql,
      principal:baseInput.principal,requestId:baseInput.requestId
    },{env:n8nEnv,fetchImpl});
    expect(result.status).toBe("sent");
    expect(readRequestBody(fetchImpl).approved_sql).toBe(approvedSql);
    expect((readRequestBody(fetchImpl).correlation_metadata as any).event)
      .toBe("execute_approved");
  });

  it("rejects a 202 acknowledgement with the wrong event", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 202,
      text: async () => JSON.stringify({
        contract_version: "1", accepted: true,
        agent_run_id: baseInput.agentRunId, event: "execute_approved"
      })
    });
    const result = await dispatchLangGraphGenerateShadow(baseInput, {
      env: n8nEnv, fetchImpl
    });
    expect(result.status).toBe("invalid_response");
  });

  it("fails closed on missing secret, http transport, bogus 200 or mismatched acknowledgement", async () => {
    const fetchImpl=vi.fn();
    let result=await dispatchLangGraphGenerateShadow(baseInput,{
      env:{...n8nEnv,N8N_SHADOW_WEBHOOK_TOKEN:""},fetchImpl
    });
    expect(result.status).toBe("configuration_error");
    result=await dispatchLangGraphGenerateShadow(baseInput,{
      env:{...n8nEnv,LANGGRAPH_SHADOW_N8N_WEBHOOK_URL:
        "http://n8n.example.invalid/webhook/langgraph-shadow-parallel-v1"},
      fetchImpl
    });
    expect(result.status).toBe("configuration_error");
    expect(fetchImpl).not.toHaveBeenCalled();
    fetchImpl.mockResolvedValueOnce({
      ok:true,status:200,
      text:async()=>JSON.stringify({
        contract_version:"1",accepted:true,
        agent_run_id:baseInput.agentRunId,event:"generate"
      })
    });
    result=await dispatchLangGraphGenerateShadow(baseInput,{env:n8nEnv,fetchImpl});
    expect(result.status).toBe("invalid_response");
    fetchImpl.mockResolvedValueOnce({
      ok:true,status:202,
      text:async()=>JSON.stringify({
        contract_version:"1",accepted:true,agent_run_id:"other",event:"generate"
      })
    });
    result=await dispatchLangGraphGenerateShadow(baseInput,{env:n8nEnv,fetchImpl});
    expect(result.status).toBe("invalid_response");
  });
});
