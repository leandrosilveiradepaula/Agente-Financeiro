import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getLangGraphShadowRun,
  getLangGraphShadowRunVisualization,
  listLangGraphShadowRuns,
  isLangGraphShadowEvidenceReadConfigured
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
  it("uses the distinct authenticated n8n evidence relay instead of LangGraph S2S", async () => {
    const relayEnv = {
      ...env,
      VERCEL: "1",
      LANGGRAPH_SHADOW_EVIDENCE_TRANSPORT: "n8n",
      LANGGRAPH_SHADOW_EVIDENCE_N8N_WEBHOOK_URL:
        "https://n8n.example.test/webhook/langgraph-shadow-evidence-v1",
      N8N_SHADOW_EVIDENCE_WEBHOOK_TOKEN: "synthetic-relay-token",
      LANGGRAPH_INTERNAL_BASE_URL: "",
      LANGGRAPH_S2S_TOKEN: ""
    };
    expect(isLangGraphShadowEvidenceReadConfigured(relayEnv)).toBe(true);
    const item = { ...shadowRun, agent_run_id: "agent-1", shadow_record_id: "record-1" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {
      contract_version: "1", agent_run_id: "agent-1", items: [item]
    }));
    const result = await listLangGraphShadowRuns("agent-1", { limit: 5 }, {
      env: relayEnv, fetchImpl
    });
    expect(result.status).toBe("ok");
    const [target, init] = fetchImpl.mock.calls[0];
    expect(target).toBe("https://n8n.example.test/webhook/langgraph-shadow-evidence-v1");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({
      "X-Agent-Shadow-Evidence-Token": "synthetic-relay-token",
      "Content-Type": "application/json",
      Accept: "application/json"
    });
    const sent = JSON.parse(String(init.body));
    expect(sent).toEqual({
      contract_version: "1", request_id: expect.any(String),
      operation: "list", agent_run_id: "agent-1", limit: 5
    });
    expect(JSON.stringify(sent)).not.toContain("synthetic-relay-token");
    expect(JSON.stringify(sent)).not.toContain("LANGGRAPH_S2S_TOKEN");
  });

  it("routes detail and visualization through the same read-only bridge", async () => {
    const relayEnv = {
      ...env,
      LANGGRAPH_SHADOW_EVIDENCE_TRANSPORT: "n8n",
      LANGGRAPH_SHADOW_EVIDENCE_N8N_WEBHOOK_URL:
        "https://n8n.example.test/webhook/langgraph-shadow-evidence-v1",
      N8N_SHADOW_EVIDENCE_WEBHOOK_TOKEN: "synthetic-relay-token",
      LANGGRAPH_S2S_TOKEN: ""
    };
    const item = { ...shadowRun, agent_run_id: "agent-1", shadow_record_id: "record-1" };
    const detailFetch = vi.fn().mockResolvedValue(jsonResponse(200, {
      contract_version: "1", ...item
    }));
    const detail = await getLangGraphShadowRun("record-1", {
      env: relayEnv, fetchImpl: detailFetch
    });
    expect(detail.status).toBe("ok");
    expect(JSON.parse(String(detailFetch.mock.calls[0][1].body))).toMatchObject({
      operation: "detail", shadow_record_id: "record-1"
    });
    const graphFetch = vi.fn().mockResolvedValue(jsonResponse(200, {
      ...visualization, run: item
    }));
    const graph = await getLangGraphShadowRunVisualization("record-1", {
      env: relayEnv, fetchImpl: graphFetch
    });
    expect(graph.status).toBe("ok");
    expect(JSON.parse(String(graphFetch.mock.calls[0][1].body))).toMatchObject({
      operation: "visualization", shadow_record_id: "record-1"
    });
  });

  it("fails closed on untrusted webhook destinations and absent secrets", async () => {
    const good = {
      ...env, VERCEL: "1",
      LANGGRAPH_SHADOW_EVIDENCE_TRANSPORT: "n8n",
      LANGGRAPH_SHADOW_EVIDENCE_N8N_WEBHOOK_URL:
        "https://n8n.example.test/webhook/langgraph-shadow-evidence-v1",
      N8N_SHADOW_EVIDENCE_WEBHOOK_TOKEN: "synthetic-relay-token",
      LANGGRAPH_S2S_TOKEN: ""
    };
    for (const bad of [
      "http://n8n.example.test/webhook/langgraph-shadow-evidence-v1",
      "https://127.0.0.1/webhook/langgraph-shadow-evidence-v1",
      "https://10.0.0.5/webhook/langgraph-shadow-evidence-v1",
      "https://user:pass@n8n.example.test/webhook/langgraph-shadow-evidence-v1",
      "https://n8n.example.test/webhook/langgraph-shadow-evidence-v1?token=x",
      "https://n8n.example.test/webhook/other"
    ]) {
      const badEnv = { ...good, LANGGRAPH_SHADOW_EVIDENCE_N8N_WEBHOOK_URL: bad };
      expect(isLangGraphShadowEvidenceReadConfigured(badEnv)).toBe(false);
      const fetchImpl = vi.fn();
      expect((await listLangGraphShadowRuns("agent-1", undefined, {
        env: badEnv, fetchImpl
      })).status).toBe("configuration_error");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    expect(isLangGraphShadowEvidenceReadConfigured({
      ...good, N8N_SHADOW_EVIDENCE_WEBHOOK_TOKEN: ""
    })).toBe(false);
    expect(isLangGraphShadowEvidenceReadConfigured({
      ...good, LANGGRAPH_SHADOW_EVIDENCE_TRANSPORT: "unknown"
    })).toBe(false);
  });

  it("rejects non-200 and malformed evidence relay responses without leaking raw fields", async () => {
    const relayEnv = {
      ...env,
      LANGGRAPH_SHADOW_EVIDENCE_TRANSPORT: "n8n",
      LANGGRAPH_SHADOW_EVIDENCE_N8N_WEBHOOK_URL:
        "https://n8n.example.test/webhook/langgraph-shadow-evidence-v1",
      N8N_SHADOW_EVIDENCE_WEBHOOK_TOKEN: "hidden-token"
    };
    const acceptedOnly = await listLangGraphShadowRuns("agent-1", undefined, {
      env: relayEnv, fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(202, { contract_version: "1", items: [] })
      )
    });
    expect(acceptedOnly.status).toBe("invalid_response");
    const wrongContract = await listLangGraphShadowRuns("agent-1", undefined, {
      env: relayEnv, fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(200, { items: [], sql: "SELECT confidential" })
      )
    });
    expect(wrongContract.status).toBe("invalid_response");
    expect(JSON.stringify(wrongContract)).not.toContain("SELECT confidential");
  });


  it("requires a safe explicit evidence endpoint on Vercel, independently of dispatch", async () => {
    const configured = {
      ...env,
      VERCEL: "1",
      LANGGRAPH_INTERNAL_BASE_URL: "https://shadow.example.test",
      LANGGRAPH_SHADOW_ENABLED: "false"
    };
    expect(isLangGraphShadowEvidenceReadConfigured(configured)).toBe(true);
    expect(isLangGraphShadowEvidenceReadConfigured({
      ...configured, LANGGRAPH_S2S_TOKEN: ""
    })).toBe(false);
    for (const url of [
      "http://shadow.example.test",
      "https://127.0.0.1:8000",
      "https://10.0.0.5",
      "https://user:password@shadow.example.test",
      "https://shadow.example.test/?key=test",
      "https://shadow.example.test/non-root"
    ]) {
      const bad = { ...configured, LANGGRAPH_INTERNAL_BASE_URL: url };
      expect(isLangGraphShadowEvidenceReadConfigured(bad)).toBe(false);
      const fetchImpl = vi.fn();
      const result = await listLangGraphShadowRuns(
        "agent-1", undefined, { env: bad, fetchImpl }
      );
      expect(result.status).toBe("configuration_error");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    expect(isLangGraphShadowEvidenceReadConfigured({
      ...configured, LANGGRAPH_INTERNAL_BASE_URL: ""
    })).toBe(false);
  });

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

  it("preserves canonical visualization status and step order fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, visualization));

    const result = await getLangGraphShadowRunVisualization("shadow/record 1", {
      env,
      fetchImpl
    });

    expect(result.status).toBe("ok");
    expect(result.status === "ok" ? result.data.run.status : null).toBe("completed");
    expect(result.status === "ok" ? result.data.steps[0].order : null).toBe(1);
  });

  it("normalizes LangGraph visualization final_status and sequence aliases", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...visualization,
        run: {
          ...shadowRun,
          status: undefined,
          final_status: "rejected"
        },
        steps: [
          {
            id: "step-1",
            sequence: 3,
            label: "engine_preflight",
            status: "rejected",
            metadata: {
              reason_code: "shadow_test"
            }
          }
        ]
      })
    );

    const result = await getLangGraphShadowRunVisualization("shadow/record 1", {
      env,
      fetchImpl
    });

    expect(result.status).toBe("ok");
    expect(result.status === "ok" ? result.data.run.status : null).toBe("rejected");
    expect(result.status === "ok" ? result.data.steps[0].order : null).toBe(3);
  });

  it("keeps canonical visualization fields ahead of aliases", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...visualization,
        run: {
          ...shadowRun,
          status: "success",
          final_status: "rejected"
        },
        steps: [
          {
            id: "step-1",
            order: 1,
            sequence: 3,
            label: "engine_preflight",
            status: "success"
          }
        ]
      })
    );

    const result = await getLangGraphShadowRunVisualization("shadow/record 1", {
      env,
      fetchImpl
    });

    expect(result.status).toBe("ok");
    expect(result.status === "ok" ? result.data.run.status : null).toBe("success");
    expect(result.status === "ok" ? result.data.steps[0].order : null).toBe(1);
  });

  it("rejects visualization missing both canonical fields and aliases", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...visualization,
        run: {
          ...shadowRun,
          status: undefined
        },
        steps: [
          {
            id: "step-1",
            label: "engine_preflight",
            status: "success"
          }
        ]
      })
    );

    const result = await getLangGraphShadowRunVisualization("shadow/record 1", {
      env,
      fetchImpl
    });

    expect(result.status).toBe("invalid_response");
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
