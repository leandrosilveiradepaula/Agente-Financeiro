import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getLangGraphShadowRun,
  getLangGraphShadowRunVisualization,
  listLangGraphShadowRuns
} from "@/lib/langgraph-shadow-read-client";

const env = {
  LANGGRAPH_INTERNAL_BASE_URL: "http://127.0.0.1:8000",
  LANGGRAPH_SHADOW_TIMEOUT_MS: "1500",
  LANGGRAPH_SHADOW_ENABLED: "false",
  LANGGRAPH_S2S_TOKEN: "test-s2s-token"
};

const shadowRun = {
  shadow_record_id: "shadow/record 1",
  agent_run_id: "agent/run 1",
  event_type: "generate",
  status: "completed",
  created_at: "2026-01-01T00:00:00.000Z",
  completed_at: "2026-01-01T00:00:01.000Z",
  requires_reapproval: false,
  has_repair: true,
  has_error: false
};

const visualization = {
  contract_version: "1",
  run: shadowRun,
  steps: [
    {
      id: "step-1",
      order: 1,
      label: "engine_preflight",
      status: "success",
      metadata: {
        attempt: 1
      }
    }
  ],
  edges: [],
  flags: {
    has_repair: true
  }
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function brokenJsonResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("internal raw body");
    }
  } as unknown as Response;
}

function calledHeaders(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls[0][1].headers as Record<string, string>;
}

describe("LangGraph shadow read client", () => {
  it("builds the list URL with encoded agent_run_id and limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { shadow_runs: [shadowRun] }));

    const result = await listLangGraphShadowRuns(
      "agent/run 1",
      { limit: 25 },
      { env, fetchImpl }
    );

    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/v1/internal/agent-runs/agent%2Frun%201/shadow-runs?limit=25",
      expect.objectContaining({
        method: "GET",
        cache: "no-store"
      })
    );
  });

  it("clamps list limit to the supported maximum", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { shadow_runs: [] }));

    await listLangGraphShadowRuns("agent-run-1", { limit: 500 }, { env, fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toContain("limit=50");
  });

  it("reads a single shadow record using encoded shadow_record_id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { shadow_run: shadowRun }));

    const result = await getLangGraphShadowRun("shadow/record 1", { env, fetchImpl });

    expect(result.status).toBe("ok");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8000/v1/internal/shadow-runs/shadow%2Frecord%201"
    );
  });

  it("reads visualization using encoded shadow_record_id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, visualization));

    const result = await getLangGraphShadowRunVisualization("shadow/record 1", {
      env,
      fetchImpl
    });

    expect(result.status).toBe("ok");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8000/v1/internal/shadow-runs/shadow%2Frecord%201/visualization"
    );
  });

  it("sends S2S Authorization and does not send Cookie", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { shadow_runs: [] }));

    await listLangGraphShadowRuns("agent-run-1", undefined, { env, fetchImpl });

    const headers = calledHeaders(fetchImpl);
    const headerNames = Object.keys(headers).map((key) => key.toLowerCase());

    expect(headerNames).not.toContain("cookie");
    expect(headers.Authorization).toBe("Bearer test-s2s-token");
  });

  it("fails safely when S2S token is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { shadow_runs: [] }));

    const result = await listLangGraphShadowRuns("agent-run-1", undefined, {
      env: {
        ...env,
        LANGGRAPH_S2S_TOKEN: ""
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      status: "configuration_error",
      errorMessage: "LangGraph shadow read failed"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [400, "bad_request"],
    [404, "not_found"],
    [503, "unavailable"],
    [500, "unavailable"]
  ])("maps HTTP %s to %s", async (httpStatus, status) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(httpStatus, {}));

    const result = await listLangGraphShadowRuns("agent-run-1", undefined, {
      env,
      fetchImpl
    });

    expect(result).toMatchObject({
      status,
      httpStatus,
      errorMessage: "LangGraph shadow read failed"
    });
  });

  it("maps malformed responses without leaking the raw body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(brokenJsonResponse());

    const result = await listLangGraphShadowRuns("agent-run-1", undefined, {
      env,
      fetchImpl
    });

    expect(result.status).toBe("invalid_response");
    expect(JSON.stringify(result)).not.toContain("internal raw body");
  });

  it("maps structurally invalid responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { shadow_runs: [{ status: "ok" }] }));

    const result = await listLangGraphShadowRuns("agent-run-1", undefined, {
      env,
      fetchImpl
    });

    expect(result.status).toBe("invalid_response");
  });

  it("drops malicious or unexpected step metadata while preserving allowed fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
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
      })
    );

    const result = await getLangGraphShadowRunVisualization("shadow-record-1", {
      env,
      fetchImpl
    });

    expect(result.status).toBe("ok");
    expect(result.status === "ok" ? result.data.steps[0].metadata : null).toEqual({
      attempt: 1,
      cycle: 2,
      duration_ms: 15,
      failure_category: "repairable",
      requires_reapproval: true
    });
    expect(JSON.stringify(result)).not.toContain("approved_sql");
    expect(JSON.stringify(result)).not.toContain("question");
    expect(JSON.stringify(result)).not.toContain("token");
    expect(JSON.stringify(result)).not.toContain("authorization");
    expect(JSON.stringify(result)).not.toContain("cookie");
    expect(JSON.stringify(result)).not.toContain("raw_response");
    expect(JSON.stringify(result)).not.toContain("dsn");
    expect(JSON.stringify(result)).not.toContain("unexpected_nested");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("SENSITIVE");
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

    const resultPromise = listLangGraphShadowRuns(
      "agent-run-1",
      undefined,
      {
        env: {
          ...env,
          LANGGRAPH_SHADOW_TIMEOUT_MS: "100"
        },
        fetchImpl
      }
    );

    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toMatchObject({
      status: "timeout",
      errorMessage: "LangGraph shadow read failed"
    });

    vi.useRealTimers();
  });

  it("handles network errors with sanitized details", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("internal URL and token"));

    const result = await listLangGraphShadowRuns("agent-run-1", undefined, {
      env,
      fetchImpl
    });

    expect(result).toMatchObject({
      status: "network_error",
      errorName: "Error",
      errorMessage: "LangGraph shadow read failed"
    });
    expect(JSON.stringify(result)).not.toContain("internal URL and token");
  });

  it("does not write logs from the read client", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { shadow_runs: [] }));

    await listLangGraphShadowRuns("agent-run-1", undefined, { env, fetchImpl });

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
