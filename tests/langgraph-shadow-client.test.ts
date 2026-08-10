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
  LANGGRAPH_SHADOW_TIMEOUT_MS: "1500"
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

  it("does not send authorization headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await dispatchLangGraphGenerateShadow(baseInput, {
      env: enabledEnv,
      fetchImpl
    });

    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain(
      "authorization"
    );
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
